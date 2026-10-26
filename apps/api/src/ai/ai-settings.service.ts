import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AiProviderKind, ProjectRole, WorkspaceRole, type AiSettings } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AccessControlService } from "../common/access-control.service";
import { SecretBox } from "../common/secret-box";
import { PrismaService } from "../prisma/prisma.service";
import { SaveAiSettingsDto } from "./dto/save-ai-settings.dto";

/** Which setting a project uses: its own, its workspace's default, or none. */
export type AiSource = "PROJECT" | "WORKSPACE" | "NONE";

/** A setting as the API shows it: the provider key is never part of it, only whether there is one. */
export interface AiSettingsView {
  id: string;
  scope: "WORKSPACE" | "PROJECT";
  enabled: boolean;
  provider: AiProviderKind;
  model: string;
  endpoint: string | null;
  hasCredential: boolean;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  maxRunsPerUserPerDay: number;
  testedAt: Date | null;
  updatedAt: Date;
}

/** What a project admin sees of the workspace default they inherit: no limits, no ids, never the key. */
export type InheritedAiSettings = Pick<AiSettingsView, "provider" | "model" | "endpoint" | "enabled" | "hasCredential">;

/** The owner of a setting: a workspace (its default) or a project (its override). */
type Owner = { kind: "WORKSPACE"; id: string } | { kind: "PROJECT"; id: string };

const whereOwner = (owner: Owner) => (owner.kind === "WORKSPACE" ? { workspaceId: owner.id } : { projectId: owner.id });

const toView = (row: AiSettings): AiSettingsView => ({
  id: row.id,
  scope: row.workspaceId ? "WORKSPACE" : "PROJECT",
  enabled: row.enabled,
  provider: row.provider,
  model: row.model,
  endpoint: row.endpoint,
  hasCredential: row.credentialCipher !== null,
  maxOutputTokens: row.maxOutputTokens,
  requestTimeoutMs: row.requestTimeoutMs,
  maxRunsPerUserPerDay: row.maxRunsPerUserPerDay,
  testedAt: row.testedAt,
  updatedAt: row.updatedAt,
});

const toInherited = (row: AiSettings): InheritedAiSettings => ({
  provider: row.provider,
  model: row.model,
  endpoint: row.endpoint,
  enabled: row.enabled,
  hasCredential: row.credentialCipher !== null,
});

/**
 * Where the AI provider is defined, and which definition a project uses. Workspace admins define the
 * workspace default and project admins their project's setting, which replaces the default whole: its
 * own provider, model, endpoint, key and limits, with nothing merged. Nobody else can read or change
 * them (the controller adds web-session-only, so an API token can't either).
 *
 * A key belongs to the endpoint it was saved for: pointing a setting at another endpoint drops the
 * saved key unless a new one comes with it, so a key can't be sent somewhere its owner never chose.
 */
