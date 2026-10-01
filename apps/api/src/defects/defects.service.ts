import { Injectable, NotFoundException } from "@nestjs/common";
import { ProjectRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccessControlService } from "../common/access-control.service";
import { CreateDefectDto } from "./dto/create-defect.dto";
import { UpdateDefectDto } from "./dto/update-defect.dto";

const WRITE_ROLES: ProjectRole[] = [
  ProjectRole.ADMIN,
  ProjectRole.TESTER,
  ProjectRole.AUTOMATION,
];

@Injectable()
export class DefectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
  ) {}

  async list(userId: string, projectId: string) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    return this.prisma.defect.findMany({
      where: { projectId },
      include: { _count: { select: { results: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async getOne(userId: string, projectId: string, defectId: string) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    const defect = await this.prisma.defect.findUnique({
      where: { id: defectId },
      include: {
        results: { include: { result: { include: { runCase: true } } } },
      },
    });
    if (!defect || defect.projectId !== projectId) {
      throw new NotFoundException("Defect not found");
    }
    return defect;
  }

  async create(userId: string, projectId: string, dto: CreateDefectDto) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.accessControl.assertResultsInProject(
      projectId,
      dto.resultIds ?? [],
    );
    await this.accessControl.assertAssignableUser(projectId, dto.assigneeId);
    return this.prisma.defect.create({
      data: {
        projectId,
        title: dto.title,
        description: dto.description,
        severity: dto.severity,
        assigneeId: dto.assigneeId,
        tags: dto.tags ?? [],
        externalProvider: dto.externalProvider,
        externalIssueId: dto.externalIssueId,
        externalUrl: dto.externalUrl,
        createdById: userId,
        results: dto.resultIds
          ? { create: dto.resultIds.map((resultId) => ({ resultId })) }
          : undefined,
      },
      include: { results: true },
    });
  }

  async update(
    userId: string,
    projectId: string,
    defectId: string,
    dto: UpdateDefectDto,
  ) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.getOne(userId, projectId, defectId);
    await this.accessControl.assertAssignableUser(projectId, dto.assigneeId);
    return this.prisma.defect.update({ where: { id: defectId }, data: dto });
  }

  async linkResults(
    userId: string,
    projectId: string,
    defectId: string,
    resultIds: string[],
  ) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.getOne(userId, projectId, defectId);
    await this.accessControl.assertResultsInProject(projectId, resultIds);
    await this.prisma.defectResult.createMany({
      data: resultIds.map((resultId) => ({ defectId, resultId })),
      skipDuplicates: true,
    });
    return this.getOne(userId, projectId, defectId);
  }

  async unlinkResult(
    userId: string,
    projectId: string,
    defectId: string,
    resultId: string,
  ) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      WRITE_ROLES,
    );
    await this.getOne(userId, projectId, defectId);
    const { count } = await this.prisma.defectResult.deleteMany({
      where: { defectId, resultId },
    });
    if (count === 0) {
      throw new NotFoundException("Defect is not linked to this result");
    }
  }
}
