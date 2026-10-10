import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ProjectRole, ResultStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccessControlService } from "../common/access-control.service";
import { CreateRequirementDto } from "./dto/create-requirement.dto";
import { UpdateRequirementDto } from "./dto/update-requirement.dto";
import { ListRequirementsQueryDto } from "./dto/list-requirements-query.dto";
import { pageArgs } from "../common/pagination";
import { ListRequirementCasesQueryDto } from "./dto/list-requirement-cases-query.dto";

const WRITE_ROLES: ProjectRole[] = [ProjectRole.ADMIN, ProjectRole.TESTER];

@Injectable()
export class RequirementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
  ) {}

  async list(userId: string, projectId: string, query: ListRequirementsQueryDto) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    const where: Prisma.RequirementWhereInput = {
      projectId,
      archivedAt: query.includeArchived ? undefined : null,
      title: query.q ? { contains: query.q, mode: "insensitive" } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.requirement.findMany({
        where,
        include: { cases: { include: { testCase: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        ...pageArgs(query),
      }),
      this.prisma.requirement.count({ where }),
    ]);
    return { items, total };
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

  /** Brings an archived requirement back into the lists. */
  async restore(userId: string, projectId: string, requirementId: string) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.getOne(userId, projectId, requirementId);
    return this.prisma.requirement.update({
      where: { id: requirementId },
      data: { archivedAt: null },
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

  // FR-022: coverage report showing untested requirements and the latest status of their cases.
  // Linked cases without any result are left out of the breakdown; clients count them as untested.
  async coverage(userId: string, projectId: string) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    const requirements = await this.prisma.requirement.findMany({
      where: { projectId, archivedAt: null },
      select: { id: true, title: true, cases: { select: { testCaseId: true } } },
    });
    const latestStatus = await this.latestStatusByCase(projectId, [
      ...new Set(requirements.flatMap((r) => r.cases.map((rc) => rc.testCaseId))),
    ]);

    return requirements.map((requirement) => {
      const lastResultStatusBreakdown: Record<string, number> = {};
      for (const { testCaseId } of requirement.cases) {
        const status = latestStatus.get(testCaseId);
        if (status) {
          lastResultStatusBreakdown[status] = (lastResultStatusBreakdown[status] ?? 0) + 1;
        }
      }
      return {
        requirementId: requirement.id,
        title: requirement.title,
        caseCount: requirement.cases.length,
        hasCoverage: requirement.cases.length > 0,
        lastResultStatusBreakdown,
      };
    });
  }

  /**
   * The status of each case's most recent result across the project's runs, in one query. Every
   * case is ranked on its own, so a case that runs often can't push the others out of the report.
   * Only the latest attempt in each run is a candidate, so a retry wins over the attempts it replaced.
   */
  private async latestStatusByCase(projectId: string, testCaseIds: string[]) {
    if (testCaseIds.length === 0) return new Map<string, ResultStatus>();
    const rows = await this.prisma.$queryRaw<{ testCaseId: string; status: ResultStatus }[]>`
      SELECT DISTINCT ON (rc."testCaseId") rc."testCaseId", r."status"
      FROM "results" r
      JOIN "run_cases" rc ON rc."id" = r."runCaseId"
      JOIN "test_runs" tr ON tr."id" = rc."runId"
      WHERE tr."projectId" = ${projectId}
        AND rc."testCaseId" = ANY(${testCaseIds})
        AND r."isLatest"
      ORDER BY rc."testCaseId", r."createdAt" DESC, r."attemptNumber" DESC, r."id" DESC`;
    return new Map(rows.map((row) => [row.testCaseId, row.status]));
  }

  /** The test cases linked to a requirement, as a paged list of cases. */
  async listCases(
    userId: string,
    projectId: string,
    requirementId: string,
    query: ListRequirementCasesQueryDto,
  ) {
    await this.getOne(userId, projectId, requirementId);
    const where: Prisma.TestCaseWhereInput = {
      archivedAt: null,
      requirements: { some: { requirementId } },
      title: query.q ? { contains: query.q, mode: "insensitive" } : undefined,
    };
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
}