@Injectable()
export class AiSettingsService {
  private readonly box: SecretBox | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    const key = config.get<Buffer | null>("ai.encryptionKey") ?? null;
    this.box = key ? new SecretBox(key) : null;
  }

  /** The setting a project uses, with where it comes from. The row still holds the encrypted key: server side only. */
  async resolve(projectId: string): Promise<{ source: AiSource; settings: AiSettings | null }> {
    const own = await this.prisma.aiSettings.findUnique({ where: { projectId } });
    if (own) return { source: "PROJECT", settings: own };
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
    const inherited = project
      ? await this.prisma.aiSettings.findUnique({ where: { workspaceId: project.workspaceId } })
      : null;
    return inherited ? { source: "WORKSPACE", settings: inherited } : { source: "NONE", settings: null };
  }

  /** The provider key of a setting, or null when it has none or can't be read (the encryption key changed). */
  openCredential(settings: AiSettings): string | null {
    return settings.credentialCipher ? (this.box?.open(settings.credentialCipher) ?? null) : null;
  }

  /** What every member of a project may know: whether AI is on and which setting is behind it. */
  async status(userId: string, projectId: string) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(userId, projectId);
    const { source, settings } = await this.resolve(projectId);
    return { enabled: settings?.enabled ?? false, source };
  }

  async getWorkspace(userId: string, workspaceId: string) {
    await this.requireWorkspaceAdmin(userId, workspaceId);
    const row = await this.prisma.aiSettings.findUnique({ where: { workspaceId } });
    return { settings: row ? toView(row) : null };
  }

  async saveWorkspace(userId: string, workspaceId: string, dto: SaveAiSettingsDto) {
    await this.requireWorkspaceAdmin(userId, workspaceId);
    return this.save({ kind: "WORKSPACE", id: workspaceId }, userId, dto);
  }

  async removeWorkspace(userId: string, workspaceId: string) {
    await this.requireWorkspaceAdmin(userId, workspaceId);
    await this.remove({ kind: "WORKSPACE", id: workspaceId }, userId);
  }

  /** The project's own setting, the workspace default it would use without one, and which of them applies. */
  async getProject(userId: string, projectId: string) {
    await this.requireProjectAdmin(userId, projectId, true);
    const own = await this.prisma.aiSettings.findUnique({ where: { projectId } });
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
    const inherited = project
      ? await this.prisma.aiSettings.findUnique({ where: { workspaceId: project.workspaceId } })
      : null;
    const source: AiSource = own ? "PROJECT" : inherited ? "WORKSPACE" : "NONE";
    return {
      own: own ? toView(own) : null,
      inherited: inherited ? toInherited(inherited) : null,
      source,
    };
  }

  async saveProject(userId: string, projectId: string, dto: SaveAiSettingsDto) {
    await this.requireProjectAdmin(userId, projectId, false);
    return this.save({ kind: "PROJECT", id: projectId }, userId, dto);
  }

  async removeProject(userId: string, projectId: string) {
    await this.requireProjectAdmin(userId, projectId, false);
    await this.remove({ kind: "PROJECT", id: projectId }, userId);
  }

  private requireWorkspaceAdmin(userId: string, workspaceId: string) {
    return this.accessControl.requireWorkspaceRole(userId, workspaceId, [WorkspaceRole.ADMIN]);
  }

  /** A workspace admin counts as admin of every project in the workspace. An archived project is read-only. */
  private requireProjectAdmin(userId: string, projectId: string, allowArchived: boolean) {
    return this.accessControl.requireProjectRoleOrWorkspaceAdmin(userId, projectId, [ProjectRole.ADMIN], {
      allowArchived,
    });
  }

  private seal(plain: string): string {
    if (!this.box) {
      throw new ConflictException("AI_ENCRYPTION_KEY isn't set on this server, so a provider key can't be saved");
    }
    return this.box.seal(plain);
  }

  /** The endpoint without a trailing slash, or null; a value that can't be used is a 400. */
  private parseEndpoint(raw: string | undefined): string | null {
    const value = raw?.trim().replace(/\/+$/, "");
    if (!value) return null;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException("The endpoint isn't a valid URL");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new BadRequestException("The endpoint must start with https:// or http://");
    }
    if (url.username || url.password) {
      throw new BadRequestException("Put the provider key in the key field, not in the endpoint");
    }
    return value;
  }

  private async save(owner: Owner, userId: string, dto: SaveAiSettingsDto): Promise<AiSettingsView> {
    const endpoint = this.parseEndpoint(dto.endpoint);
    if (dto.provider === AiProviderKind.OPENAI_COMPATIBLE && !endpoint) {
      throw new BadRequestException("An OpenAI-compatible provider needs an endpoint");
    }
    if (dto.credential !== undefined && dto.clearCredential) {
      throw new BadRequestException("Send a new provider key or ask to remove it, not both");
    }
    const existing = await this.prisma.aiSettings.findUnique({ where: whereOwner(owner) });

    // The key stays only while the endpoint it was saved for stays.
    const endpointChanged = existing !== null && existing.endpoint !== endpoint;
    let credentialCipher: string | null;
    if (dto.credential !== undefined) credentialCipher = this.seal(dto.credential);
    else if (dto.clearCredential || endpointChanged) credentialCipher = null;
    else credentialCipher = existing?.credentialCipher ?? null;

    const model = dto.model.trim();
    const credentialChanged = credentialCipher !== (existing?.credentialCipher ?? null) || dto.credential !== undefined;
    const connectionChanged =
      existing === null ||
      existing.provider !== dto.provider ||
      existing.model !== model ||
      endpointChanged ||
      credentialChanged;
    // A passing connection test only vouches for the settings it ran with.
    const testedAt = existing && !connectionChanged ? existing.testedAt : null;

    if (dto.enabled === true) {
      if (dto.provider === AiProviderKind.ANTHROPIC && !credentialCipher) {
        throw new ConflictException("Anthropic needs a provider key before AI can be switched on");
      }
      if (!testedAt) throw new ConflictException("Run the connection test first");
    }
    const enabled = dto.enabled ?? (connectionChanged ? false : (existing?.enabled ?? false));

    const data = {
      provider: dto.provider,
      model,
      endpoint,
      credentialCipher,
      enabled,
      testedAt,
      maxOutputTokens: dto.maxOutputTokens,
      requestTimeoutMs: dto.requestTimeoutMs,
      maxRunsPerUserPerDay: dto.maxRunsPerUserPerDay,
      updatedById: userId,
    };
    const row = existing
      ? await this.prisma.aiSettings.update({ where: { id: existing.id }, data })
      : await this.prisma.aiSettings.create({ data: { ...data, ...whereOwner(owner) } });

    const changed = (
      [
        ["provider", existing?.provider !== row.provider],
        ["model", existing?.model !== row.model],
        ["endpoint", (existing?.endpoint ?? null) !== row.endpoint],
        ["credential", credentialChanged],
        ["enabled", (existing?.enabled ?? false) !== row.enabled],
        ["maxOutputTokens", existing?.maxOutputTokens !== row.maxOutputTokens],
        ["requestTimeoutMs", existing?.requestTimeoutMs !== row.requestTimeoutMs],
        ["maxRunsPerUserPerDay", existing?.maxRunsPerUserPerDay !== row.maxRunsPerUserPerDay],
      ] as const
    )
      .filter(([, differs]) => differs)
      .map(([name]) => name);
    await this.audit.record({
      userId,
      ...(owner.kind === "WORKSPACE" ? { workspaceId: owner.id } : { projectId: owner.id }),
      action: "ai.settings.updated",
      entityType: "ai_settings",
      entityId: row.id,
      // Never the key itself; the host says where it will go.
      metadata: { changed, ...(changed.includes("endpoint") && row.endpoint ? { endpointHost: new URL(row.endpoint).host } : {}) },
    });
    return toView(row);
  }

  private async remove(owner: Owner, userId: string): Promise<void> {
    const existing = await this.prisma.aiSettings.findUnique({ where: whereOwner(owner) });
    if (!existing) throw new NotFoundException("There is no AI setting to remove");
    await this.prisma.aiSettings.delete({ where: { id: existing.id } });
    await this.audit.record({
      userId,
      ...(owner.kind === "WORKSPACE" ? { workspaceId: owner.id } : { projectId: owner.id }),
      action: "ai.settings.removed",
      entityType: "ai_settings",
      entityId: existing.id,
    });
  }
}
