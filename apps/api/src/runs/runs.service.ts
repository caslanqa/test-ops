import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as crypto from "crypto";
import { Prisma, ProjectRole, RunStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccessControlService } from "../common/access-control.service";
import { CreateRunDto } from "./dto/create-run.dto";
import { UpdateRunDto } from "./dto/update-run.dto";
import { ListRunsQueryDto } from "./dto/list-runs-query.dto";
import { pageArgs } from "../common/pagination";
import { AttachmentFilesService } from "../attachments/attachment-files.service";

const WRITE_ROLES: ProjectRole[] = [
  ProjectRole.ADMIN,
  ProjectRole.TESTER,
  ProjectRole.AUTOMATION,
];

/** The copy of a case a run keeps, so its results stay readable when the case changes later. */
export function buildCaseSnapshot(testCase: {
  title: string;
  preconditions: string | null;
  description: string | null;
  steps: { position: number; action: string; expectedResult: string | null }[];
}) {
  return {
    title: testCase.title,
    preconditions: testCase.preconditions,
    description: testCase.description,
    steps: testCase.steps.map((s) => ({
      position: s.position,
      action: s.action,
      expectedResult: s.expectedResult,
    })),
  };
}

@Injectable()
export class RunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
    private readonly attachmentFiles: AttachmentFilesService,
  ) {}

  async list(userId: string, projectId: string, query: ListRunsQueryDto) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    const where: Prisma.TestRunWhereInput = {
      projectId,
      status: query.status,
      planId: query.planId,
      milestoneId: query.milestoneId,
      title: query.q ? { contains: query.q, mode: "insensitive" } : undefined,
      runCases: query.assigneeId ? { some: { assigneeId: query.assigneeId } } : undefined,
    };
    const [runs, total] = await this.prisma.$transaction([
      this.prisma.testRun.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        ...pageArgs(query),
      }),
      this.prisma.testRun.count({ where }),
    ]);
    // Per-run status counts for the result bar in the list view; computed with a
    // single groupBy query instead of fetching every runCase row.
    const counts = await this.prisma.runCase.groupBy({
      by: ["runId", "status"],
      where: { runId: { in: runs.map((r) => r.id) } },
      _count: { _all: true },
    });
    const progressByRun = new Map<string, Record<string, number>>();
    for (const row of counts) {
      const progress = progressByRun.get(row.runId) ?? {};
      progress[row.status] = row._count._all;
      progressByRun.set(row.runId, progress);
    }
    const items = runs.map((run) => ({
      ...run,
      progress: progressByRun.get(run.id) ?? {},
    }));
    return { items, total };
  }

  async getOne(userId: string, projectId: string, runId: string) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    const run = await this.prisma.testRun.findUnique({
      where: { id: runId },
      include: {
        runCases: {
          include: { testCase: { select: { id: true, title: true } } },
          orderBy: { position: "asc" },
        },
      },
    });
    if (!run || run.projectId !== projectId) {
      throw new NotFoundException("Run not found");
    }
    const progress = run.runCases.reduce<Record<string, number>>((acc, rc) => {
      acc[rc.status] = (acc[rc.status] ?? 0) + 1;
      return acc;
    }, {});
    return { ...run, progress };
  }

  async create(userId: string, projectId: string, dto: CreateRunDto) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );

    await this.accessControl.assertMilestoneInProject(
      projectId,
      dto.milestoneId,
    );

    // The run's cases in order, with who tests each.
    let items: { testCaseId: string; assigneeId: string | null }[] = [];
    let plan: { milestoneId: string | null; environment: string | null; configuration: string | null } | null = null;
    if (dto.planId) {
      const found = await this.prisma.testPlan.findUnique({
        where: { id: dto.planId },
        include: {
          // Cases archived since they were planned are left out of new runs.
          items: { where: { testCase: { archivedAt: null } }, orderBy: { position: "asc" } },
        },
      });
      if (!found || found.projectId !== projectId) {
        throw new NotFoundException("Plan not found");
      }
      plan = found;
      // The plan's assignments carry over, except for people who lost access to the project since.
      const assignable = await this.accessControl.assignableUserIds(
        projectId,
        found.items.flatMap((i) => (i.assigneeId ? [i.assigneeId] : [])),
      );
      items = found.items.map((i) => ({
        testCaseId: i.testCaseId,
        assigneeId: i.assigneeId && assignable.has(i.assigneeId) ? i.assigneeId : null,
      }));
    } else if (dto.testCaseIds) {
      // IDs from another project are rejected rather than silently dropped; otherwise
      // the client would not notice the run was created with missing test cases.
      await this.accessControl.assertCasesInProject(projectId, dto.testCaseIds);
      const archived = await this.prisma.testCase.findMany({
        where: { id: { in: dto.testCaseIds }, archivedAt: { not: null } },
        select: { id: true },
      });
      if (archived.length > 0) {
        throw new BadRequestException(
          `Archived test cases can't be added to a run: ${archived.map((c) => c.id).join(", ")}`,
        );
      }
      items = [...new Set(dto.testCaseIds)].map((testCaseId) => ({ testCaseId, assigneeId: null }));
    }

    const testCases =
      items.length > 0
        ? await this.prisma.testCase.findMany({
            where: { id: { in: items.map((i) => i.testCaseId) }, projectId },
            include: { steps: { orderBy: { position: "asc" } } },
          })
        : [];
    const caseById = new Map(testCases.map((tc) => [tc.id, tc]));

    return this.prisma.testRun.create({
      data: {
        projectId,
        planId: dto.planId,
        // A run started from a plan takes the plan's milestone, environment and configuration
        // unless the request sets them.
        milestoneId: dto.milestoneId ?? plan?.milestoneId,
        title: dto.title,
        description: dto.description,
        tags: dto.tags ?? [],
        environment: dto.environment ?? plan?.environment,
        build: dto.build,
        configuration: dto.configuration ?? plan?.configuration,
        source: dto.source,
        createdById: userId,
        runCases: {
          create: items.map((item, index) => ({
            testCaseId: item.testCaseId,
            assigneeId: item.assigneeId,
            position: index,
            caseSnapshot: buildCaseSnapshot(caseById.get(item.testCaseId)!) as Prisma.InputJsonValue,
          })),
        },
      },
      include: { runCases: true },
    });
  }

  async update(
    userId: string,
    projectId: string,
    runId: string,
    dto: UpdateRunDto,
  ) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.getOne(userId, projectId, runId);
    return this.prisma.testRun.update({ where: { id: runId }, data: dto });
  }

  /** Sets or clears who tests a case in the run (project admins and testers). */
  async assignCase(
    userId: string,
    projectId: string,
    runId: string,
    runCaseId: string,
    assigneeId: string | null,
  ) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(userId, projectId, [
      ProjectRole.ADMIN,
      ProjectRole.TESTER,
    ]);
    const run = await this.prisma.testRun.findFirst({
      where: { id: runId, projectId },
      select: { id: true },
    });
    if (!run) throw new NotFoundException("Run not found");
    await this.accessControl.assertAssignableUser(projectId, assigneeId);
    const { count } = await this.prisma.runCase.updateMany({
      where: { id: runCaseId, runId },
      data: { assigneeId },
    });
    if (count === 0) throw new NotFoundException("Test case is not in this run");
    return this.prisma.runCase.findUniqueOrThrow({ where: { id: runCaseId } });
  }

  async complete(userId: string, projectId: string, runId: string) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.getOne(userId, projectId, runId);
    return this.prisma.testRun.update({
      where: { id: runId },
      data: { status: RunStatus.COMPLETED, completedAt: new Date() },
    });
  }

  async reopen(userId: string, projectId: string, runId: string) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      [ProjectRole.ADMIN],
    );
    await this.getOne(userId, projectId, runId);
    return this.prisma.testRun.update({
      where: { id: runId },
      data: { status: RunStatus.OPEN, completedAt: null },
    });
  }

  // FR-063: the public share link must be auth-exempt and revocable, and use an unguessable token.
  async toggleShare(
    userId: string,
    projectId: string,
    runId: string,
    enabled: boolean,
  ) {
    // A public link can still be turned off after the project is archived.
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
      { allowArchived: !enabled },
    );
    await this.getOne(userId, projectId, runId);
    return this.prisma.testRun.update({
      where: { id: runId },
      data: enabled
        ? {
            publicShareEnabled: true,
            publicShareToken: crypto.randomBytes(24).toString("base64url"),
          }
        : { publicShareEnabled: false, publicShareToken: null },
    });
  }

  async getPublicView(token: string) {
    const run = await this.prisma.testRun.findUnique({
      where: { publicShareToken: token },
      include: {
        runCases: {
          include: { testCase: { select: { title: true } } },
          orderBy: { position: "asc" },
        },
      },
    });
    if (!run || !run.publicShareEnabled) {
      throw new NotFoundException("Shared run not found");
    }
    return {
      title: run.title,
      environment: run.environment,
      build: run.build,
      status: run.status,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      cases: run.runCases.map((rc) => ({
        title: rc.testCase.title,
        status: rc.status,
      })),
    };
  }

  /**
   * Verifies, for the Results module, that the run exists and is not completed. Runs inside the
   * caller's transaction and holds the run row FOR SHARE until it ends: completing the run waits
   * for results that are being written, and no result is written after completion (FR-035).
   */
  async assertWritableRun(
    tx: Prisma.TransactionClient,
    projectId: string,
    runId: string,
  ) {
    const [run] = await tx.$queryRaw<{ projectId: string; status: RunStatus }[]>`
      SELECT "projectId", "status" FROM "test_runs" WHERE "id" = ${runId} FOR SHARE`;
    if (!run || run.projectId !== projectId) {
      throw new NotFoundException("Run not found");
    }
    if (run.status === RunStatus.COMPLETED) {
      throw new ForbiddenException(
        "This run is completed; new results can't be added (FR-035)",
      );
    }
  }

  /** Deletes the run with its results and their attachments (project admins only). */
  async remove(userId: string, projectId: string, runId: string) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      [ProjectRole.ADMIN],
    );
    const run = await this.prisma.testRun.findUnique({ where: { id: runId } });
    if (!run || run.projectId !== projectId) {
      throw new NotFoundException("Run not found");
    }
    const keys = await this.attachmentFiles.keysFor({
      OR: [
        { result: { runCase: { runId } } },
        { stepResult: { result: { runCase: { runId } } } },
      ],
    });
    await this.prisma.testRun.delete({ where: { id: runId } });
    await this.attachmentFiles.removeFiles(keys);
  }
}
