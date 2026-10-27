import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ProjectRole, type AiWorkflowRun, type AiWorkflowStep } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AccessControlService } from "../common/access-control.service";
import { pageArgs } from "../common/pagination";
import { PrismaService } from "../prisma/prisma.service";
import { TestCasesService } from "../test-cases/test-cases.service";
import { AiSettingsService } from "./ai-settings.service";
import { snapshotOf } from "./ai-snapshot";
import { ApproveRunDto } from "./dto/approve-run.dto";
import { ListRunsQueryDto } from "./dto/list-runs-query.dto";
import { GuidanceSelectionDto, StartRunDto } from "./dto/start-run.dto";
import { GuidanceResolver } from "./guidance/guidance-resolver.service";
import { buildSnapshot, publicSnapshot, sameSelection, type GuidanceSnapshot } from "./guidance/guidance-snapshot";
import type { GuidanceSelection } from "./guidance/resolve-guidance";

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
  mode: step.mode,
  guidanceTokens: step.guidanceTokens,
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
  /** The comparison this run is a side of, and which side; both null for an ordinary run. */
  comparisonId: run.comparisonId,
  comparisonSide: run.comparisonSide,
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
    private readonly testCases: TestCasesService,
    private readonly guidanceResolver: GuidanceResolver,
  ) {}

  /**
   * What every start of a run (or of two, for a comparison) has to pass: the right to start, AI switched on with a key
   * that can be read, and a requirement of this project that is not archived. Returns what the run needs from them.
   */
  async prepareStart(userId: string, projectId: string, requirementId: string) {
    const access = await this.accessControl.requireProjectRoleOrWorkspaceAdmin(userId, projectId, WRITE_ROLES);
    const { source, settings } = await this.settings.resolve(projectId);
    if (!settings || !settings.enabled) throw new ConflictException("AI is not enabled for this project");
    if (settings.credentialCipher && this.settings.openCredential(settings) === null) {
      throw new ConflictException(
        "The saved provider key can't be read, probably because AI_ENCRYPTION_KEY changed; enter it again in the AI settings",
      );
    }
    const requirement = await this.prisma.requirement.findUnique({
      where: { id: requirementId },
      select: { projectId: true, archivedAt: true },
    });
    if (!requirement || requirement.projectId !== projectId || requirement.archivedAt) {
      throw new NotFoundException("Requirement not found");
    }
    return { access, source, settings };
  }

  async start(userId: string, projectId: string, dto: StartRunDto) {
    const { access, source, settings } = await this.prepareStart(userId, projectId, dto.requirementId);
    // The guidance is resolved now, once, and the run keeps what came of it (text included): the steps never read the
    // live guidance. Before the transaction, so a selection that names what the project can't see is refused first.
    const selection = this.selectionOf(dto.guidance);
    // Only an admin may name guidance that is not in effect: it is a draft, and a run sends all of it to the model.
    const snapshot = await buildSnapshot(this.guidanceResolver, projectId, selection, {
      inEffectOnly: access.role !== ProjectRole.ADMIN,
    });
    const { run, created } = await this.prisma.$transaction(async (tx) => {
      // One start at a time per person: without this, starts that arrive together are all counted before any
      // of them is saved, and the limit lets them all through.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-run-start:${userId}`}))`;
      // The same start twice, such as a double click, is one run: the one that is already queued or working. It
      // doesn't count against the limit and isn't audited again. A side of a comparison is not an ordinary run.
      const open = await tx.aiWorkflowRun.findMany({
        where: { createdById: userId, projectId, comparisonId: null, status: { in: ["QUEUED", "RUNNING"] } },
      });
      const same = open.find((candidate) => {
        const input = candidate.input as { requirementId?: string; extraContext?: string | null };
        return (
          input.requirementId === dto.requirementId &&
          (input.extraContext ?? null) === (dto.extraContext ?? null) &&
          sameSelection(candidate.guidance as unknown as GuidanceSnapshot | null, selection)
        );
      });
      if (same) return { run: same, created: false };
      // The limit is the person's, across projects: what they started in the last 24 hours.
      const recent = await tx.aiWorkflowRun.count({
        where: { createdById: userId, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
      });
      if (recent >= settings.maxRunsPerUserPerDay) {
        throw new HttpException(
          `You have started ${recent} AI runs in the last 24 hours, which is the most this setting allows`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const made = await tx.aiWorkflowRun.create({
        data: {
          type: dto.type,
          projectId,
          createdById: userId,
          input: { requirementId: dto.requirementId, extraContext: dto.extraContext ?? null },
          providerSnapshot: snapshotOf(source, settings),
          guidance: snapshot as unknown as Prisma.InputJsonValue,
        },
      });
      return { run: made, created: true };
    });
    if (created) {
      await this.audit.record({
        userId,
        projectId,
        action: "ai.run.started",
        entityType: ENTITY,
        entityId: run.id,
        metadata: { requirementId: dto.requirementId },
      });
    }
    return { runId: run.id };
  }

  async get(userId: string, projectId: string, runId: string) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(userId, projectId);
    const run = await this.prisma.aiWorkflowRun.findUnique({
      where: { id: runId },
      include: { steps: { orderBy: [{ startedAt: "asc" }, { attempt: "asc" }] } },
    });
    if (!run || run.projectId !== projectId) throw new NotFoundException("Run not found");
    return {
      ...summaryView(run),
      // What the run was sent of the team's guidance: titles, versions and sizes, never the text.
      guidance: publicSnapshot(run.guidance as unknown as GuidanceSnapshot | null),
      result: run.result,
      steps: run.steps.map(stepView),
    };
  }

  /** The selection a start asks for: what applies now unless it says otherwise; `ids` belong to a list only. */
  selectionOf(asked: GuidanceSelectionDto | undefined): GuidanceSelection {
    if (!asked) return { mode: "EFFECTIVE" };
    if (asked.mode !== "LIST") {
      if (asked.ids !== undefined) throw new BadRequestException("ids go with mode LIST");
      return { mode: asked.mode };
    }
    return { mode: "LIST", ids: asked.ids ?? [] };
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

  /**
   * Writes the drafts a person approved as test cases, linked to the requirement and tagged `ai-generated`
   * and with their kind, through the same service and permission checks as any other new case. The run is
   * claimed first with a compare-and-set, so two approvals at once write the drafts once; if writing fails the
   * claim is given back and the run can be approved again.
   */
  async approve(userId: string, projectId: string, runId: string, dto: ApproveRunDto) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(userId, projectId, WRITE_ROLES);
    const run = await this.prisma.aiWorkflowRun.findUnique({ where: { id: runId } });
    if (!run || run.projectId !== projectId) throw new NotFoundException("Run not found");
    if (run.status !== "AWAITING_APPROVAL") throw new ConflictException("This run isn't waiting for approval");
    const requirementId = (run.input as { requirementId: string }).requirementId;
    const requirement = await this.prisma.requirement.findUnique({
      where: { id: requirementId },
      select: { projectId: true, archivedAt: true },
    });
    if (!requirement || requirement.projectId !== projectId) throw new NotFoundException("Requirement not found");
    if (requirement.archivedAt) {
      throw new ConflictException("The requirement is archived; restore it to approve these drafts");
    }
    await this.accessControl.assertSuiteInProject(projectId, dto.suiteId);

    const claimed = await this.prisma.aiWorkflowRun.updateMany({
      where: { id: runId, status: "AWAITING_APPROVAL" },
      data: { status: "COMPLETED", finishedAt: new Date() },
    });
    if (claimed.count === 0) throw new ConflictException("This run isn't waiting for approval");

    let created: { id: string }[];
    try {
      ({ cases: created } = await this.testCases.createMany(userId, projectId, {
        cases: dto.cases.map((draft) => ({
          suiteId: dto.suiteId,
          title: draft.title.trim(),
          preconditions: draft.preconditions,
          steps: draft.steps,
          priority: draft.priority,
          type: draft.type,
          tags: ["ai-generated", draft.kind],
          requirementIds: [requirementId],
        })),
      }));
    } catch (error) {
      await this.prisma.aiWorkflowRun.updateMany({
        where: { id: runId, status: "COMPLETED" },
        data: { status: "AWAITING_APPROVAL", finishedAt: null },
      });
      throw error;
    }
    // The cases exist now; from here on a failure must not give the run back, or they would be written twice.
    const createdCaseIds = created.map((testCase) => testCase.id);
    await this.prisma.aiWorkflowRun.update({
      where: { id: runId },
      data: { result: { ...(run.result as object), createdCaseIds } },
    });
    await this.audit.record({
      userId,
      projectId,
      action: "ai.run.approved",
      entityType: ENTITY,
      entityId: runId,
      metadata: { createdCaseIds },
    });
    return { runId, createdCaseIds };
  }
}
