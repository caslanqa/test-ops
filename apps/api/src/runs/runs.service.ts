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

const WRITE_ROLES: ProjectRole[] = [
  ProjectRole.ADMIN,
  ProjectRole.TESTER,
  ProjectRole.AUTOMATION,
];

function buildCaseSnapshot(testCase: {
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
  ) {}

  async list(userId: string, projectId: string, status?: RunStatus) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    return this.prisma.testRun.findMany({
      where: { projectId, status },
      orderBy: { createdAt: "desc" },
    });
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
      throw new NotFoundException("Run bulunamadı");
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

    let caseIds: string[] = [];
    if (dto.planId) {
      const plan = await this.prisma.testPlan.findUnique({
        where: { id: dto.planId },
        include: { items: true },
      });
      if (!plan || plan.projectId !== projectId) {
        throw new NotFoundException("Plan bulunamadı");
      }
      caseIds = plan.items.map((i) => i.testCaseId);
    } else if (dto.testCaseIds) {
      // Başka projeye ait ID'ler sessizce düşürülmek yerine reddedilir; aksi halde
      // istemci eksik case'lerle oluşan run'ı fark etmez.
      await this.accessControl.assertCasesInProject(projectId, dto.testCaseIds);
      caseIds = dto.testCaseIds;
    }

    const testCases =
      caseIds.length > 0
        ? await this.prisma.testCase.findMany({
            where: { id: { in: caseIds }, projectId },
            include: { steps: { orderBy: { position: "asc" } } },
          })
        : [];

    return this.prisma.testRun.create({
      data: {
        projectId,
        planId: dto.planId,
        milestoneId: dto.milestoneId,
        title: dto.title,
        description: dto.description,
        tags: dto.tags ?? [],
        environment: dto.environment,
        build: dto.build,
        configuration: dto.configuration,
        source: dto.source,
        createdById: userId,
        runCases: {
          create: testCases.map((tc, index) => ({
            testCaseId: tc.id,
            position: index,
            caseSnapshot: buildCaseSnapshot(tc) as Prisma.InputJsonValue,
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

  // FR-063: public payla\u015f\u0131m linki ayr\u0131cal\u0131kl\u0131 ve kapat\u0131labilir olmal\u0131, tahmin edilemeyen token kullanmal\u0131.
  async toggleShare(
    userId: string,
    projectId: string,
    runId: string,
    enabled: boolean,
  ) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
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
      throw new NotFoundException("Payla\u015f\u0131lan run bulunamad\u0131");
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

  /** Results modülü için run'ın mevcut olduğunu ve tamamlanmadığını doğrular. */
  async assertWritableRun(projectId: string, runId: string) {
    const run = await this.prisma.testRun.findUnique({ where: { id: runId } });
    if (!run || run.projectId !== projectId) {
      throw new NotFoundException("Run bulunamadı");
    }
    if (run.status === RunStatus.COMPLETED) {
      throw new ForbiddenException(
        "Run tamamlanmış; yeni sonuç eklenemez (FR-035)",
      );
    }
    return run;
  }
}
