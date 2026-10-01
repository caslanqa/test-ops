import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { WorkspaceRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccessControlService } from "../common/access-control.service";
import { AuthService } from "../auth/auth.service";
import { CreateWorkspaceDto } from "./dto/create-workspace.dto";
import { AddWorkspaceMemberDto } from "./dto/add-workspace-member.dto";

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
    private readonly authService: AuthService,
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

  async listForUser(userId: string) {
    return this.prisma.workspace.findMany({
      where: { members: { some: { userId } } },
      orderBy: { createdAt: "asc" },
    });
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
    // Arayüz, kullanıcının yetkisi olmayan eylemleri göstermemek için rolü kullanır;
    // yetki kontrolü yine her endpoint'te sunucuda yapılır.
    return { ...workspace, currentUserRole: member.role };
  }

  async update(userId: string, workspaceId: string, name: string) {
    await this.accessControl.requireWorkspaceRole(userId, workspaceId, [
      WorkspaceRole.ADMIN,
    ]);
    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { name },
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

  async addMember(
    userId: string,
    workspaceId: string,
    dto: AddWorkspaceMemberDto,
  ) {
    await this.accessControl.requireWorkspaceRole(userId, workspaceId, [
      WorkspaceRole.ADMIN,
    ]);

    let targetUser = await this.authService.findUserByEmail(dto.email);
    if (!targetUser) {
      if (!dto.displayName || !dto.password) {
        throw new ConflictException(
          "No account exists for this email; displayName and password are required to create one",
        );
      }
      targetUser = await this.prisma.user.create({
        data: {
          email: dto.email.trim().toLowerCase(),
          displayName: dto.displayName,
          passwordHash: await this.authService.hashPassword(dto.password),
        },
      });
    }

    // Var olan üyeyi tekrar eklemek rolünü günceller; son admin bu yoldan da düşürülemez.
    const existing = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUser.id } },
    });
    if (existing && dto.role !== WorkspaceRole.ADMIN) {
      await this.assertNotLastAdmin(workspaceId, existing.id);
    }

    return this.prisma.workspaceMember.upsert({
      where: {
        workspaceId_userId: { workspaceId, userId: targetUser.id },
      },
      create: { workspaceId, userId: targetUser.id, role: dto.role },
      update: { role: dto.role },
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
    // Proje erişimi proje üyeliğiyle kontrol edildiği için workspace'ten çıkarılan
    // kişinin o workspace'teki proje üyelikleri de silinir; aksi halde projelere
    // erişmeye devam ederdi.
    await this.prisma.$transaction([
      this.prisma.projectMember.deleteMany({
        where: { userId: member.userId, project: { workspaceId } },
      }),
      this.prisma.workspaceMember.delete({ where: { id: memberId } }),
    ]);
  }

  /** Workspace yönetilemez kalmasın: son admin silinemez veya rolü düşürülemez. */
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
}
