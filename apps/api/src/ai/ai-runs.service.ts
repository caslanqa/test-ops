import { ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ProjectRole, type AiWorkflowRun, type AiWorkflowStep } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AccessControlService } from "../common/access-control.service";
import { pageArgs } from "../common/pagination";
import { PrismaService } from "../prisma/prisma.service";
import { AiSettingsService } from "./ai-settings.service";
import { ListRunsQueryDto } from "./dto/list-runs-query.dto";
import { StartRunDto } from "./dto/start-run.dto";

/** Starting and cancelling a run needs the right to create cases, as approving it does. */
const WRITE_ROLES: ProjectRole[] = [ProjectRole.ADMIN, ProjectRole.TESTER];
const DAY_MS = 24 * 60 * 60 * 1000;
const ENTITY = "ai_workflow_run";

/** A step as the API shows it: how it went, never what was sent or answered (that is project data). */
const stepView = (step: AiWorkflowStep) => ({
  name: step.name,
  skillVersion: step.skillVersion,
  status: step.status,
  attempt: step.attempt,
  usage: step.usage,
  error: step.error,
  startedAt: step.startedAt,
  endedAt: step.endedAt,
});

/** A run without its steps and result: enough to list it and to find the one to open. */
const summaryView = (run: AiWorkflowRun) => ({
  id: run.id,
  type: run.type,
  projectId: run.projectId,
  createdById: run.createdById,
  status: run.status,
  input: run.input,
  providerSnapshot: run.providerSnapshot,
  error: run.error,
  createdAt: run.createdAt,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
});

/**
 * Runs of AI workflows: starting one only queues it (the worker does the work, so no request waits for a
 * model), and everything else reads or stops them. Members of a project can read its runs.
 */
@Injectable()
export class AiRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
    private readonly settings: AiSettingsService,
    private readonly audit: AuditService,
  ) {}

  async start(userId: string, projectId: string, dto: StartRunDto) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(userId, projectId, WRITE_ROLES);
    const { source, settings } = await this.settings.resolve(projectId);
    if (!settings || !settings.enabled) throw new ConflictException("AI is not enabled for this project");
    if (settings.credentialCipher && this.settings.openCredential(settings) === null) {
      throw new ConflictException(
        "The saved provider key can't be read, probably because AI_ENCRYPTION_KEY changed; enter it again in the AI settings",
      );
    }
    const requirement = await this.prisma.requirement.findUnique({
      where: { id: dto.requirementId },
      select: { projectId: true, archivedAt: true },
    });
    if (!requirement || requirement.projectId !== projectId || requirement.archivedAt) {
      throw new NotFoundException("Requirement not found");
    }
    // The limit is the person's, across projects: what they started in the last 24 hours.
    const recent = await this.prisma.aiWorkflowRun.count({
      where: { createdById: userId, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
    });
    if (recent >= settings.maxRunsPerUserPerDay) {
      throw new HttpException(
        `You have started ${recent} AI runs in the last 24 hours, which is the most this setting allows`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const run = await this.prisma.aiWorkflowRun.create({
      data: {
        type: dto.type,
        projectId,
        createdById: userId,
        input: { requirementId: dto.requirementId, extraContext: dto.extraContext ?? null },
        providerSnapshot: {
          provider: settings.provider,
          model: settings.model,
          endpointHost: settings.endpoint ? new URL(settings.endpoint).hostname : "api.anthropic.com",
          source,
          settingsId: settings.id,
        },
      },
    });
    await this.audit.record({
      userId,
      projectId,
      action: "ai.run.started",
      entityType: ENTITY,
      entityId: run.id,
      metadata: { requirementId: dto.requirementId },
    });
    return { runId: run.id };
  }

  async get(userId: string, projectId: string, runId: string) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(userId, projectId);
    const run = await this.prisma.aiWorkflowRun.findUnique({
      where: { id: runId },
      include: { steps: { orderBy: [{ startedAt: "asc" }, { attempt: "asc" }] } },
    });
    if (!run || run.projectId !== projectId) throw new NotFoundException("Run not found");
    return { ...summaryView(run), result: run.result, steps: run.steps.map(stepView) };
  }

  /** The runs of a project, newest first, optionally of one requirement; a summary of each. */
  async list(userId: string, projectId: string, query: ListRunsQueryDto) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(userId, projectId);
    const where: Prisma.AiWorkflowRunWhereInput = {
      projectId,
      input: query.requirementId ? { path: ["requirementId"], equals: query.requirementId } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.aiWorkflowRun.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        ...pageArgs(query),
      }),
      this.prisma.aiWorkflowRun.count({ where }),
    ]);
    return { items: items.map(summaryView), total };
  }

  async cancel(userId: string, projectId: string, runId: string) {
    // A project that was archived meanwhile can still have its waiting runs cancelled.
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(userId, projectId, WRITE_ROLES, { allowArchived: true });
    const run = await this.prisma.aiWorkflowRun.findUnique({ where: { id: runId }, select: { projectId: true } });
    if (!run || run.projectId !== projectId) throw new NotFoundException("Run not found");
    const cancelled = await this.prisma.aiWorkflowRun.updateMany({
      where: { id: runId, status: { in: ["QUEUED", "RUNNING", "AWAITING_APPROVAL"] } },
      data: { status: "CANCELLED", finishedAt: new Date(), lockedUntil: null },
    });
    if (cancelled.count === 0) throw new ConflictException("This run has already finished");
    await this.audit.record({ userId, projectId, action: "ai.run.cancelled", entityType: ENTITY, entityId: runId });
    return { runId, status: "CANCELLED" as const };
  }
}
