import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { createHash, createHmac, hkdfSync, timingSafeEqual } from "crypto";
import { ConfigService } from "@nestjs/config";
import { AiOutputMode, AiProviderKind, ProjectRole, WorkspaceRole, type AiSettings } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AccessControlService } from "../common/access-control.service";
import { SecretBox } from "../common/secret-box";
import { PrismaService } from "../prisma/prisma.service";
import { AiEndpointError, assertAiEndpoint } from "../webhooks/safe-post";
import { SaveAiSettingsDto } from "./dto/save-ai-settings.dto";
import { TestAiSettingsDto } from "./dto/test-ai-settings.dto";
import { AiProviderError, scrubProviderError } from "./provider-error";
import { AUTO_LADDER, modeFor, type AnswerMode } from "./providers/output-mode";
import { createAiProvider } from "./providers/provider";

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
  /** How an OpenAI-compatible server is asked for a structured answer; AUTO tries ways in turn. */
  outputMode: AiOutputMode;
  /** The way AUTO learned from runs and tests, if any. */
  learnedMode: AiOutputMode | null;
  testedAt: Date | null;
  updatedAt: Date;
}

/** What a project admin sees of the workspace default they inherit: no limits, no ids, never the key. */
export type InheritedAiSettings = Pick<AiSettingsView, "provider" | "model" | "endpoint" | "enabled" | "hasCredential">;

