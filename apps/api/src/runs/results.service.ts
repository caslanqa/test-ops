import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ProjectRole, ResultStatus, RunCase } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccessControlService } from "../common/access-control.service";
import { RunsService, buildCaseSnapshot } from "./runs.service";
import { SubmitResultDto } from "./dto/submit-result.dto";
import { UpdateResultDto } from "./dto/update-result.dto";
import { ListResultsQueryDto } from "./dto/list-results-query.dto";
import { pageArgs } from "../common/pagination";
import { AttachmentFilesService } from "../attachments/attachment-files.service";

const WRITE_ROLES: ProjectRole[] = [
  ProjectRole.ADMIN,
  ProjectRole.TESTER,
  ProjectRole.AUTOMATION,
];

/**
 * Result writes run in one transaction per request. A bulk upload of 500 results has to fit in
 * it, including the wait for other CI jobs that hold locks on the same run cases.
 */
const WRITE_TRANSACTION = { maxWait: 10_000, timeout: 60_000 };

type ResultWithSteps = Prisma.ResultGetPayload<{ include: { stepResults: true } }>;

/** What writing a result needs to know about its run case; kept current during an upload. */
interface AttemptState {
  runCase: RunCase;
  /** Highest attempt number so far; a new attempt continues after it, even past deleted ones. */
  maxAttempt: number;
  /** The latest attempt when the upload started, and as of the items written so far. */
  initialLatestId: string | null;
  latestId: string | null;
  latestStatus: ResultStatus | null;
  /** Result per externalTestId in this run case, for idempotent re-sends (FR-075). */
  resultIdByExternalId: Map<string, string>;
}

/** The fields a submission sets, on a new attempt as well as on an idempotent re-send. */
function resultFields(dto: SubmitResultDto) {
  return {
    status: dto.status,
    comment: dto.comment,
    source: dto.source,
    automationSourceLabel: dto.automationSourceLabel,
    startedAt: dto.startedAt ? new Date(dto.startedAt) : undefined,
    endedAt: dto.endedAt ? new Date(dto.endedAt) : undefined,
    durationMs: dto.durationMs,
    stepResults: dto.stepResults
      ? {
          create: dto.stepResults.map((s) => ({
            stepPosition: s.stepPosition,
            status: s.status,
            comment: s.comment,
          })),
        }
      : undefined,
  };
}

/**
 * The written results in request order. A result written twice in one upload (a repeated
 * externalTestId) is returned in its final form, with isLatest as settled at the end.
 */
function inRequestOrder(
  written: ResultWithSteps[],
  states: Map<string, AttemptState>,
): ResultWithSteps[] {
  const latestIds = new Set([...states.values()].map((state) => state.latestId));
  const finalById = new Map(written.map((result) => [result.id, result]));
  return written.map((result) => ({
    ...finalById.get(result.id)!,
    isLatest: latestIds.has(result.id),
  }));
}

