import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ProjectRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccessControlService } from "../common/access-control.service";
import { CreatePlanDto } from "./dto/create-plan.dto";
import { UpdatePlanDto } from "./dto/update-plan.dto";
import { ListPlansQueryDto } from "./dto/list-plans-query.dto";
import { pageArgs } from "../common/pagination";

const WRITE_ROLES: ProjectRole[] = [ProjectRole.ADMIN, ProjectRole.TESTER];

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
  ) {}

  async list(userId: string, projectId: string, query: ListPlansQueryDto) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    const where: Prisma.TestPlanWhereInput = {
      projectId,
      archivedAt: null,
      milestoneId: query.milestoneId,
      title: query.q ? { contains: query.q, mode: "insensitive" } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.testPlan.findMany({
        where,
        include: { _count: { select: { items: true, runs: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        ...pageArgs(query),
      }),
      this.prisma.testPlan.count({ where }),
    ]);
    return { items, total };
  }

  async getOne(userId: string, projectId: string, planId: string) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    const plan = await this.prisma.testPlan.findUnique({
      where: { id: planId },
      include: { items: { include: { testCase: true } } },
    });
    if (!plan || plan.projectId !== projectId) {
      throw new NotFoundException("Plan not found");
    }
    return plan;
  }

  async create(userId: string, projectId: string, dto: CreatePlanDto) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.accessControl.assertCasesInProject(
      projectId,
      dto.testCaseIds ?? [],
    );
    await this.accessControl.assertMilestoneInProject(
      projectId,
      dto.milestoneId,
    );
    return this.prisma.testPlan.create({
      data: {
        projectId,
        title: dto.title,
        description: dto.description,
        milestoneId: dto.milestoneId,
        environment: dto.environment,
        configuration: dto.configuration,
        createdById: userId,
        items: dto.testCaseIds
          ? {
              create: dto.testCaseIds.map((testCaseId, index) => ({
                testCaseId,
                position: index,
              })),
            }
          : undefined,
      },
      include: { items: true },
    });
  }

  async update(
    userId: string,
    projectId: string,
    planId: string,
    dto: UpdatePlanDto,
  ) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.getOne(userId, projectId, planId);
    await this.accessControl.assertMilestoneInProject(
      projectId,
      dto.milestoneId,
    );
    return this.prisma.testPlan.update({ where: { id: planId }, data: dto });
  }

  async archive(userId: string, projectId: string, planId: string) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.getOne(userId, projectId, planId);
    return this.prisma.testPlan.update({
      where: { id: planId },
      data: { archivedAt: new Date() },
    });
  }

  async addCases(
    userId: string,
    projectId: string,
    planId: string,
    testCaseIds: string[],
  ) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.getOne(userId, projectId, planId);
    await this.accessControl.assertCasesInProject(projectId, testCaseIds);
    await this.prisma.planCase.createMany({
      data: testCaseIds.map((testCaseId) => ({ planId, testCaseId })),
      skipDuplicates: true,
    });
    return this.getOne(userId, projectId, planId);
  }

  async removeCase(
    userId: string,
    projectId: string,
    planId: string,
    testCaseId: string,
  ) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.getOne(userId, projectId, planId);
    const { count } = await this.prisma.planCase.deleteMany({
      where: { planId, testCaseId },
    });
    if (count === 0) {
      throw new NotFoundException("Test case is not in this plan");
    }
  }

  // FR-036: flat test case ID list that automation clients use for
  // selective execution.
  async caseIds(userId: string, projectId: string, planId: string) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    const plan = await this.prisma.testPlan.findUnique({
      where: { id: planId },
      select: { projectId: true, items: { select: { testCaseId: true } } },
    });
    if (!plan || plan.projectId !== projectId) {
      throw new NotFoundException("Plan not found");
    }
    return { testCaseIds: plan.items.map((i) => i.testCaseId) };
  }
}
