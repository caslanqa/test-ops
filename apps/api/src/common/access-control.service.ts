import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ProjectRole, WorkspaceRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

// FR-003: her sorgu, kullanıcının yetkili olduğu workspace/project ile sınırlandırılmalı.
// Nesne ID tahmini ile veri sızıntısını önlemek için her erişimde membership doğrulanır.
@Injectable()
export class AccessControlService {
  constructor(private readonly prisma: PrismaService) {}

  async requireWorkspaceMembership(userId: string, workspaceId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!member) {
      throw new ForbiddenException("You don't have access to this workspace");
    }
    return member;
  }

  async requireWorkspaceRole(
    userId: string,
    workspaceId: string,
    roles: WorkspaceRole[],
  ) {
    const member = await this.requireWorkspaceMembership(userId, workspaceId);
    if (!roles.includes(member.role)) {
      throw new ForbiddenException("You don't have permission to do this");
    }
    return member;
  }

  async requireProjectMembership(userId: string, projectId: string) {
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!member) {
      throw new ForbiddenException("You don't have access to this project");
    }
    return member;
  }

  async requireProjectRole(
    userId: string,
    projectId: string,
    roles: ProjectRole[],
  ) {
    const member = await this.requireProjectMembership(userId, projectId);
    if (!roles.includes(member.role)) {
      throw new ForbiddenException("You don't have permission to do this");
    }
    return member;
  }

  /** Bir projenin workspace'ine kullanıcının admin erişimi olup olmadığını (ör. workspace admin'in tüm projelere erişimi) kontrol eder. */
  async isWorkspaceAdminOfProject(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project) return false;
    const member = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: project.workspaceId, userId },
      },
    });
    return member?.role === WorkspaceRole.ADMIN;
  }

  /** Workspace admin'leri, kendi workspace'lerindeki her projede ADMIN gibi davranabilir. */
  async requireProjectRoleOrWorkspaceAdmin(
    userId: string,
    projectId: string,
    roles: ProjectRole[],
  ) {
    if (await this.isWorkspaceAdminOfProject(userId, projectId)) {
      return { role: ProjectRole.ADMIN, viaWorkspaceAdmin: true };
    }
    const member = await this.requireProjectRole(userId, projectId, roles);
    return { ...member, viaWorkspaceAdmin: false };
  }

  /** Projeye herhangi bir rolle (en az VIEWER) erişimi olup olmadığını workspace admin düşüşüyle birlikte doğrular. */
  async requireProjectAccessOrWorkspaceAdmin(
    userId: string,
    projectId: string,
  ) {
    if (await this.isWorkspaceAdminOfProject(userId, projectId)) {
      return { role: ProjectRole.ADMIN, viaWorkspaceAdmin: true };
    }
    const member = await this.requireProjectMembership(userId, projectId);
    return { ...member, viaWorkspaceAdmin: false };
  }

  // ---------------------------------------------------------------------------
  // Kapsam doğrulamaları (FR-003, design-doc bölüm 8)
  //
  // Üyelik kontrolü yalnızca URL'deki projeyi/workspace'i doğrular; istek
  // gövdesindeki veya path'teki diğer ID'ler (case, result, suite, milestone,
  // kullanıcı, üyelik) başka bir kapsama ait olabilir. Bunlar doğrulanmazsa
  // başka projenin kaydı bağlanıp ilişki üzerinden okunabilir veya
  // değiştirilebilir. "Yok" ile "başka kapsama ait" ayırt edilmeden 404 döner;
  // böylece ID tahmini kaydın varlığını da sızdırmaz.
  // ---------------------------------------------------------------------------

  async assertCasesInProject(projectId: string, testCaseIds: string[]) {
    const ids = [...new Set(testCaseIds)];
    if (ids.length === 0) return;
    const found = await this.prisma.testCase.findMany({
      where: { id: { in: ids }, projectId },
      select: { id: true },
    });
    throwIfMissing(ids, found, "Test cases not found in this project");
  }

  async assertResultsInProject(projectId: string, resultIds: string[]) {
    const ids = [...new Set(resultIds)];
    if (ids.length === 0) return;
    const found = await this.prisma.result.findMany({
      where: { id: { in: ids }, runCase: { run: { projectId } } },
      select: { id: true },
    });
    throwIfMissing(ids, found, "Results not found in this project");
  }

  /** `suiteId` boşsa (kök seviye) kontrol atlanır. */
  async assertSuiteInProject(projectId: string, suiteId?: string | null) {
    if (!suiteId) return;
    const suite = await this.prisma.suite.findFirst({
      where: { id: suiteId, projectId },
      select: { id: true },
    });
    if (!suite) throw new NotFoundException("Suite not found");
  }

  /** `milestoneId` boşsa kontrol atlanır. */
  async assertMilestoneInProject(
    projectId: string,
    milestoneId?: string | null,
  ) {
    if (!milestoneId) return;
    const milestone = await this.prisma.milestone.findFirst({
      where: { id: milestoneId, projectId },
      select: { id: true },
    });
    if (!milestone) throw new NotFoundException("Milestone not found");
  }

  /** Atanacak kullanıcının projeye (üyelik veya workspace admin yoluyla) erişimi olmalı. */
  async assertAssignableUser(projectId: string, assigneeId?: string | null) {
    if (!assigneeId) return;
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: assigneeId } },
    });
    if (member) return;
    if (await this.isWorkspaceAdminOfProject(assigneeId, projectId)) return;
    throw new NotFoundException("The assignee is not a member of this project");
  }

  async assertProjectMemberRecord(projectId: string, memberId: string) {
    const member = await this.prisma.projectMember.findFirst({
      where: { id: memberId, projectId },
      select: { id: true },
    });
    if (!member) throw new NotFoundException("Project member not found");
  }

  async assertWorkspaceMemberRecord(workspaceId: string, memberId: string) {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
      select: { id: true },
    });
    if (!member) throw new NotFoundException("Workspace member not found");
  }
}

/** İstenen ID'lerden bulunamayanları mesajda listeleyerek 404 fırlatır. */
function throwIfMissing(
  requested: string[],
  found: { id: string }[],
  label: string,
) {
  if (found.length === requested.length) return;
  const foundIds = new Set(found.map((f) => f.id));
  const missing = requested.filter((id) => !foundIds.has(id));
  throw new NotFoundException(`${label}: ${missing.join(", ")}`);
}
