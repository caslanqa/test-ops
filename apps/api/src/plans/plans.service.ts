import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AutomationStatus, ExecutionMode, Prisma, ProjectRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccessControlService } from "../common/access-control.service";
import { CreatePlanDto } from "./dto/create-plan.dto";
import { AddPlanCasesDto } from "./dto/add-plan-cases.dto";
import { UpdatePlanDto } from "./dto/update-plan.dto";
import { ListPlansQueryDto } from "./dto/list-plans-query.dto";
import { pageArgs } from "../common/pagination";

const WRITE_ROLES: ProjectRole[] = [ProjectRole.ADMIN, ProjectRole.TESTER];

/** A change to cases of a plan; a field left out stays as it is. */
interface PlanCaseChanges {
  assigneeId?: string | null;
  executionMode?: ExecutionMode;
}

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
      archivedAt: query.includeArchived ? undefined : null,
      milestoneId: query.milestoneId,
      title: query.q ? { contains: query.q, mode: "insensitive" } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.testPlan.findMany({
        where,
        // `items` counts the active cases only: archived ones stay in the plan but can't start a run,
        // so clients decide from this number whether a run can be started from the plan.
        include: {
          _count: {
            select: { items: { where: { testCase: { archivedAt: null } } }, runs: true },
          },
        },
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
      include: { items: { include: { testCase: true }, orderBy: { position: "asc" } } },
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
    await this.accessControl.assertAssignableUser(projectId, dto.assigneeId);
    const modes = await this.definedModes(dto.testCaseIds ?? []);
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
              create: [...new Set(dto.testCaseIds)].map((testCaseId, index) => ({
                testCaseId,
                position: index,
                assigneeId: dto.assigneeId,
                executionMode: modes.get(testCaseId),
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

  /** Brings an archived plan back into the lists. */
  async restore(userId: string, projectId: string, planId: string) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.getOne(userId, projectId, planId);
    return this.prisma.testPlan.update({
      where: { id: planId },
      data: { archivedAt: null },
    });
  }

  async addCases(
    userId: string,
    projectId: string,
    planId: string,
    dto: AddPlanCasesDto,
  ) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.getOne(userId, projectId, planId);
    await this.accessControl.assertCasesInProject(projectId, dto.testCaseIds);
    await this.accessControl.assertAssignableUser(projectId, dto.assigneeId);
    const modes = await this.definedModes(dto.testCaseIds);
    // Added cases go to the end, in the order given; cases already in the plan stay as they are.
    // The next position is read and used under a lock per plan, so parallel adds can't both take
    // the same positions.
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`plan-items:${planId}`}, 0))`;
      const last = await tx.planCase.aggregate({
        where: { planId },
        _max: { position: true },
      });
      const start = (last._max.position ?? -1) + 1;
      await tx.planCase.createMany({
        data: [...new Set(dto.testCaseIds)].map((testCaseId, index) => ({
          planId,
          testCaseId,
          position: start + index,
          assigneeId: dto.assigneeId,
          executionMode: modes.get(testCaseId),
        })),
        skipDuplicates: true,
      });
    });
    return this.getOne(userId, projectId, planId);
  }

  /** How each case runs when it joins a plan: as the case is defined (its automation status). */
  private async definedModes(testCaseIds: string[]): Promise<Map<string, ExecutionMode>> {
    if (testCaseIds.length === 0) return new Map();
    const cases = await this.prisma.testCase.findMany({
      where: { id: { in: [...new Set(testCaseIds)] } },
      select: { id: true, automationStatus: true },
    });
    return new Map(
      cases.map((c) => [
        c.id,
        c.automationStatus === AutomationStatus.AUTOMATED ? ExecutionMode.AUTOMATED : ExecutionMode.MANUAL,
      ]),
    );
  }

  /**
   * Checks a change to plan cases and turns it into the update: who tests them (null unassigns)
   * and/or how they run. Fields left out stay as they are.
   */
  private async planCaseChanges(projectId: string, changes: PlanCaseChanges): Promise<Prisma.PlanCaseUpdateManyMutationInput> {
    if (changes.assigneeId === undefined && changes.executionMode === undefined) {
      throw new BadRequestException("Send assigneeId, executionMode or both.");
    }
    if (changes.assigneeId !== undefined) {
      await this.accessControl.assertAssignableUser(projectId, changes.assigneeId);
    }
    return {
      ...(changes.assigneeId !== undefined ? { assigneeId: changes.assigneeId } : {}),
      ...(changes.executionMode !== undefined ? { executionMode: changes.executionMode } : {}),
    };
  }

  /**
   * Sets who tests several cases of the plan and/or how they run: all of them, or none if one
   * isn't in the plan. Runs started from the plan take both over.
   */
  async updateCases(
    userId: string,
    projectId: string,
    planId: string,
    testCaseIds: string[],
    changes: PlanCaseChanges,
  ) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(userId, projectId, WRITE_ROLES);
    await this.getOne(userId, projectId, planId);
    const data = await this.planCaseChanges(projectId, changes);
    const ids = [...new Set(testCaseIds)];
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.planCase.count({ where: { planId, testCaseId: { in: ids } } });
      if (found !== ids.length) throw new NotFoundException("Some of the test cases are not in this plan");
      const { count } = await tx.planCase.updateMany({ where: { planId, testCaseId: { in: ids } }, data });
      return { count };
    });
  }

  /** Sets who tests a case of the plan and/or how it runs; runs started from the plan take both over. */
  async updateCase(
    userId: string,
    projectId: string,
    planId: string,
    testCaseId: string,
    changes: PlanCaseChanges,
  ) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.getOne(userId, projectId, planId);
    const data = await this.planCaseChanges(projectId, changes);
    const { count } = await this.prisma.planCase.updateMany({
      where: { planId, testCaseId },
      data,
    });
    if (count === 0) {
      throw new NotFoundException("Test case is not in this plan");
    }
    return this.prisma.planCase.findUniqueOrThrow({
      where: { planId_testCaseId: { planId, testCaseId } },
    });
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
      select: {
        projectId: true,
        items: { select: { testCaseId: true }, orderBy: { position: "asc" } },
      },
    });
    if (!plan || plan.projectId !== projectId) {
      throw new NotFoundException("Plan not found");
    }
    return { testCaseIds: plan.items.map((i) => i.testCaseId) };
  }
}
