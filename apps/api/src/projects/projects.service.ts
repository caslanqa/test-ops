import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, ProjectRole, WorkspaceRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccessControlService } from "../common/access-control.service";
import { pageArgs } from "../common/pagination";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import { AddProjectMemberDto } from "./dto/add-project-member.dto";
import { ListProjectsQueryDto } from "./dto/list-projects-query.dto";
import { ListWorkspaceProjectsQueryDto } from "./dto/list-workspace-projects-query.dto";

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
        existing.archivedAt
          ? "An archived project in this workspace already uses this key; restore it or choose another key."
          : "A project with this key already exists in this workspace",
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

  async listForWorkspace(
    userId: string,
    workspaceId: string,
    query: ListWorkspaceProjectsQueryDto,
  ) {
    const member = await this.accessControl.requireWorkspaceMembership(
      userId,
      workspaceId,
    );
    // A workspace admin sees all projects; other members see only the projects they
    // belong to (not even the names of projects they cannot access are listed).
    const where: Prisma.ProjectWhereInput = {
      workspaceId,
      archivedAt: query.archived ? { not: null } : null,
      ...(member.role === WorkspaceRole.ADMIN
        ? {}
        : { members: { some: { userId } } }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        ...pageArgs(query),
      }),
      this.prisma.project.count({ where }),
    ]);
    return { items, total };
  }

  async getOne(userId: string, projectId: string) {
    const access = await this.accessControl.requireProjectAccessOrWorkspaceAdmin(
      userId,
      projectId,
    );
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException("Project not found");
    // Workspace admins count as ADMIN in the project. The UI uses this role to show or
    // hide actions; authorization is still enforced on the server at every endpoint.
    return { ...project, currentUserRole: access.role };
  }

  async update(userId: string, projectId: string, dto: UpdateProjectDto) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      [ProjectRole.ADMIN],
    );
    return this.prisma.project.update({ where: { id: projectId }, data: dto });
  }

  /**
   * Archives the project: it leaves the project lists and becomes read-only (see
   * AccessControlService). Archiving again keeps the original date.
   */
  async archive(userId: string, projectId: string) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      [ProjectRole.ADMIN],
      { allowArchived: true },
    );
    await this.prisma.project.updateMany({
      where: { id: projectId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    return this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  }

  /** Brings an archived project back to the lists and makes it writable again. */
  async restore(userId: string, projectId: string) {
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      [ProjectRole.ADMIN],
      { allowArchived: true },
    );
    return this.prisma.project.update({
      where: { id: projectId },
      data: { archivedAt: null },
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
    // Members can still be managed while the project is archived: it decides who can read it.
    await this.accessControl.requireProjectRoleOrWorkspaceAdmin(
      userId,
      projectId,
      [ProjectRole.ADMIN],
      { allowArchived: true },
    );
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    const targetUser = await this.prisma.user.findFirst({
      where: { email: { equals: dto.email.trim(), mode: "insensitive" } },
    });
    // Project members are chosen from the workspace members; that way removal from
    // the workspace revokes access to all of its projects.
    const workspaceMember = targetUser
      ? await this.prisma.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: project.workspaceId,
              userId: targetUser.id,
            },
          },
        })
      : null;
    if (!targetUser || !workspaceMember) {
      throw new BadRequestException(
        "This person is not a workspace member; add them to the workspace first.",
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
      { allowArchived: true },
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
      { allowArchived: true },
    );
    await this.accessControl.assertProjectMemberRecord(projectId, memberId);
    await this.prisma.projectMember.delete({ where: { id: memberId } });
  }

  /**
   * Every project the user can open, across workspaces: all projects of workspaces they
   * administer plus the ones they are a member of.
   */
  async listAccessible(userId: string, query: ListProjectsQueryDto) {
    const where: Prisma.ProjectWhereInput = {
      archivedAt: null,
      workspaceId: query.workspaceId,
      OR: [
        { members: { some: { userId } } },
        { workspace: { members: { some: { userId, role: WorkspaceRole.ADMIN } } } },
      ],
      ...(query.q
        ? {
            AND: [
              {
                OR: [
                  { name: { contains: query.q, mode: "insensitive" } },
                  { key: { contains: query.q, mode: "insensitive" } },
                ],
              },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        include: { workspace: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        ...pageArgs(query),
      }),
      this.prisma.project.count({ where }),
    ]);
    return { items, total };
  }
}
