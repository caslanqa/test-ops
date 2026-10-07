import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ProjectRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccessControlService } from "../common/access-control.service";
import { CreateDefectDto } from "./dto/create-defect.dto";
import { UpdateDefectDto } from "./dto/update-defect.dto";
import { ListDefectsQueryDto } from "./dto/list-defects-query.dto";
import { pageArgs } from "../common/pagination";
import { AttachmentFilesService } from "../attachments/attachment-files.service";

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
    private readonly attachmentFiles: AttachmentFilesService,
  ) {}

  async list(userId: string, projectId: string, query: ListDefectsQueryDto) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    const where: Prisma.DefectWhereInput = {
      projectId,
      status: query.status,
      severity: query.severity,
      assigneeId: query.assigneeId,
      title: query.q ? { contains: query.q, mode: "insensitive" } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.defect.findMany({
        where,
        include: { _count: { select: { results: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        ...pageArgs(query),
      }),
      this.prisma.defect.count({ where }),
    ]);
    return { items, total };
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

  /** Deletes the defect and its attachments (project admins only); linked results are kept. */
  async remove(userId: string, projectId: string, defectId: string) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      [ProjectRole.ADMIN],
    );
    await this.getOne(userId, projectId, defectId);
    const keys = await this.attachmentFiles.keysFor({ defectId });
    await this.prisma.defect.delete({ where: { id: defectId } });
    await this.attachmentFiles.removeFiles(keys);
  }
}
