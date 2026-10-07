import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ProjectRole, ResultStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccessControlService } from "../common/access-control.service";
import { RunsService } from "./runs.service";
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

  async submit(
    userId: string,
    projectId: string,
    runId: string,
    dto: SubmitResultDto,
  ) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.runsService.assertWritableRun(projectId, runId);

    const runCase = await this.getOrCreateRunCase(
      projectId,
      runId,
      dto.testCaseId,
    );

    // FR-075: idempotency via the external test ID - repeated requests with the
    // same key update the existing result instead of creating a new attempt.
    if (dto.externalTestId) {
      const existing = await this.prisma.result.findFirst({
        where: { runCaseId: runCase.id, externalTestId: dto.externalTestId },
      });
      if (existing) {
        return this.applyResultUpdate(existing.id, runCase.id, dto);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const previousCount = await tx.result.count({
        where: { runCaseId: runCase.id },
      });
      await tx.result.updateMany({
        where: { runCaseId: runCase.id, isLatest: true },
        data: { isLatest: false },
      });
      const result = await tx.result.create({
        data: {
          runCaseId: runCase.id,
          status: dto.status,
          comment: dto.comment,
          source: dto.source,
          authorUserId: userId,
          automationSourceLabel: dto.automationSourceLabel,
          startedAt: dto.startedAt ? new Date(dto.startedAt) : undefined,
          endedAt: dto.endedAt ? new Date(dto.endedAt) : undefined,
          durationMs: dto.durationMs,
          externalTestId: dto.externalTestId,
          attemptNumber: previousCount + 1,
          isLatest: true,
          stepResults: dto.stepResults
            ? {
                create: dto.stepResults.map((s) => ({
                  stepPosition: s.stepPosition,
                  status: s.status,
                  comment: s.comment,
                })),
              }
            : undefined,
        },
        include: { stepResults: true },
      });
      await tx.runCase.update({
        where: { id: runCase.id },
        data: { status: dto.status },
      });
      return result;
    });
  }

  async bulkSubmit(
    userId: string,
    projectId: string,
    runId: string,
    results: SubmitResultDto[],
  ) {
    const created = [];
    for (const dto of results) {
      created.push(await this.submit(userId, projectId, runId, dto));
    }
    return { count: created.length, results: created };
  }

  private async applyResultUpdate(
    resultId: string,
    runCaseId: string,
    dto: SubmitResultDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.stepResults) {
        await tx.stepResult.deleteMany({ where: { resultId } });
      }
      const result = await tx.result.update({
        where: { id: resultId },
        data: {
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
        },
        include: { stepResults: true },
      });
      await tx.runCase.update({
        where: { id: runCaseId },
        data: { status: dto.status },
      });
      return result;
    });
  }

  private async getOrCreateRunCase(
    projectId: string,
    runId: string,
    testCaseId: string,
  ) {
    const existing = await this.prisma.runCase.findUnique({
      where: { runId_testCaseId: { runId, testCaseId } },
    });
    if (existing) return existing;

    const testCase = await this.prisma.testCase.findUnique({
      where: { id: testCaseId },
      include: { steps: { orderBy: { position: "asc" } } },
    });
    if (!testCase || testCase.projectId !== projectId) {
      throw new NotFoundException("Test case not found");
    }
    const lastPosition = await this.prisma.runCase.count({ where: { runId } });
    return this.prisma.runCase.create({
      data: {
        runId,
        testCaseId,
        position: lastPosition,
        caseSnapshot: {
          title: testCase.title,
          preconditions: testCase.preconditions,
          description: testCase.description,
          steps: testCase.steps.map((s) => ({
            position: s.position,
            action: s.action,
            expectedResult: s.expectedResult,
          })),
        } as Prisma.InputJsonValue,
      },
    });
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
    await this.runsService.assertWritableRun(projectId, runId);
    const existing = await this.findInRun(runId, resultId);
    return this.prisma.$transaction(async (tx) => {
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
      if (dto.status && existing.isLatest) {
        await tx.runCase.update({
          where: { id: existing.runCaseId },
          data: { status: dto.status },
        });
      }
      return result;
    });
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
    await this.runsService.assertWritableRun(projectId, runId);
    const existing = await this.findInRun(runId, resultId);
    const keys = await this.attachmentFiles.keysFor({
      OR: [{ resultId }, { stepResult: { resultId } }],
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.result.delete({ where: { id: resultId } });
      if (existing.isLatest) {
        const previous = await tx.result.findFirst({
          where: { runCaseId: existing.runCaseId },
          orderBy: { attemptNumber: "desc" },
        });
        if (previous) {
          await tx.result.update({
            where: { id: previous.id },
            data: { isLatest: true },
          });
        }
        await tx.runCase.update({
          where: { id: existing.runCaseId },
          data: { status: previous?.status ?? ResultStatus.UNTESTED },
        });
      }
    });
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
