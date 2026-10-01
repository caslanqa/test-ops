import { Injectable, NotFoundException } from "@nestjs/common";
import { ProjectRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccessControlService } from "../common/access-control.service";
import { CreateRequirementDto } from "./dto/create-requirement.dto";
import { UpdateRequirementDto } from "./dto/update-requirement.dto";

const WRITE_ROLES: ProjectRole[] = [ProjectRole.ADMIN, ProjectRole.TESTER];

@Injectable()
export class RequirementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
  ) {}

  async list(userId: string, projectId: string) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    return this.prisma.requirement.findMany({
      where: { projectId, archivedAt: null },
      include: { cases: { include: { testCase: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async getOne(userId: string, projectId: string, requirementId: string) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    const requirement = await this.prisma.requirement.findUnique({
      where: { id: requirementId },
      include: { cases: { include: { testCase: true } } },
    });
    if (!requirement || requirement.projectId !== projectId) {
      throw new NotFoundException("Requirement not found");
    }
    return requirement;
  }

  async create(userId: string, projectId: string, dto: CreateRequirementDto) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    return this.prisma.requirement.create({ data: { projectId, ...dto } });
  }

  async update(
    userId: string,
    projectId: string,
    requirementId: string,
    dto: UpdateRequirementDto,
  ) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.getOne(userId, projectId, requirementId);
    return this.prisma.requirement.update({
      where: { id: requirementId },
      data: dto,
    });
  }

  async archive(userId: string, projectId: string, requirementId: string) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.getOne(userId, projectId, requirementId);
    return this.prisma.requirement.update({
      where: { id: requirementId },
      data: { archivedAt: new Date() },
    });
  }

  async linkCases(
    userId: string,
    projectId: string,
    requirementId: string,
    testCaseIds: string[],
  ) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.getOne(userId, projectId, requirementId);
    await this.accessControl.assertCasesInProject(projectId, testCaseIds);
    await this.prisma.requirementCase.createMany({
      data: testCaseIds.map((testCaseId) => ({ requirementId, testCaseId })),
      skipDuplicates: true,
    });
    return this.getOne(userId, projectId, requirementId);
  }

  async unlinkCase(
    userId: string,
    projectId: string,
    requirementId: string,
    testCaseId: string,
  ) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.getOne(userId, projectId, requirementId);
    const { count } = await this.prisma.requirementCase.deleteMany({
      where: { requirementId, testCaseId },
    });
    if (count === 0) {
      throw new NotFoundException("Test case is not linked to this requirement");
    }
  }

  // FR-022: testsiz requirement'ları ve son test durumlarını gösteren coverage raporu
  async coverage(userId: string, projectId: string) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    const requirements = await this.prisma.requirement.findMany({
      where: { projectId, archivedAt: null },
      include: { cases: { include: { testCase: true } } },
    });

    const result = [];
    for (const requirement of requirements) {
      const caseIds = requirement.cases.map((rc) => rc.testCaseId);
      let lastStatuses: Record<string, number> = {};
      if (caseIds.length > 0) {
        const latestResults = await this.prisma.result.findMany({
          where: { runCase: { testCaseId: { in: caseIds } } },
          orderBy: { createdAt: "desc" },
          take: 200,
          select: { status: true, runCase: { select: { testCaseId: true } } },
        });
        const seen = new Set<string>();
        for (const r of latestResults) {
          if (seen.has(r.runCase.testCaseId)) continue;
          seen.add(r.runCase.testCaseId);
          lastStatuses[r.status] = (lastStatuses[r.status] ?? 0) + 1;
        }
      }
      result.push({
        requirementId: requirement.id,
        title: requirement.title,
        caseCount: caseIds.length,
        hasCoverage: caseIds.length > 0,
        lastResultStatusBreakdown: lastStatuses,
      });
    }
    return result;
  }
}
