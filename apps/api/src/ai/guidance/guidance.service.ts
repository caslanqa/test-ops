import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  ProjectRole,
  WorkspaceRole,
  type AiGuidance,
  type AiGuidanceKind,
  type AiGuidanceSource,
  type AiGuidanceStep,
  type Prisma,
} from "@prisma/client";
import { AuditService } from "../../audit/audit.service";
import { AccessControlService } from "../../common/access-control.service";
import { PrismaService } from "../../prisma/prisma.service";
import { BuiltinGuidanceService, type BuiltinGuidance } from "./builtin-guidance";
import { ImportPreviewDto } from "./dto/import-preview.dto";
import { SaveGuidanceDto, UpdateGuidanceDto } from "./dto/save-guidance.dto";
import { ToggleGuidanceDto } from "./dto/toggle-guidance.dto";
import { estimateTokens, GUIDANCE_LIMITS, normalizeSteps } from "./guidance-limits";
import { GuidanceResolver, type ResolvedGuidance } from "./guidance-resolver.service";
import type { GuidanceSelection } from "./resolve-guidance";
import { parseSkillMarkdown } from "./skill-markdown";

/** The owner of a guidance: a workspace (shared by all its projects) or one project. */
export type GuidanceOwner = { kind: "WORKSPACE"; id: string } | { kind: "PROJECT"; id: string };

/** A guidance as the API shows it. */
export interface GuidanceView {
  id: string;
  scope: "WORKSPACE" | "PROJECT";
  title: string;
  summary: string | null;
  body: string;
  kind: AiGuidanceKind;
  steps: AiGuidanceStep[];
  priority: number;
  enabled: boolean;
  version: number;
  sourceKind: AiGuidanceSource;
  sourceName: string | null;
  sourceUrl: string | null;
  license: string | null;
  /** What it adds to a prompt, as estimated for the budget. */
  estimatedTokens: number;
  updatedAt: Date;
}

/** A workspace guidance seen from a project: `enabledHere` says whether it applies to that project. */
export type InheritedGuidanceView = GuidanceView & { enabledHere: boolean };

/** A built-in pack with whether it is on for the owner: a workspace's own switch, or a project's (else its workspace's). */
export interface BuiltinGuidanceView extends BuiltinGuidance {
  estimatedTokens: number;
  enabled: boolean;
  /** Projects only: the project has its own switch for this pack, rather than following its workspace. */
  setByProject?: boolean;
}

export interface GuidanceList {
  own: GuidanceView[];
  /** Projects only: the guidance of the project's workspace. */
  inherited?: InheritedGuidanceView[];
  /** The packs that ship with the app, each with its switch. */
  builtin: BuiltinGuidanceView[];
}

/** One earlier (or the current) state of a guidance. */
export interface GuidanceVersionView {
  version: number;
  title: string;
  summary: string | null;
  body: string;
  kind: AiGuidanceKind;
  steps: AiGuidanceStep[];
  priority: number;
  editedById: string;
  createdAt: Date;
}

const toView = (row: AiGuidance): GuidanceView => ({
  id: row.id,
  scope: row.workspaceId ? "WORKSPACE" : "PROJECT",
  title: row.title,
  summary: row.summary,
  body: row.body,
  kind: row.kind,
  steps: row.steps,
  priority: row.priority,
  enabled: row.enabled,
  version: row.version,
  sourceKind: row.sourceKind,
  sourceName: row.sourceName,
  sourceUrl: row.sourceUrl,
  license: row.license,
  estimatedTokens: estimateTokens(row.body),
  updatedAt: row.updatedAt,
});

const whereOwner = (owner: GuidanceOwner) => (owner.kind === "WORKSPACE" ? { workspaceId: owner.id } : { projectId: owner.id });
const auditOwner = whereOwner;

/** The order of a list: what ranks first in a prompt comes first. */
const LIST_ORDER: Prisma.AiGuidanceOrderByWithRelationInput[] = [{ priority: "desc" }, { title: "asc" }];

/** The fields a change to which makes a new version; the rest (on or off, attribution) are not history. */
const VERSIONED = ["title", "summary", "body", "kind", "steps", "priority"] as const;

const blankToNull = (value: string | null): string | null => (value?.trim() ? value.trim() : null);
/** A text field of a change: left as it was when not sent, cleared when sent blank. */
const optionalText = (given: string | null | undefined, kept: string | null): string | null =>
  given === undefined ? kept : blankToNull(given);
const sameValue = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b) ? a.join() === b.join() : a === b;

/**
 * The team's guidance for the assistant: what workspace admins write for every project of the workspace and what
 * project admins write for their project. Only admins manage it (a workspace admin counts as admin of every
 * project), and the controller adds web-session-only, so a leaked API token can't change what is sent to a model.
 *
 * Every change to the text, steps, kind or priority is kept as a version, so what a run was sent can be told
 * apart from what the guidance says today. The audit log gets titles and versions, never the text.
 */
