import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ProjectRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccessControlService } from "../common/access-control.service";
import { RunsService } from "./runs.service";
import { SubmitResultDto } from "./dto/submit-result.dto";

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
      throw new NotFoundException("Sonuç bulunamadı");
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

    // FR-075: dış test kimliği üzerinden idempotency - aynı anahtarla gelen
    // tekrar istekler yeni attempt yaratmak yerine mevcut sonucu günceller.
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
      throw new NotFoundException("Test case bulunamadı");
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
      throw new NotFoundException("Run bulunamadı");
    }
    return run;
  }
}
