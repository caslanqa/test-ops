import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { WorkspaceRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccessControlService } from "../common/access-control.service";
import { PageQueryDto, pageArgs } from "../common/pagination";
import { CreateWorkspaceDto } from "./dto/create-workspace.dto";
import { UpdateWorkspaceDto } from "./dto/update-workspace.dto";
import { AttachmentFilesService } from "../attachments/attachment-files.service";

// People join a workspace through invitations (see InvitationsService); nobody is added directly.
@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
    private readonly attachmentFiles: AttachmentFilesService,
  ) {}

  async create(userId: string, dto: CreateWorkspaceDto) {
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

  async listForUser(userId: string, query: PageQueryDto) {
    const where = { members: { some: { userId } } };
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
