import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, ProjectRole, WorkspaceRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccessControlService } from "../common/access-control.service";
import { PageQueryDto, pageArgs } from "../common/pagination";
import { CreateWorkspaceDto } from "./dto/create-workspace.dto";
import { UpdateWorkspaceDto } from "./dto/update-workspace.dto";
import { AttachmentFilesService } from "../attachments/attachment-files.service";
import { DemoService } from "../demo/demo.service";

// People join a workspace through invitations (see InvitationsService); nobody is added directly.
@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
    private readonly attachmentFiles: AttachmentFilesService,
    private readonly config: ConfigService,
    private readonly demo: DemoService,
  ) {}

  /**
   * With SELF_REGISTRATION off, only an admin of a workspace may start another one; otherwise any
   * member could create a workspace and invite arbitrary email addresses, which creates accounts
   * on a closed installation. A server without any workspace is still open so the first one can
   * be created. This is an interim rule until the Installation Admin role (FR-090) exists.
   */
  private async assertMayCreateWorkspace(userId: string) {
    if (this.config.get<boolean>("auth.selfRegistration") ?? false) return;
    const [isAdmin, anyWorkspace] = await Promise.all([
      this.prisma.workspaceMember.findFirst({
        where: { userId, role: WorkspaceRole.ADMIN },
        select: { id: true },
      }),
      this.prisma.workspace.findFirst({ select: { id: true } }),
    ]);
    if (anyWorkspace && !isAdmin) {
      throw new ForbiddenException(
        "Creating workspaces is limited to workspace admins while self-registration is disabled.",
      );
    }
  }

  async create(userId: string, dto: CreateWorkspaceDto) {
    await this.assertMayCreateWorkspace(userId);
    const existing = await this.prisma.workspace.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) {
      throw new ConflictException("This slug is already in use");
    }
    return this.prisma.workspace.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        members: {
          create: { userId, role: WorkspaceRole.ADMIN },
        },
      },
    });
  }

  /**
   * The user's workspaces. The first listing also makes their own demo workspace (DemoService), so
   * a new user finds it waiting.
   */
  async listForUser(userId: string, query: PageQueryDto) {
    await this.demo.ensureFor(userId);
    const where: Prisma.WorkspaceWhereInput = { members: { some: { userId } } };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.workspace.findMany({
        where,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        ...pageArgs(query),
      }),
      this.prisma.workspace.count({ where }),
    ]);
    return { items, total };
  }

  async getOne(userId: string, workspaceId: string) {
    const member = await this.accessControl.requireWorkspaceMembership(
      userId,
      workspaceId,
    );
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) throw new NotFoundException("Workspace not found");
    // The UI uses the role to hide actions the user is not permitted to perform;
    // authorization is still enforced on the server at every endpoint.
    return { ...workspace, currentUserRole: member.role };
  }

  async update(userId: string, workspaceId: string, dto: UpdateWorkspaceDto) {
    await this.accessControl.requireWorkspaceRole(userId, workspaceId, [
      WorkspaceRole.ADMIN,
    ]);
    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { name: dto.name },
    });
  }

  async listMembers(userId: string, workspaceId: string) {
    await this.accessControl.requireWorkspaceMembership(userId, workspaceId);
    return this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: { select: { id: true, email: true, displayName: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async updateMemberRole(
    userId: string,
    workspaceId: string,
    memberId: string,
    role: WorkspaceRole,
  ) {
    await this.accessControl.requireWorkspaceRole(userId, workspaceId, [
      WorkspaceRole.ADMIN,
    ]);
    await this.accessControl.assertWorkspaceMemberRecord(workspaceId, memberId);
    if (role !== WorkspaceRole.ADMIN) {
      await this.assertNotLastAdmin(workspaceId, memberId);
    }
    return this.prisma.workspaceMember.update({
      where: { id: memberId },
      data: { role },
    });
  }

  async removeMember(userId: string, workspaceId: string, memberId: string) {
    await this.accessControl.requireWorkspaceRole(userId, workspaceId, [
      WorkspaceRole.ADMIN,
    ]);
    await this.accessControl.assertWorkspaceMemberRecord(workspaceId, memberId);
    await this.assertNotLastAdmin(workspaceId, memberId);
    const member = await this.prisma.workspaceMember.findUniqueOrThrow({
      where: { id: memberId },
    });
    // Project access is checked via project membership, so a person removed from the
    // workspace also loses their project memberships in it; otherwise they would
    // keep accessing those projects.
    await this.prisma.$transaction([
      this.prisma.projectMember.deleteMany({
        where: { userId: member.userId, project: { workspaceId } },
      }),
      this.prisma.workspaceMember.delete({ where: { id: memberId } }),
    ]);
  }

  /**
   * Everything the permissions screen needs in one answer: the members with their workspace role,
   * the active projects, and every membership in those projects. Workspace admins only, since it
   * shows who can reach projects the caller may not be a member of.
   */
  async permissions(userId: string, workspaceId: string) {
    await this.accessControl.requireWorkspaceRole(userId, workspaceId, [
      WorkspaceRole.ADMIN,
    ]);
    const [members, projects, projectMembers] = await this.prisma.$transaction([
      this.prisma.workspaceMember.findMany({
        where: { workspaceId },
        include: { user: { select: { id: true, email: true, displayName: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      this.prisma.project.findMany({
        where: { workspaceId, archivedAt: null },
        select: { id: true, key: true, name: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      this.prisma.projectMember.findMany({
        where: { project: { workspaceId, archivedAt: null } },
        select: { id: true, projectId: true, userId: true, role: true },
      }),
    ]);
    return { members, projects, projectMembers };
  }

  /**
   * Gives a workspace member a role in one of the workspace's projects, changes it, or takes
   * them out of the project (role null). Workspace admins only. Like ProjectsService.addMember,
   * only workspace members can be given a project role, so removal from the workspace still
   * revokes every project at once.
   */
  async setProjectRole(
    userId: string,
    workspaceId: string,
    projectId: string,
    targetUserId: string,
    role: ProjectRole | null,
  ) {
    await this.accessControl.requireWorkspaceRole(userId, workspaceId, [
      WorkspaceRole.ADMIN,
    ]);
    // A project or person of another workspace is "not found", like any id from outside the scope.
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException("Project not found");
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      select: { id: true },
    });
    if (!member) throw new NotFoundException("Workspace member not found");

    if (role === null) {
      await this.prisma.projectMember.deleteMany({ where: { projectId, userId: targetUserId } });
      return { projectId, userId: targetUserId, role: null };
    }
    const saved = await this.prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: targetUserId } },
      create: { projectId, userId: targetUserId, role },
      update: { role },
    });
    return { projectId, userId: targetUserId, role: saved.role };
  }

  /** Keep the workspace manageable: the last admin cannot be removed or demoted. */
  private async assertNotLastAdmin(workspaceId: string, memberId: string) {
    const member = await this.prisma.workspaceMember.findUniqueOrThrow({
      where: { id: memberId },
    });
    if (member.role !== WorkspaceRole.ADMIN) return;
    const adminCount = await this.prisma.workspaceMember.count({
      where: { workspaceId, role: WorkspaceRole.ADMIN },
    });
    if (adminCount <= 1) {
      throw new BadRequestException(
        "The last workspace admin can't be removed or demoted. Make another member an admin first.",
      );
    }
  }

  /**
   * Deletes the workspace with every project, case, run, result and attachment in it.
   * Only a workspace admin may do this, and the name must be repeated as confirmation.
   */
  async remove(userId: string, workspaceId: string, confirmName: string) {
    await this.accessControl.requireWorkspaceRole(userId, workspaceId, [
      WorkspaceRole.ADMIN,
    ]);
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) throw new NotFoundException("Workspace not found");
    if (workspace.name !== confirmName) {
      throw new BadRequestException(
        "confirmName must match the workspace name exactly",
      );
    }
    const inWorkspace = { project: { workspaceId } };
    const keys = await this.attachmentFiles.keysFor({
      OR: [
        { result: { runCase: { run: inWorkspace } } },
        { stepResult: { result: { runCase: { run: inWorkspace } } } },
        { defect: inWorkspace },
      ],
    });
    // run_cases reference test cases without a cascade, so the cascade from the workspace
    // would try to delete cases before the run cases that point at them. Deleting the runs
    // first (which cascades to their cases and results) avoids that.
    await this.prisma.$transaction([
      this.prisma.testRun.deleteMany({ where: inWorkspace }),
      this.prisma.workspace.delete({ where: { id: workspaceId } }),
    ]);
    await this.attachmentFiles.removeFiles(keys);
  }
}
