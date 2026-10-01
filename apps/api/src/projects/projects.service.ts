import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ProjectRole, WorkspaceRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccessControlService } from "../common/access-control.service";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import { AddProjectMemberDto } from "./dto/add-project-member.dto";

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
  ) {}

  async create(userId: string, workspaceId: string, dto: CreateProjectDto) {
    await this.accessControl.requireWorkspaceRole(userId, workspaceId, [
      WorkspaceRole.ADMIN,
    ]);
    const existing = await this.prisma.project.findUnique({
      where: { workspaceId_key: { workspaceId, key: dto.key } },
    });
    if (existing) {
      throw new ConflictException(
        "Bu workspace içinde aynı key ile bir proje zaten var",
      );
    }
    return this.prisma.project.create({
      data: {
        workspaceId,
        key: dto.key,
        name: dto.name,
        description: dto.description,
        members: { create: { userId, role: ProjectRole.ADMIN } },
      },
    });
  }

  async listForWorkspace(userId: string, workspaceId: string) {
    await this.accessControl.requireWorkspaceMembership(userId, workspaceId);
    return this.prisma.project.findMany({
      where: { workspaceId, archivedAt: null },
      orderBy: { createdAt: "asc" },
    });
  }

  async getOne(userId: string, projectId: string) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException("Proje bulunamadı");
    return project;
  }

  async update(userId: string, projectId: string, dto: UpdateProjectDto) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      [ProjectRole.ADMIN],
    );
    return this.prisma.project.update({ where: { id: projectId }, data: dto });
  }

  async archive(userId: string, projectId: string) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      [ProjectRole.ADMIN],
    );
    return this.prisma.project.update({
      where: { id: projectId },
      data: { archivedAt: new Date() },
    });
  }

  async listMembers(userId: string, projectId: string) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    return this.prisma.projectMember.findMany({
      where: { projectId },
      include: {
        user: { select: { id: true, email: true, displayName: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async addMember(userId: string, projectId: string, dto: AddProjectMemberDto) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      [ProjectRole.ADMIN],
    );
    const targetUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!targetUser) {
      throw new BadRequestException(
        "Kullanıcı bulunamadı; önce workspace üyesi olarak eklenmelidir",
      );
    }
    return this.prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: targetUser.id } },
      create: { projectId, userId: targetUser.id, role: dto.role },
      update: { role: dto.role },
    });
  }

  async updateMemberRole(
    userId: string,
    projectId: string,
    memberId: string,
    role: ProjectRole,
  ) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      [ProjectRole.ADMIN],
    );
    await this.accessControl.assertProjectMemberRecord(projectId, memberId);
    return this.prisma.projectMember.update({
      where: { id: memberId },
      data: { role },
    });
  }

  async removeMember(userId: string, projectId: string, memberId: string) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      [ProjectRole.ADMIN],
    );
    await this.accessControl.assertProjectMemberRecord(projectId, memberId);
    await this.prisma.projectMember.delete({ where: { id: memberId } });
  }
}
