import { createHmac, randomBytes } from "crypto";
import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ExecutionMode,
  ProjectRole,
  ProjectWebhook,
  RunSource,
  RunStatus,
  WebhookDeliveryStatus,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccessControlService } from "../common/access-control.service";
import { SecretBox } from "../common/secret-box";
import { SaveWebhookDto } from "./dto/save-webhook.dto";
import { assertWebhookUrl, safePost, WebhookAddressError } from "./safe-post";

/** Headers TestOps sets itself, or that would break the request. */
const RESERVED_HEADERS = new Set(["host", "content-length", "content-type", "connection", "transfer-encoding", "user-agent"]);

/** Seconds to wait before each try; a CI that is briefly down still gets the run. */
const RETRY_DELAYS_S = [0, 10, 60];

/**
 * Why CI said no, from its answer: the "message" of a JSON answer (as GitHub sends it), or else
 * the first line of the text, shortened.
 */
function answerReason(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === "string") return parsed.message.slice(0, 200);
  } catch {
    // Not JSON; use the text.
  }
  return (body.split("\n").find((line) => line.trim()) ?? "").trim().slice(0, 200);
}

const EXECUTE_ROLES: ProjectRole[] = [ProjectRole.ADMIN, ProjectRole.TESTER, ProjectRole.AUTOMATION];

interface DeliveryTarget {
  webhook: ProjectWebhook;
  event: "run.started" | "ping";
  runId: string | null;
  payload: Record<string, unknown>;
}

