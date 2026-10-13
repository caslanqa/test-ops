import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ProjectRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccessControlService } from "../common/access-control.service";
import { CreateTestCaseDto } from "./dto/create-test-case.dto";
import { UpdateTestCaseDto } from "./dto/update-test-case.dto";
import { ListTestCasesQueryDto } from "./dto/list-test-cases-query.dto";
import { pageArgs } from "../common/pagination";
import { BulkCreateTestCasesDto } from "./dto/bulk-create-test-cases.dto";

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
    query: ListTestCasesQueryDto,
  ) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    const where: Prisma.TestCaseWhereInput = {
      projectId,
      suiteId: query.suiteId,
      archivedAt: query.includeArchived ? undefined : null,
      priority: query.priority,
      severity: query.severity,
      type: query.type,
      automationStatus: query.automationStatus,
      title: query.q ? { contains: query.q, mode: "insensitive" } : undefined,
    };
    // `id` breaks ties between equal timestamps so pages never repeat or skip items.
    const [items, total] = await this.prisma.$transaction([
      this.prisma.testCase.findMany({
        where,
        include: { steps: { orderBy: { position: "asc" } } },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        ...pageArgs(query),
      }),
      this.prisma.testCase.count({ where }),
    ]);
    return { items, total };
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

  /** Brings an archived case back into the lists. */
  async restore(userId: string, projectId: string, caseId: string) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.getOne(userId, projectId, caseId);
    return this.prisma.testCase.update({
      where: { id: caseId },
      data: { archivedAt: null },
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

  /**
   * Creates many cases in one transaction: either all are created or none, so a client that
   * gets an error can simply retry the whole request.
   */
  async createMany(userId: string, projectId: string, dto: BulkCreateTestCasesDto) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    const suiteIds = [...new Set(dto.cases.map((c) => c.suiteId).filter(Boolean))];
    for (const suiteId of suiteIds) {
      await this.accessControl.assertSuiteInProject(projectId, suiteId);
    }
    const items = await this.prisma.$transaction(
      dto.cases.map((c) =>
        this.prisma.testCase.create({
          data: {
            projectId,
            suiteId: c.suiteId,
            title: c.title,
            preconditions: c.preconditions,
            description: c.description,
            priority: c.priority,
            severity: c.severity,
            type: c.type,
            automationStatus: c.automationStatus,
            tags: c.tags ?? [],
            customFields: c.customFields as Prisma.InputJsonValue,
            createdById: userId,
            steps: c.steps
              ? {
                  create: c.steps.map((step, index) => ({
                    position: index,
                    action: step.action,
                    expectedResult: step.expectedResult,
                  })),
                }
              : undefined,
          },
          include: { steps: true },
        }),
      ),
    );
    return { count: items.length, cases: items };
  }
}