/** The longest a connection test waits for the provider, whatever the setting's timeout is. */
const TEST_TIMEOUT_MS = 30_000;
/** The most output a connection test asks for: its answer is one small object. */
const TEST_MAX_OUTPUT_TOKENS = 256;
/** How long a passing test of a form's values stays good for saving them as tested. */
const TEST_PROOF_TTL_MS = 10 * 60 * 1000;
const TEST_SCHEMA = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};

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
  outputMode: row.outputMode,
  learnedMode: row.learnedMode,
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
  private readonly logger = new Logger(AiSettingsService.name);
  private readonly box: SecretBox | null;
  private readonly proofKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    const key = config.get<Buffer | null>("ai.encryptionKey") ?? null;
    this.box = key ? new SecretBox(key) : null;
    // Signs the proof of a passing test; derived from JWT_SECRET, apart from the keys that sign and encrypt other things.
    this.proofKey = Buffer.from(hkdfSync("sha256", config.get<string>("jwt.secret")!, "testops", "ai-test-proof v1", 32));
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
    await this.assertNotDemo({ kind: "WORKSPACE", id: workspaceId });
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
    await this.assertNotDemo({ kind: "PROJECT", id: projectId });
    return this.save({ kind: "PROJECT", id: projectId }, userId, dto);
  }

  async removeProject(userId: string, projectId: string) {
    await this.requireProjectAdmin(userId, projectId, false);
    await this.remove({ kind: "PROJECT", id: projectId }, userId);
  }

  /**
   * Sends one small request to a provider, with no project content, and says whether it answered in the shape
   * asked for. Without a body it tests the saved settings: a pass records it (AI can then be switched on), a
   * failure clears it and switches AI off. With the values of the form in the body it tests those instead, before
   * anything is saved: it changes nothing that is saved, except that a pass of exactly what is saved records it.
   * A pass of a form's values returns a `proof`, which lets a later save of exactly those values count as tested.
   * The answer never carries more of the provider's reply than a public endpoint's error text.
   */
  async test(
    userId: string,
    scope: { workspaceId: string } | { projectId: string },
    dto?: TestAiSettingsDto,
  ): Promise<{ ok: boolean; latencyMs: number; error?: string; proof?: string; mode?: AnswerMode }> {
    const owner: Owner =
      "workspaceId" in scope ? { kind: "WORKSPACE", id: scope.workspaceId } : { kind: "PROJECT", id: scope.projectId };
    if (owner.kind === "WORKSPACE") await this.requireWorkspaceAdmin(userId, owner.id);
    else await this.requireProjectAdmin(userId, owner.id, false);
    await this.assertNotDemo(owner);
    const row = await this.prisma.aiSettings.findUnique({ where: whereOwner(owner) });

    const draft = dto && (dto.provider !== undefined || dto.model !== undefined);
    if (!draft && !row) throw new NotFoundException("Save the AI settings before testing them");
    if (draft && (dto.provider === undefined || !dto.model?.trim())) {
      throw new BadRequestException("Send both a provider and a model to test, or nothing to test what is saved");
    }

    // What is tested: the form's values, or the saved row.
    const provider = draft ? dto.provider! : row!.provider;
    const model = draft ? dto.model!.trim() : row!.model;
    const endpoint = draft ? this.parseEndpoint(dto.endpoint) : row!.endpoint;
    if (draft && provider === AiProviderKind.OPENAI_COMPATIBLE && !endpoint) {
      throw new BadRequestException("An OpenAI-compatible provider needs an endpoint");
    }
    // The key follows the same rule as saving: a typed one, else the saved one for the saved endpoint, else none.
    let credential: string | null = null;
    let unreadable = false;
    if (draft && dto.credential !== undefined) credential = dto.credential;
    else if (!draft || (!dto.clearCredential && row && row.endpoint === endpoint)) {
      if (row?.credentialCipher) {
        credential = this.openCredential(row);
        unreadable = credential === null;
      }
    }

    // How to ask: a way, or in AUTO each of the ladder in turn until one works. The values of a form that differ
    // from what is saved can't use what was learned for the saved connection.
    const savedIsTested =
      row !== null &&
      row.provider === provider &&
      row.model === model &&
      row.endpoint === endpoint &&
      (row.credentialCipher ? this.openCredential(row) : null) === credential;
    const outputMode = draft ? (dto.outputMode ?? row?.outputMode ?? AiOutputMode.AUTO) : (row?.outputMode ?? AiOutputMode.AUTO);
    const learnedMode = savedIsTested && row ? row.learnedMode : null;
    const tries: AnswerMode[] =
      provider === AiProviderKind.ANTHROPIC
        ? ["TOOL_CALL"]
        : outputMode === AiOutputMode.AUTO ? AUTO_LADDER.map((_, index) => modeFor(outputMode, learnedMode, index)) : [outputMode];
    // Only a failure of the answer's form or of the way is worth asking another way; a wrong key or a dead server is not.
    let failure: string | null = null;
    let worked: AnswerMode | null = null;
    const started = Date.now();
    if (unreadable) {
      failure = "The saved provider key can't be read, probably because AI_ENCRYPTION_KEY changed; enter the key again";
    } else {
      for (const mode of tries) {
        try {
          const { output } = await createAiProvider({
            provider,
            model,
            endpoint,
            credential,
            maxOutputTokens: Math.min(row?.maxOutputTokens ?? TEST_MAX_OUTPUT_TOKENS, TEST_MAX_OUTPUT_TOKENS),
            requestTimeoutMs: Math.min(row?.requestTimeoutMs ?? TEST_TIMEOUT_MS, TEST_TIMEOUT_MS),
          }).generate({
            system: 'This is a connection test. Answer with the JSON object {"ok": true}.',
            user: "Reply now.",
            schemaName: "connection_test",
            schema: TEST_SCHEMA,
            mode,
          });
          if (typeof output !== "object" || output === null || (output as { ok?: unknown }).ok !== true) {
            throw new AiProviderError("The model answered, but not in the shape the test asked for", true, { escalate: true });
          }
          worked = mode;
          failure = null;
          break;
        } catch (error) {
          if (!(error instanceof AiProviderError)) this.logger.error(`AI connection test failed unexpectedly: ${String(error)}`);
          // The first failure is what is reported: it says why the preferred way didn't work.
          failure ??= scrubProviderError(
            error instanceof AiProviderError ? error.message : "The test failed unexpectedly",
            credential,
          );
          if (!(error instanceof AiProviderError && (error.escalate || error.unsupportedMode))) break;
        }
      }
    }
    const latencyMs = Date.now() - started;

    // A test of other values says nothing about what is saved. Only a test of exactly what is saved records itself,
    // and only if the saved connection is still the one that was tested: a save during the test wins.
    if (row && savedIsTested) {
      const unchanged = {
        id: row.id,
        provider: row.provider,
        model: row.model,
        endpoint: row.endpoint,
        credentialCipher: row.credentialCipher,
      };
      if (failure && !draft) {
        await this.prisma.aiSettings.updateMany({ where: unchanged, data: { testedAt: null, enabled: false } });
      } else if (!failure) {
        // A way that worked after another failed is what this server keeps to, so AUTO starts there next time.
        const learn = row.outputMode === AiOutputMode.AUTO && worked && worked !== modeFor(row.outputMode, row.learnedMode, 0);
        await this.prisma.aiSettings.updateMany({
          where: unchanged,
          data: { testedAt: new Date(), ...(learn ? { learnedMode: worked } : {}) },
        });
      }
    }
    if (failure) return { ok: false, latencyMs, error: failure };
    return {
      ok: true,
      latencyMs,
      mode: worked ?? undefined,
      ...(draft ? { proof: this.signProof(owner, provider, model, endpoint, credential, Date.now() + TEST_PROOF_TTL_MS) } : {}),
    };
  }

  /** What a proof vouches for: this owner, and exactly this connection. The key is in it only as a hash. */
  private proofMac(owner: Owner, provider: string, model: string, endpoint: string | null, credential: string | null, expires: number) {
    const keyHash = createHash("sha256").update(credential ?? "").digest("hex");
    return createHmac("sha256", this.proofKey)
      .update(JSON.stringify([owner.kind, owner.id, provider, model, endpoint ?? "", keyHash, expires]))
      .digest("base64url");
  }

  private signProof(owner: Owner, provider: string, model: string, endpoint: string | null, credential: string | null, expires: number) {
    return `${expires}.${this.proofMac(owner, provider, model, endpoint, credential, expires)}`;
  }

  private proofHolds(proof: string | undefined, owner: Owner, provider: string, model: string, endpoint: string | null, credential: string | null) {
    if (!proof) return false;
    const [expiresText, mac] = proof.split(".");
    const expires = Number(expiresText);
    if (!mac || !Number.isFinite(expires) || expires < Date.now()) return false;
    const expected = Buffer.from(this.proofMac(owner, provider, model, endpoint, credential, expires));
    const given = Buffer.from(mac);
    return given.length === expected.length && timingSafeEqual(given, expected);
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

  /**
   * Every account is an admin of its own DEMO workspace, and defining a provider lets an admin aim the server at
   * its own network. A DEMO workspace is for looking around, so it takes no AI settings: what the server may be
   * pointed at is for workspaces people made on purpose.
   */
  private async assertNotDemo(owner: Owner): Promise<void> {
    const workspace =
      owner.kind === "WORKSPACE"
        ? await this.prisma.workspace.findUnique({ where: { id: owner.id }, select: { isDemo: true } })
        : (await this.prisma.project.findUnique({ where: { id: owner.id }, select: { workspace: { select: { isDemo: true } } } }))
            ?.workspace;
    if (workspace?.isDemo) {
      throw new ForbiddenException("AI can't be set up in a DEMO workspace; create a workspace of your own for that");
    }
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
    try {
      assertAiEndpoint(value);
    } catch (error) {
      if (error instanceof AiEndpointError) throw new BadRequestException(error.message);
      throw error;
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
    // A passing connection test only vouches for the settings it ran with: the saved ones, or, through its proof,
    // exactly the values being saved now.
    const effectiveCredential =
      dto.credential !== undefined ? dto.credential : credentialCipher && existing?.credentialCipher === credentialCipher ? this.openCredential(existing) : null;
    const proven = this.proofHolds(dto.testProof, owner, dto.provider, model, endpoint, effectiveCredential);
    const testedAt = proven ? new Date() : existing && !connectionChanged ? existing.testedAt : null;

    if (dto.enabled === true) {
      if (dto.provider === AiProviderKind.ANTHROPIC && !credentialCipher) {
        throw new ConflictException("Anthropic needs a provider key before AI can be switched on");
      }
      if (!testedAt) throw new ConflictException("Run the connection test first");
    }
    const enabled = dto.enabled ?? (connectionChanged ? false : (existing?.enabled ?? false));
    // What AUTO learned belongs to the connection and to AUTO: another model, endpoint or key, or a pinned way, starts over.
    const outputMode = dto.outputMode ?? existing?.outputMode ?? AiOutputMode.AUTO;
    const learnedMode = existing && !connectionChanged && existing.outputMode === outputMode ? existing.learnedMode : null;

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
      outputMode,
      learnedMode,
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
        ["outputMode", (existing?.outputMode ?? AiOutputMode.AUTO) !== row.outputMode],
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
