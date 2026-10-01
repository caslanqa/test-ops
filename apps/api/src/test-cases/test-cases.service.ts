import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ProjectRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccessControlService } from "../common/access-control.service";
import { CreateTestCaseDto } from "./dto/create-test-case.dto";
import { UpdateTestCaseDto } from "./dto/update-test-case.dto";

const WRITE_ROLES: ProjectRole[] = [ProjectRole.ADMIN, ProjectRole.TESTER];

@Injectable()
export class TestCasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
  ) {}

  async list(
    userId: string,
    projectId: string,
    filters: { suiteId?: string; includeArchived?: boolean },
  ) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    return this.prisma.testCase.findMany({
      where: {
        projectId,
        suiteId: filters.suiteId,
        archivedAt: filters.includeArchived ? undefined : null,
      },
      include: { steps: { orderBy: { position: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async getOne(userId: string, projectId: string, caseId: string) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    const testCase = await this.prisma.testCase.findUnique({
      where: { id: caseId },
      include: {
        steps: { orderBy: { position: "asc" } },
        requirements: { include: { requirement: true } },
      },
    });
    if (!testCase || testCase.projectId !== projectId) {
      throw new NotFoundException("Test case not found");
    }
    return testCase;
  }

  async create(userId: string, projectId: string, dto: CreateTestCaseDto) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.accessControl.assertSuiteInProject(projectId, dto.suiteId);
    return this.prisma.testCase.create({
      data: {
        projectId,
        suiteId: dto.suiteId,
        title: dto.title,
        preconditions: dto.preconditions,
        description: dto.description,
        priority: dto.priority,
        severity: dto.severity,
        type: dto.type,
        automationStatus: dto.automationStatus,
        tags: dto.tags ?? [],
        customFields: dto.customFields as Prisma.InputJsonValue,
        createdById: userId,
        steps: dto.steps
          ? {
              create: dto.steps.map((step, index) => ({
                position: index,
                action: step.action,
                expectedResult: step.expectedResult,
              })),
            }
          : undefined,
      },
      include: { steps: true },
    });
  }

  async update(
    userId: string,
    projectId: string,
    caseId: string,
    dto: UpdateTestCaseDto,
  ) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    const before = await this.getOne(userId, projectId, caseId);
    await this.accessControl.assertSuiteInProject(projectId, dto.suiteId);

    return this.prisma.$transaction(async (tx) => {
      if (dto.steps) {
        await tx.testCaseStep.deleteMany({ where: { testCaseId: caseId } });
      }
      const updated = await tx.testCase.update({
        where: { id: caseId },
        data: {
          suiteId: dto.suiteId,
          title: dto.title,
          preconditions: dto.preconditions,
          description: dto.description,
          priority: dto.priority,
          severity: dto.severity,
          type: dto.type,
          automationStatus: dto.automationStatus,
          tags: dto.tags,
          customFields: dto.customFields as Prisma.InputJsonValue,
          steps: dto.steps
            ? {
                create: dto.steps.map((step, index) => ({
                  position: index,
                  action: step.action,
                  expectedResult: step.expectedResult,
                })),
              }
            : undefined,
        },
        include: { steps: { orderBy: { position: "asc" } } },
      });
      await tx.testCaseHistory.create({
        data: {
          testCaseId: caseId,
          changedById: userId,
          summary: { before, after: updated } as Prisma.InputJsonValue,
        },
      });
      return updated;
    });
  }

  async archive(userId: string, projectId: string, caseId: string) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.getOne(userId, projectId, caseId);
    return this.prisma.testCase.update({
      where: { id: caseId },
      data: { archivedAt: new Date() },
    });
  }

  async history(userId: string, projectId: string, caseId: string) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    await this.getOne(userId, projectId, caseId);
    return this.prisma.testCaseHistory.findMany({
      where: { testCaseId: caseId },
      orderBy: { changedAt: "desc" },
    });
  }
}
