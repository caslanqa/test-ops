import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { AiGuidance, AiGuidanceStep } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AiSettingsService } from "../ai-settings.service";
import { BUILTIN_REF_PREFIX, BuiltinGuidanceService, builtinRef, type BuiltinGuidance } from "./builtin-guidance";
import { GUIDANCE_BUDGET_TOKENS, GUIDANCE_LIMITS } from "./guidance-limits";
import {
  pickForStep,
  renderTeamGuidance,
  type DroppedGuidance,
  type GuidanceCandidate,
  type GuidanceSelection,
} from "./resolve-guidance";

/** What one step of a project would be sent. */
export interface ResolvedGuidance {
  /** In prompt order. */
  used: GuidanceCandidate[];
  dropped: DroppedGuidance[];
  usedTokens: number;
  /** The most tokens of guidance a step may carry; 0 means no limit. */
  budgetTokens: number;
  /** The exact block for the step's system prompt; empty when nothing applies. */
  prompt: string;
}

const toCandidate = (row: AiGuidance): GuidanceCandidate => ({
  ref: row.id,
  scope: row.workspaceId ? "WORKSPACE" : "PROJECT",
  title: row.title,
  body: row.body,
  version: row.version,
  steps: row.steps,
  priority: row.priority,
  source: row.sourceKind === "UPLOADED" ? [row.sourceName ?? "An uploaded file", row.license].filter(Boolean).join(" · ") : "Written in TestOps",
});

const toBuiltinCandidate = (pack: BuiltinGuidance): GuidanceCandidate => ({
  ref: builtinRef(pack.key),
  scope: "BUILTIN",
  title: pack.title,
  body: pack.body,
  version: pack.version,
  steps: pack.steps,
  priority: pack.priority,
  source: `${pack.origin} · ${pack.license}`,
});

/**
 * Which guidance a project's steps use: the pure rules are in resolve-guidance.ts; this reads what they need.
 * Nothing here checks who is asking: the caller does.
 */
@Injectable()
export class GuidanceResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AiSettingsService,
    private readonly builtin: BuiltinGuidanceService,
  ) {}

  /** The keys of the built-in packs that are on for a project: its own switch wins over its workspace's, and with none a pack is off. */
  private async builtinOn(projectId: string, workspaceId: string): Promise<Set<string>> {
    const switches = await this.prisma.aiGuidanceToggle.findMany({
      where: { builtinKey: { not: null }, OR: [{ projectId }, { workspaceId }] },
      select: { projectId: true, builtinKey: true, enabled: true },
    });
    const ofProject = new Map<string, boolean>();
    const ofWorkspace = new Map<string, boolean>();
    for (const toggle of switches) (toggle.projectId ? ofProject : ofWorkspace).set(toggle.builtinKey!, toggle.enabled);
    return new Set(this.builtin.all().map((pack) => pack.key).filter((key) => ofProject.get(key) ?? ofWorkspace.get(key) ?? false));
  }

  /** The token budget of the AI setting the project uses (its own, else its workspace's), or the default with none. */
  async budgetFor(projectId: string): Promise<number> {
    const { settings } = await this.settings.resolve(projectId);
    return settings?.guidanceBudgetTokens ?? GUIDANCE_BUDGET_TOKENS.default;
  }

  /**
   * Everything the selection allows, before the step and the budget narrow it. `EFFECTIVE` is the workspace's
   * guidance that is on and not switched off for this project, and the project's that is on; `LIST` is exactly the
   * named guidance, as long as the project can see it (its own, or its workspace's): switched on or not for an
   * admin, who writes and tries guidance, but only what is in effect for anyone else (`inEffectOnly`), since the
   * rest is a draft only admins read, and a run sends the model all of what it names.
   */
  async candidatesFor(
    projectId: string,
    selection: GuidanceSelection,
    { inEffectOnly = false }: { inEffectOnly?: boolean } = {},
  ): Promise<GuidanceCandidate[]> {
    if (selection.mode === "NONE") return [];
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
    if (!project) throw new NotFoundException("Project not found");

    if (selection.mode === "LIST") {
      const ids = [...new Set(selection.ids ?? [])];
      if (ids.length === 0) throw new BadRequestException("Name at least one guidance to use");
      if (ids.length > GUIDANCE_LIMITS.selectionIds) {
        throw new BadRequestException(`Name at most ${GUIDANCE_LIMITS.selectionIds} guidance`);
      }
      // A built-in pack is named `builtin:<key>`; anything else is the id of a written guidance.
      const packKeys = ids.filter((id) => id.startsWith(BUILTIN_REF_PREFIX)).map((id) => id.slice(BUILTIN_REF_PREFIX.length));
      const writtenIds = ids.filter((id) => !id.startsWith(BUILTIN_REF_PREFIX));
      const packs = packKeys.map((key) => this.builtin.byKey(key));
      const found = await this.prisma.aiGuidance.findMany({
        where: { id: { in: writtenIds }, OR: [{ projectId }, { workspaceId: project.workspaceId }] },
      });
      let rows = found;
      let namedPacks = packs.filter((pack): pack is BuiltinGuidance => pack !== null);
      if (inEffectOnly) {
        const switchedOff = await this.prisma.aiGuidanceToggle.findMany({
          where: { projectId, enabled: false, guidanceId: { in: writtenIds } },
          select: { guidanceId: true },
        });
        const off = new Set(switchedOff.map((toggle) => toggle.guidanceId));
        rows = found.filter((row) => row.enabled && !off.has(row.id));
        const on = packKeys.length > 0 ? await this.builtinOn(projectId, project.workspaceId) : new Set<string>();
        namedPacks = namedPacks.filter((pack) => on.has(pack.key));
      }
      // Another scope's id, a pack that does not exist, and a draft a person may not name answer like a missing one,
      // so ids can't be probed.
      if (rows.length !== writtenIds.length || namedPacks.length !== packKeys.length) throw new NotFoundException("Guidance not found");
      return [...namedPacks.map(toBuiltinCandidate), ...rows.map(toCandidate)];
    }

    const [shared, own, switchedOff] = await Promise.all([
      this.prisma.aiGuidance.findMany({ where: { workspaceId: project.workspaceId, enabled: true } }),
      this.prisma.aiGuidance.findMany({ where: { projectId, enabled: true } }),
      this.prisma.aiGuidanceToggle.findMany({
        where: { projectId, enabled: false, guidanceId: { not: null } },
        select: { guidanceId: true },
      }),
    ]);
    const off = new Set(switchedOff.map((toggle) => toggle.guidanceId));
    const on = await this.builtinOn(projectId, project.workspaceId);
    return [
      ...this.builtin.all().filter((pack) => on.has(pack.key)).map(toBuiltinCandidate),
      ...[...shared.filter((row) => !off.has(row.id)), ...own].map(toCandidate),
    ];
  }

  /** What one step of the project would be sent under a selection, within the budget. */
  async resolve(projectId: string, step: AiGuidanceStep, selection: GuidanceSelection): Promise<ResolvedGuidance> {
    const [candidates, budgetTokens] = await Promise.all([this.candidatesFor(projectId, selection), this.budgetFor(projectId)]);
    const picked = pickForStep(candidates, step, budgetTokens);
    return {
      ...picked,
      budgetTokens,
      prompt: renderTeamGuidance(picked.used.map(({ title, body }) => ({ title, body }))),
    };
  }
}