@Injectable()
export class ResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
    private readonly runsService: RunsService,
    private readonly attachmentFiles: AttachmentFilesService,
  ) {}

  async list(userId: string, projectId: string, runId: string) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    await this.ensureRunInProject(projectId, runId);
    return this.prisma.result.findMany({
      where: { runCase: { runId }, isLatest: true },
      include: {
        stepResults: true,
        runCase: {
          include: { testCase: { select: { id: true, title: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async getOne(
    userId: string,
    projectId: string,
    runId: string,
    resultId: string,
  ) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    await this.ensureRunInProject(projectId, runId);
    const result = await this.prisma.result.findUnique({
      where: { id: resultId },
      include: { stepResults: true, attachments: true, runCase: true },
    });
    if (!result || result.runCase.runId !== runId) {
      throw new NotFoundException("Result not found");
    }
    return result;
  }

  /** A single result, written exactly like a one-item bulk upload. */
  async submit(
    userId: string,
    projectId: string,
    runId: string,
    dto: SubmitResultDto,
  ) {
    const { results } = await this.bulkSubmit(userId, projectId, runId, [dto]);
    return results[0];
  }

  /**
   * Writes the results in request order, all or none (FR-074): every case is checked before
   * anything is written, so a client that gets an error can resend the whole upload. An item whose
   * externalTestId is already on a result of its run case updates that result (FR-075); any other
   * item becomes the case's next attempt (FR-043). Cases that aren't in the run yet are added.
   *
   * Writes hold a lock per run case until the transaction ends, so parallel CI jobs posting to the
   * same run (FR-034) can't create duplicate attempts, two latest results or duplicate re-sends.
   */
  async bulkSubmit(
    userId: string,
    projectId: string,
    runId: string,
    items: SubmitResultDto[],
  ) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    // Sorted, because the run cases are locked in this order: two uploads can't deadlock.
    const caseIds = [...new Set(items.map((item) => item.testCaseId))].sort();
    await this.accessControl.assertCasesInProject(projectId, caseIds);

    const results = await this.prisma.$transaction(async (tx) => {
      await this.runsService.assertWritableRun(tx, projectId, runId);
      for (const caseId of caseIds) {
        await this.lockRunCase(tx, runId, caseId);
      }
      const states = await this.loadAttemptStates(tx, runId, items);
      const written: ResultWithSteps[] = [];
      for (const item of items) {
        written.push(
          await this.writeResult(tx, userId, states.get(item.testCaseId)!, item),
        );
      }
      await this.settleLatest(tx, [...states.values()]);
      return inRequestOrder(written, states);
    }, WRITE_TRANSACTION);
    return { count: results.length, results };
  }

  /**
   * Serializes result writes for one case of a run until the transaction ends. The lock is keyed
   * by run and case rather than by a row, so it also covers adding the case to the run.
   */
  private async lockRunCase(
    tx: Prisma.TransactionClient,
    runId: string,
    testCaseId: string,
  ) {
    const key = `result:${runId}:${testCaseId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }

  /**
   * The run cases of the upload's cases, with their attempt state. Cases that aren't in the run
   * yet are added after its last case, in upload order, with a snapshot of the case.
   */
  private async loadAttemptStates(
    tx: Prisma.TransactionClient,
    runId: string,
    items: SubmitResultDto[],
  ) {
    const caseIds = [...new Set(items.map((item) => item.testCaseId))];
    const runCases = await tx.runCase.findMany({
      where: { runId, testCaseId: { in: caseIds } },
    });
    const inRun = new Set(runCases.map((rc) => rc.testCaseId));
    const missing = caseIds.filter((id) => !inRun.has(id));
    if (missing.length > 0) {
      const cases = await tx.testCase.findMany({
        where: { id: { in: missing } },
        include: { steps: { orderBy: { position: "asc" } } },
      });
      const caseById = new Map(cases.map((testCase) => [testCase.id, testCase]));
      const last = await tx.runCase.aggregate({
        where: { runId },
        _max: { position: true },
      });
      const next = (last._max.position ?? -1) + 1;
      await tx.runCase.createMany({
        data: missing.map((testCaseId, index) => ({
          runId,
          testCaseId,
          position: next + index,
          caseSnapshot: buildCaseSnapshot(
            caseById.get(testCaseId)!,
          ) as Prisma.InputJsonValue,
        })),
      });
      runCases.push(
        ...(await tx.runCase.findMany({
          where: { runId, testCaseId: { in: missing } },
        })),
      );
    }

    const runCaseIds = runCases.map((rc) => rc.id);
    const externalIds = [
      ...new Set(items.map((item) => item.externalTestId).filter((id): id is string => !!id)),
    ];
    const maxima = await tx.result.groupBy({
      by: ["runCaseId"],
      where: { runCaseId: { in: runCaseIds } },
      _max: { attemptNumber: true },
    });
    const latest = await tx.result.findMany({
      where: { runCaseId: { in: runCaseIds }, isLatest: true },
      select: { id: true, runCaseId: true, status: true },
    });
    const keyed =
      externalIds.length === 0
        ? []
        : await tx.result.findMany({
            where: { runCaseId: { in: runCaseIds }, externalTestId: { in: externalIds } },
            select: { id: true, runCaseId: true, externalTestId: true },
          });

    const maxByRunCase = new Map(maxima.map((m) => [m.runCaseId, m._max.attemptNumber ?? 0]));
    const latestByRunCase = new Map(latest.map((r) => [r.runCaseId, r]));
    const states = new Map<string, AttemptState>();
    for (const runCase of runCases) {
      const current = latestByRunCase.get(runCase.id);
      states.set(runCase.testCaseId, {
        runCase,
        maxAttempt: maxByRunCase.get(runCase.id) ?? 0,
        initialLatestId: current?.id ?? null,
        latestId: current?.id ?? null,
        latestStatus: current?.status ?? null,
        resultIdByExternalId: new Map(
          keyed
            .filter((r) => r.runCaseId === runCase.id)
            .map((r) => [r.externalTestId!, r.id]),
        ),
      });
    }
    return states;
  }

  /** Writes one upload item: a re-sent externalTestId updates its result, anything else is a new attempt. */
  private async writeResult(
    tx: Prisma.TransactionClient,
    userId: string,
    state: AttemptState,
    item: SubmitResultDto,
  ) {
    const existingId = item.externalTestId
      ? state.resultIdByExternalId.get(item.externalTestId)
      : undefined;
    if (existingId) {
      if (item.stepResults) {
        await tx.stepResult.deleteMany({ where: { resultId: existingId } });
      }
      // Re-sending an older attempt corrects that attempt only; the case keeps its latest status.
      if (existingId === state.latestId) {
        state.latestStatus = item.status;
      }
      return tx.result.update({
        where: { id: existingId },
        data: resultFields(item),
        include: { stepResults: true },
      });
    }

    state.maxAttempt += 1;
    const created = await tx.result.create({
      data: {
        ...resultFields(item),
        runCaseId: state.runCase.id,
        authorUserId: userId,
        externalTestId: item.externalTestId,
        attemptNumber: state.maxAttempt,
        // settleLatest flags the case's last attempt once the whole upload is written.
        isLatest: false,
      },
      include: { stepResults: true },
    });
    state.latestId = created.id;
    state.latestStatus = item.status;
    if (item.externalTestId) {
      state.resultIdByExternalId.set(item.externalTestId, created.id);
    }
    return created;
  }

  /** Moves the latest flag to each case's last attempt; the case status follows it. */
  private async settleLatest(tx: Prisma.TransactionClient, states: AttemptState[]) {
    for (const state of states) {
      if (state.latestId && state.latestId !== state.initialLatestId) {
        await tx.result.updateMany({
          where: { runCaseId: state.runCase.id, isLatest: true },
          data: { isLatest: false },
        });
        await tx.result.update({
          where: { id: state.latestId },
          data: { isLatest: true },
        });
      }
      if (state.latestStatus && state.latestStatus !== state.runCase.status) {
        await tx.runCase.update({
          where: { id: state.runCase.id },
          data: { status: state.latestStatus },
        });
      }
    }
  }

  private async ensureRunInProject(projectId: string, runId: string) {
    const run = await this.prisma.testRun.findUnique({ where: { id: runId } });
    if (!run || run.projectId !== projectId) {
      throw new NotFoundException("Run not found");
    }
    return run;
  }

  /** Results across the whole project, newest first, with the run and test case they belong to. */
  async listForProject(userId: string, projectId: string, query: ListResultsQueryDto) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    const where: Prisma.ResultWhereInput = {
      runCase: {
        run: { projectId },
        runId: query.runId,
        testCaseId: query.testCaseId,
      },
      status: query.status,
      source: query.source,
      isLatest: query.latestOnly ? true : undefined,
      createdAt: {
        gte: query.from ? new Date(query.from) : undefined,
        lte: query.to ? new Date(query.to) : undefined,
      },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.result.findMany({
        where,
        include: {
          runCase: { select: { runId: true, testCaseId: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        ...pageArgs(query),
      }),
      this.prisma.result.count({ where }),
    ]);
    return { items, total };
  }

  /** Corrects a result. Changing the status of the latest attempt also updates the run's case. */
  async update(
    userId: string,
    projectId: string,
    runId: string,
    resultId: string,
    dto: UpdateResultDto,
  ) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    const { runCase } = await this.findInRun(runId, resultId);
    return this.prisma.$transaction(async (tx) => {
      await this.runsService.assertWritableRun(tx, projectId, runId);
      await this.lockRunCase(tx, runId, runCase.testCaseId);
      const result = await tx.result.update({
        where: { id: resultId },
        data: {
          status: dto.status,
          comment: dto.comment,
          automationSourceLabel: dto.automationSourceLabel,
          startedAt: dto.startedAt ? new Date(dto.startedAt) : undefined,
          endedAt: dto.endedAt ? new Date(dto.endedAt) : undefined,
          durationMs: dto.durationMs,
        },
        include: { stepResults: true },
      });
      // isLatest is read under the lock, so a newer attempt from a parallel upload wins.
      if (dto.status && result.isLatest) {
        await tx.runCase.update({
          where: { id: runCase.id },
          data: { status: dto.status },
        });
      }
      return result;
    }, WRITE_TRANSACTION);
  }

  /**
   * Deletes a result and its attachments (project admins only). If it was the latest attempt,
   * the previous attempt becomes the latest and sets the case's status again; with none left
   * the case goes back to untested.
   */
  async remove(userId: string, projectId: string, runId: string, resultId: string) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      [ProjectRole.ADMIN],
    );
    const { runCase } = await this.findInRun(runId, resultId);
    const keys = await this.attachmentFiles.keysFor({
      OR: [{ resultId }, { stepResult: { resultId } }],
    });
    await this.prisma.$transaction(async (tx) => {
      await this.runsService.assertWritableRun(tx, projectId, runId);
      await this.lockRunCase(tx, runId, runCase.testCaseId);
      const deleted = await tx.result.delete({ where: { id: resultId } });
      if (deleted.isLatest) {
        const previous = await tx.result.findFirst({
          where: { runCaseId: runCase.id },
          orderBy: { attemptNumber: "desc" },
        });
        if (previous) {
          await tx.result.update({
            where: { id: previous.id },
            data: { isLatest: true },
          });
        }
        await tx.runCase.update({
          where: { id: runCase.id },
          data: { status: previous?.status ?? ResultStatus.UNTESTED },
        });
      }
    }, WRITE_TRANSACTION);
    await this.attachmentFiles.removeFiles(keys);
  }

  private async findInRun(runId: string, resultId: string) {
    const result = await this.prisma.result.findUnique({
      where: { id: resultId },
      include: { runCase: true },
    });
    if (!result || result.runCase.runId !== runId) {
      throw new NotFoundException("Result not found");
    }
    return result;
  }
}