/**
 * The CI webhook of a project (FR-079). When a run starts that has cases for automation, TestOps
 * POSTs it to the project's webhook, so CI can run those cases and send their results to the run.
 *
 * The body has the shape of a GitHub repository_dispatch, { event_type, client_payload }, so a
 * GitHub repository's dispatches endpoint can be the webhook itself, with an Authorization header.
 * Other CIs (Jenkins, GitLab, a small relay) read the same JSON. Every call is signed:
 * X-TestOps-Signature-256 is "sha256=" + the HMAC-SHA256 of the body with the webhook's secret.
 *
 * Runs that CI started never call it, so a reporter that creates its own run can't start a loop.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly box: SecretBox;
  private readonly allowPrivate: boolean;
  private readonly publicUrl: string | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
    config: ConfigService,
  ) {
    this.box = new SecretBox(config.get<string>("jwt.secret")!);
    this.allowPrivate = config.get<boolean>("webhooks.allowPrivateNetworks") ?? false;
    this.publicUrl = config.get<string | null>("publicUrl") ?? null;
  }

  /** The webhook settings say where run data goes and hold credentials: project admins only. */
  private requireAdmin(userId: string, projectId: string) {
    return this.accessControl.requireProjectRoleOrWorkspaceAdmin(userId, projectId, [ProjectRole.ADMIN], {
      allowArchived: true,
    });
  }

  async getSettings(userId: string, projectId: string) {
    await this.requireAdmin(userId, projectId);
    const webhook = await this.prisma.projectWebhook.findUnique({ where: { projectId } });
    return { webhook: webhook ? await this.view(webhook) : null };
  }

  /**
   * Creates or changes the webhook. A new webhook gets a signing secret, returned this once; the
   * header values are encrypted and never returned.
   */
  async save(userId: string, projectId: string, dto: SaveWebhookDto, origin: string) {
    await this.requireAdmin(userId, projectId);
    try {
      assertWebhookUrl(dto.url, this.allowPrivate);
    } catch (error) {
      if (error instanceof WebhookAddressError) throw new BadRequestException(error.message);
      throw error;
    }
    const names = (dto.headers ?? []).map((h) => h.name.toLowerCase());
    const reserved = names.filter((n) => RESERVED_HEADERS.has(n) || n.startsWith("x-testops-"));
    if (reserved.length > 0) throw new BadRequestException(`TestOps sets these headers itself: ${reserved.join(", ")}`);
    if (new Set(names).size !== names.length) throw new BadRequestException("Each header can be given once");

    const headers =
      dto.headers === undefined
        ? {}
        : {
            headersEncrypted:
              dto.headers.length > 0
                ? this.box.seal(JSON.stringify(Object.fromEntries(dto.headers.map((h) => [h.name, h.value]))))
                : null,
            headerNames: dto.headers.map((h) => h.name),
          };
    // Fixed here, by an admin, rather than taken from whoever starts a run later.
    const baseUrl = this.publicUrl ?? origin;
    const existing = await this.prisma.projectWebhook.findUnique({ where: { projectId } });
    if (existing) {
      const webhook = await this.prisma.projectWebhook.update({
        where: { projectId },
        data: { url: dto.url, baseUrl, enabled: dto.enabled ?? existing.enabled, ...headers },
      });
      return { webhook: await this.view(webhook), secret: null };
    }
    const secret = randomBytes(32).toString("hex");
    const webhook = await this.prisma.projectWebhook.create({
      data: {
        projectId,
        url: dto.url,
        baseUrl,
        enabled: dto.enabled ?? true,
        secretEncrypted: this.box.seal(secret),
        ...headers,
      },
    });
    return { webhook: await this.view(webhook), secret };
  }

  /** A new signing secret, returned this once; the old one stops working. */
  async regenerateSecret(userId: string, projectId: string) {
    await this.requireAdmin(userId, projectId);
    const secret = randomBytes(32).toString("hex");
    const { count } = await this.prisma.projectWebhook.updateMany({
      where: { projectId },
      data: { secretEncrypted: this.box.seal(secret) },
    });
    if (count === 0) throw new NotFoundException("This project has no webhook");
    return { secret };
  }

  async remove(userId: string, projectId: string) {
    await this.requireAdmin(userId, projectId);
    await this.prisma.projectWebhook.deleteMany({ where: { projectId } });
  }

  /** Sends a test event and returns how it went, so the settings can be checked right away. */
  async ping(userId: string, projectId: string) {
    await this.requireAdmin(userId, projectId);
    const webhook = await this.prisma.projectWebhook.findUnique({ where: { projectId } });
    if (!webhook) throw new NotFoundException("This project has no webhook");
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const base = this.baseUrl(webhook);
    const delivery = await this.deliver({
      webhook,
      event: "ping",
      runId: null,
      payload: {
        testops_url: base,
        api_url: `${base}/api/v1`,
        project: { id: project.id, key: project.key, name: project.name },
      },
    });
    return this.deliveryView(delivery);
  }

  /**
   * Called after a run starts: tells CI about it when the run has cases for automation. It never
   * throws, so a webhook problem can't fail the run; the outcome is recorded as a delivery.
   */
  async runStarted(run: { id: string; projectId: string; source: RunSource }) {
    if (run.source === RunSource.CI) return;
    try {
      const webhook = await this.prisma.projectWebhook.findUnique({ where: { projectId: run.projectId } });
      if (!webhook?.enabled) return;
      const target = await this.runTarget(webhook, run.id);
      if (target) await this.deliver(target);
    } catch (error) {
      this.logger.error(`The webhook for run ${run.id} failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /** "Trigger CI again" on the run page: for people who can run tests, on open runs. */
  async retrigger(userId: string, projectId: string, runId: string) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(userId, projectId, EXECUTE_ROLES);
    const run = await this.prisma.testRun.findFirst({ where: { id: runId, projectId } });
    if (!run) throw new NotFoundException("Run not found");
    if (run.status !== RunStatus.OPEN) throw new BadRequestException("This run is completed; reopen it to trigger CI again");
    const webhook = await this.prisma.projectWebhook.findUnique({ where: { projectId } });
    if (!webhook?.enabled) throw new BadRequestException("This project has no CI webhook, or it is switched off");
    const target = await this.runTarget(webhook, runId);
    if (!target) throw new BadRequestException("No case of this run is set to run by automation");
    return this.deliveryView(await this.deliver(target));
  }

  /** Whether CI was told about the run, for the run page; readable by everyone who can read the run. */
  async runStatus(userId: string, projectId: string, runId: string) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(userId, projectId);
    const run = await this.prisma.testRun.findFirst({ where: { id: runId, projectId }, select: { id: true } });
    if (!run) throw new NotFoundException("Run not found");
    const webhook = await this.prisma.projectWebhook.findUnique({ where: { projectId }, select: { enabled: true } });
    const last = await this.prisma.webhookDelivery.findFirst({
      where: { runId },
      orderBy: { createdAt: "desc" },
    });
    return { configured: Boolean(webhook?.enabled), lastDelivery: last ? this.deliveryView(last) : null };
  }

  // ---------------------------------------------------------------------------

  /** The TestOps address for a webhook's calls: PUBLIC_URL, or the one fixed when it was saved. */
  private baseUrl(webhook: ProjectWebhook) {
    return this.publicUrl ?? webhook.baseUrl;
  }

  /** The run.started call for a run, or null when none of its cases is for automation. */
  private async runTarget(webhook: ProjectWebhook, runId: string): Promise<DeliveryTarget | null> {
    const run = await this.prisma.testRun.findUniqueOrThrow({
      where: { id: runId },
      include: {
        project: { select: { id: true, key: true, name: true } },
        runCases: {
          where: { executionMode: ExecutionMode.AUTOMATED },
          orderBy: { position: "asc" },
          select: { testCaseId: true, testCase: { select: { title: true, tags: true } } },
        },
      },
    });
    if (run.runCases.length === 0) return null;
    const base = this.baseUrl(webhook);
    // The keys of the cases' e2e:<key> tags, for running just these tests (e.g. a grep).
    const keys = [
      ...new Set(run.runCases.flatMap((rc) => rc.testCase.tags.filter((t) => t.startsWith("e2e:")).map((t) => t.slice(4)))),
    ];
    return {
      webhook,
      event: "run.started",
      runId,
      payload: {
        testops_url: base,
        api_url: `${base}/api/v1`,
        project: run.project,
        run: { id: run.id, title: run.title, url: `${base}/projects/${run.projectId}/runs/${run.id}` },
        automated_cases: run.runCases.map((rc) => ({ test_case_id: rc.testCaseId, title: rc.testCase.title, tags: rc.testCase.tags })),
        automation_keys: keys,
      },
    };
  }

  /**
   * Records a delivery and makes the first try; later tries, for a network error, a 5xx or 429,
   * run in the background. Resolves with the delivery as the first try left it.
   */
  private async deliver({ webhook, event, runId, payload }: DeliveryTarget) {
    const delivery = await this.prisma.webhookDelivery.create({ data: { webhookId: webhook.id, runId, event } });
    const secret = this.box.open(webhook.secretEncrypted);
    const extra = webhook.headersEncrypted ? this.box.open(webhook.headersEncrypted) : "{}";
    if (secret === null || extra === null) {
      return this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: WebhookDeliveryStatus.FAILED,
          error: "The webhook's secret or headers can't be read (JWT_SECRET has changed); save the webhook again.",
          completedAt: new Date(),
        },
      });
    }
    const body = JSON.stringify({
      event_type: `testops.${event}`,
      client_payload: { event, delivery_id: delivery.id, ...payload },
    });
    const headers = {
      ...(JSON.parse(extra) as Record<string, string>),
      "content-type": "application/json",
      "user-agent": "TestOps-Webhook",
      "x-testops-event": event,
      "x-testops-delivery": delivery.id,
      "x-testops-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
    };

    const attempt = async (index: number) => {
      let status: number | null = null;
      let error: string | null = null;
      // A refused address stays refused, so it isn't tried again.
      let refused = false;
      try {
        const result = await safePost(new URL(webhook.url), body, headers, { allowPrivate: this.allowPrivate });
        status = result.status;
        if (status < 200 || status >= 300) {
          const reason = answerReason(result.body);
          error = `HTTP ${status}${reason ? `: ${reason}` : ""}`;
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        refused = e instanceof WebhookAddressError;
      }
      const retryable = error !== null && !refused && (status === null || status >= 500 || status === 429);
      const final = error === null || !retryable || index === RETRY_DELAYS_S.length - 1;
      const saved = await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts: index + 1,
          responseCode: status,
          error,
          status: error === null ? WebhookDeliveryStatus.SUCCEEDED : final ? WebhookDeliveryStatus.FAILED : WebhookDeliveryStatus.PENDING,
          completedAt: final ? new Date() : null,
        },
      });
      if (!final) {
        const timer = setTimeout(() => {
          attempt(index + 1).catch((e) => this.logger.error(`Webhook retry failed: ${e instanceof Error ? e.message : e}`));
        }, RETRY_DELAYS_S[index + 1] * 1000);
        timer.unref();
      }
      return saved;
    };
    return attempt(0);
  }

  private async view(webhook: ProjectWebhook) {
    const deliveries = await this.prisma.webhookDelivery.findMany({
      where: { webhookId: webhook.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { run: { select: { id: true, title: true } } },
    });
    return {
      url: webhook.url,
      headerNames: webhook.headerNames,
      enabled: webhook.enabled,
      createdAt: webhook.createdAt,
      updatedAt: webhook.updatedAt,
      deliveries: deliveries.map((d) => ({ ...this.deliveryView(d), run: d.run })),
    };
  }

  private deliveryView(d: {
    id: string;
    event: string;
    status: WebhookDeliveryStatus;
    attempts: number;
    responseCode: number | null;
    error: string | null;
    createdAt: Date;
    completedAt: Date | null;
  }) {
    return {
      id: d.id,
      event: d.event,
      status: d.status,
      attempts: d.attempts,
      responseCode: d.responseCode,
      error: d.error,
      createdAt: d.createdAt,
      completedAt: d.completedAt,
    };
  }
}
