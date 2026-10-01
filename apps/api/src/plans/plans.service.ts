import { Injectable, NotFoundException } from "@nestjs/common";
import { ProjectRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccessControlService } from "../common/access-control.service";
import { CreatePlanDto } from "./dto/create-plan.dto";
import { UpdatePlanDto } from "./dto/update-plan.dto";

const WRITE_ROLES: ProjectRole[] = [ProjectRole.ADMIN, ProjectRole.TESTER];

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
  ) {}

  async list(userId: string, projectId: string) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    return this.prisma.testPlan.findMany({
      where: { projectId, archivedAt: null },
      include: { _count: { select: { items: true, runs: true } } },
      orderBy: { createdAt: "desc" },
    });
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

  // FR-036: otomasyon istemcilerinin seçici çalıştırma (selective execution) için
  // kullandığı düz case ID listesi.
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