@Injectable()
export class GuidanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
    private readonly audit: AuditService,
    private readonly resolver: GuidanceResolver,
    private readonly builtin: BuiltinGuidanceService,
  ) {}

  /**
   * What one step of the project would be sent under a selection, for an admin: the same as the read-only route
   * every member has, and also exactly the named guidance whether it is switched on or not. The text of guidance
   * that is not in effect is for admins alone.
   */
  async preview(userId: string, projectId: string, step: AiGuidanceStep, selection: GuidanceSelection): Promise<ResolvedGuidance> {
    await this.requireAdmin(userId, { kind: "PROJECT", id: projectId }, true);
    return this.resolver.resolve(projectId, step, selection);
  }

  /**
   * What a markdown file (a SKILL.md, say) would make as a guidance, for the dialog to fill in; nothing is saved
   * and nothing is fetched: the browser read the file and sent its text. A file over 100000 bytes, with a NUL
   * character, with no text, or with more text than a guidance can hold is a 400 that says which.
   */
  async previewImport(userId: string, owner: GuidanceOwner, dto: ImportPreviewDto) {
    await this.requireAdmin(userId, owner, true);
    if (dto.content.includes("\u0000")) throw new BadRequestException("The file contains a NUL character, so it is not a text file");
    if (Buffer.byteLength(dto.content, "utf8") > GUIDANCE_LIMITS.uploadBytes) {
      throw new BadRequestException(`The file is too large: at most ${GUIDANCE_LIMITS.uploadBytes.toLocaleString("en")} bytes`);
    }
    const parsed = parseSkillMarkdown(dto.content);
    if (parsed.body.length > GUIDANCE_LIMITS.body) {
      throw new BadRequestException(`The text is longer than the ${GUIDANCE_LIMITS.body.toLocaleString("en")} characters a guidance can hold`);
    }
    return {
      ...parsed,
      sourceName: dto.fileName,
      // A suggestion for the dialog; the person decides.
      suggestedKind: /\b(playwright|cypress|selenium)\b/i.test(`${parsed.title} ${parsed.body}`) ? "AUTOMATION_CODE" : "CASE_CONTENT",
      estimatedTokens: estimateTokens(parsed.body),
    };
  }

  /** The guidance of an owner; for a project also the workspace's, with whether each applies to the project. */
  async list(userId: string, owner: GuidanceOwner): Promise<GuidanceList> {
    await this.requireAdmin(userId, owner, true);
    const own = await this.prisma.aiGuidance.findMany({ where: whereOwner(owner), orderBy: LIST_ORDER });
    if (owner.kind === "WORKSPACE") return { own: own.map(toView), builtin: await this.builtinViews(owner, owner.id) };

    const workspaceId = await this.workspaceOf(owner.id);
    const [shared, switches] = await Promise.all([
      this.prisma.aiGuidance.findMany({ where: { workspaceId }, orderBy: LIST_ORDER }),
      this.prisma.aiGuidanceToggle.findMany({ where: { projectId: owner.id, guidanceId: { not: null } } }),
    ]);
    const switched = new Map(switches.map((toggle) => [toggle.guidanceId, toggle.enabled]));
    return {
      own: own.map(toView),
      // A workspace guidance applies unless it is off itself or the project switched it off.
      inherited: shared.map((row) => ({ ...toView(row), enabledHere: row.enabled && switched.get(row.id) !== false })),
      builtin: await this.builtinViews(owner, workspaceId),
    };
  }

  /** The packs with their switches: a workspace's own; for a project its own switch where it has one, else its workspace's. */
  private async builtinViews(owner: GuidanceOwner, workspaceId: string): Promise<BuiltinGuidanceView[]> {
    const switches = await this.prisma.aiGuidanceToggle.findMany({
      where: { builtinKey: { not: null }, OR: [{ workspaceId }, ...(owner.kind === "PROJECT" ? [{ projectId: owner.id }] : [])] },
      select: { projectId: true, builtinKey: true, enabled: true },
    });
    const ofProject = new Map<string, boolean>();
    const ofWorkspace = new Map<string, boolean>();
    for (const toggle of switches) (toggle.projectId ? ofProject : ofWorkspace).set(toggle.builtinKey!, toggle.enabled);
    return this.builtin.all().map((pack) => ({
      ...pack,
      estimatedTokens: estimateTokens(pack.body),
      enabled: (owner.kind === "PROJECT" ? ofProject.get(pack.key) : undefined) ?? ofWorkspace.get(pack.key) ?? false,
      ...(owner.kind === "PROJECT" ? { setByProject: ofProject.has(pack.key) } : {}),
    }));
  }

  async create(userId: string, owner: GuidanceOwner, dto: SaveGuidanceDto): Promise<GuidanceView> {
    await this.requireAdmin(userId, owner, false);
    const fields = {
      title: dto.title,
      summary: blankToNull(dto.summary ?? null),
      body: dto.body,
      kind: dto.kind,
      steps: normalizeSteps(dto.steps),
      priority: dto.priority ?? GUIDANCE_LIMITS.priority.default,
    };
    const row = await this.prisma.$transaction(async (tx) => {
      // One create at a time per owner: without this, creates that arrive together are all counted before any
      // of them is saved, and the limit lets them all through.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-guidance:${owner.kind}:${owner.id}`}))`;
      if ((await tx.aiGuidance.count({ where: whereOwner(owner) })) >= GUIDANCE_LIMITS.perOwner) {
        throw new ConflictException(`At most ${GUIDANCE_LIMITS.perOwner} guidance can be kept here; delete one first`);
      }
      return tx.aiGuidance.create({
        data: {
          ...whereOwner(owner),
          ...fields,
          enabled: dto.enabled ?? true,
          sourceKind: dto.sourceKind ?? "WRITTEN",
          sourceName: blankToNull(dto.sourceName ?? null),
          sourceUrl: blankToNull(dto.sourceUrl ?? null),
          license: blankToNull(dto.license ?? null),
          createdById: userId,
          updatedById: userId,
          // The history holds every version, the first included.
          versions: { create: { version: 1, ...fields, editedById: userId } },
        },
      });
    });
    await this.audit.record({
      userId,
      ...auditOwner(owner),
      action: "ai.guidance.created",
      entityType: "ai_guidance",
      entityId: row.id,
      metadata: { title: row.title, version: row.version, kind: row.kind, steps: row.steps, priority: row.priority },
    });
    return toView(row);
  }

  /**
   * Changes what is sent. A change to the title, summary, body, kind, steps or priority makes the next version; a
   * change of only on or off or of the attribution does not, and a change that changes nothing writes nothing.
   */
  async update(userId: string, owner: GuidanceOwner, guidanceId: string, dto: UpdateGuidanceDto): Promise<GuidanceView> {
    await this.requireAdmin(userId, owner, false);
    const current = await this.findOwned(owner, guidanceId);
    const next = {
      title: dto.title ?? current.title,
      summary: optionalText(dto.summary, current.summary),
      body: dto.body ?? current.body,
      kind: dto.kind ?? current.kind,
      steps: dto.steps ? normalizeSteps(dto.steps) : current.steps,
      priority: dto.priority ?? current.priority,
    };
    const asIs = {
      enabled: dto.enabled ?? current.enabled,
      sourceKind: dto.sourceKind ?? current.sourceKind,
      sourceName: optionalText(dto.sourceName, current.sourceName),
      sourceUrl: optionalText(dto.sourceUrl, current.sourceUrl),
      license: optionalText(dto.license, current.license),
    };
    const changed: string[] = [
      ...VERSIONED.filter((field) => !sameValue(current[field], next[field])),
      ...(Object.keys(asIs) as (keyof typeof asIs)[]).filter((field) => asIs[field] !== current[field]),
    ];
    if (changed.length === 0) return toView(current);

    const versioned = VERSIONED.some((field) => changed.includes(field));
    const row = versioned
      ? await this.prisma.$transaction(async (tx) => {
          // The version is the lock: a change made from a state that has since moved on is refused, not merged.
          const claimed = await tx.aiGuidance.updateMany({
            where: { id: current.id, version: current.version },
            data: { ...next, ...asIs, version: current.version + 1, updatedById: userId },
          });
          if (claimed.count === 0) throw new ConflictException("This guidance was changed meanwhile; reload it and try again");
          await tx.aiGuidanceVersion.create({
            data: { guidanceId: current.id, version: current.version + 1, ...next, editedById: userId },
          });
          return tx.aiGuidance.findUniqueOrThrow({ where: { id: current.id } });
        })
      : await this.prisma.aiGuidance.update({ where: { id: current.id }, data: { ...asIs, updatedById: userId } });
    await this.audit.record({
      userId,
      ...auditOwner(owner),
      action: "ai.guidance.updated",
      entityType: "ai_guidance",
      entityId: row.id,
      // Which fields changed, never what they changed to.
      metadata: { title: row.title, version: row.version, changed },
    });
    return toView(row);
  }

  async remove(userId: string, owner: GuidanceOwner, guidanceId: string): Promise<void> {
    await this.requireAdmin(userId, owner, false);
    const current = await this.findOwned(owner, guidanceId);
    // Its versions and the toggles that name it go with it (cascade).
    const { count } = await this.prisma.aiGuidance.deleteMany({ where: { id: current.id, ...whereOwner(owner) } });
    if (count === 0) throw new NotFoundException("Guidance not found");
    await this.audit.record({
      userId,
      ...auditOwner(owner),
      action: "ai.guidance.deleted",
      entityType: "ai_guidance",
      entityId: current.id,
      metadata: { title: current.title, version: current.version },
    });
  }

  /** Every version of a guidance, newest first. */
  async versions(userId: string, owner: GuidanceOwner, guidanceId: string): Promise<GuidanceVersionView[]> {
    await this.requireAdmin(userId, owner, true);
    const current = await this.findOwned(owner, guidanceId);
    const rows = await this.prisma.aiGuidanceVersion.findMany({
      where: { guidanceId: current.id },
      orderBy: { version: "desc" },
    });
    return rows.map((row) => ({
      version: row.version,
      title: row.title,
      summary: row.summary,
      body: row.body,
      kind: row.kind,
      steps: row.steps,
      priority: row.priority,
      editedById: row.editedById,
      createdAt: row.createdAt,
    }));
  }

  /**
   * Switches one guidance on or off for the owner. A workspace switches built-in packs; a project switches built-in
   * packs and the guidance of its workspace (for itself alone: the workspace's own list is unchanged).
   */
  async toggle(userId: string, owner: GuidanceOwner, dto: ToggleGuidanceDto): Promise<{ enabled: boolean | null }> {
    await this.requireAdmin(userId, owner, false);
    if ((dto.builtinKey === undefined) === (dto.guidanceId === undefined)) {
      throw new BadRequestException("Name exactly one of builtinKey and guidanceId");
    }
    if (dto.builtinKey !== undefined && !this.builtin.byKey(dto.builtinKey)) throw new NotFoundException("Built-in guidance not found");
    let title: string | undefined;
    if (dto.guidanceId !== undefined) {
      if (owner.kind === "WORKSPACE") {
        throw new BadRequestException("A workspace switches built-in packs; a project switches the workspace's guidance for itself");
      }
      // Only a guidance of the project's own workspace: another workspace's id answers like a missing one.
      const target = await this.prisma.aiGuidance.findFirst({
        where: { id: dto.guidanceId, workspaceId: await this.workspaceOf(owner.id) },
        select: { title: true },
      });
      if (!target) throw new NotFoundException("Guidance not found");
      title = target.title;
    }
    const target = { guidanceId: dto.guidanceId ?? null, builtinKey: dto.builtinKey ?? null };
    await this.prisma.$transaction(async (tx) => {
      // The one-row-per-target index can't be an upsert key (it is over COALESCE of four columns), so look, then
      // write, one at a time per owner.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-guidance-toggle:${owner.kind}:${owner.id}`}))`;
      const existing = await tx.aiGuidanceToggle.findFirst({ where: { ...whereOwner(owner), ...target } });
      // `null` clears the owner's own switch: a project then follows its workspace again.
      if (dto.enabled === null) {
        if (existing) await tx.aiGuidanceToggle.delete({ where: { id: existing.id } });
      } else if (existing) await tx.aiGuidanceToggle.update({ where: { id: existing.id }, data: { enabled: dto.enabled } });
      else await tx.aiGuidanceToggle.create({ data: { ...whereOwner(owner), ...target, enabled: dto.enabled } });
    });
    await this.audit.record({
      userId,
      ...auditOwner(owner),
      action: "ai.guidance.toggled",
      entityType: "ai_guidance",
      entityId: dto.guidanceId ?? dto.builtinKey,
      metadata: { ...(title ? { title } : {}), ...(dto.builtinKey ? { builtinKey: dto.builtinKey } : {}), enabled: dto.enabled },
    });
    return { enabled: dto.enabled };
  }

  /** Workspace admins for the workspace's guidance; project admins (a workspace admin counts) for a project's. */
  private requireAdmin(userId: string, owner: GuidanceOwner, allowArchived: boolean) {
    return owner.kind === "WORKSPACE"
      ? this.accessControl.requireWorkspaceRole(userId, owner.id, [WorkspaceRole.ADMIN])
      : this.accessControl.requireProjectRoleOrWorkspaceAdmin(userId, owner.id, [ProjectRole.ADMIN], { allowArchived });
  }

  /** A guidance of this owner; one of another owner answers like a missing one, so ids can't be probed. */
  private async findOwned(owner: GuidanceOwner, guidanceId: string): Promise<AiGuidance> {
    const row = await this.prisma.aiGuidance.findFirst({ where: { id: guidanceId, ...whereOwner(owner) } });
    if (!row) throw new NotFoundException("Guidance not found");
    return row;
  }

  private async workspaceOf(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
    if (!project) throw new NotFoundException("Project not found");
    return project.workspaceId;
  }
}
