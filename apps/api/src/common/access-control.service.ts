import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ProjectRole, WorkspaceRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

// FR-003: every query must be limited to the workspace/project the user is authorized for.
// Membership is verified on every access to prevent data leaks through guessed object IDs.
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

  /** Checks whether the user has admin access to a project's workspace (e.g. a workspace admin's access to all projects). */
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

  /** Workspace admins can act as ADMIN in every project of their own workspace. */
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

  /** Verifies access to the project with any role (at least VIEWER), falling back to workspace admin. */
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
  // Scope checks (FR-003, design-doc section 8)
  //
  // The membership check only verifies the project/workspace in the URL; other
  // IDs in the request body or path (case, result, suite, milestone, user,
  // membership) may belong to another scope. If they are not checked, another
  // project's record could be linked and then read or modified through the
  // relation. "Missing" and "belongs to another scope" both return 404 alike,
  // so a guessed ID does not leak whether the record exists either.
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

  /** The check is skipped when `suiteId` is empty (root level). */
  async assertSuiteInProject(projectId: string, suiteId?: string | null) {
    if (!suiteId) return;
    const suite = await this.prisma.suite.findFirst({
      where: { id: suiteId, projectId },
      select: { id: true },
    });
    if (!suite) throw new NotFoundException("Suite not found");
  }

  /** The check is skipped when `milestoneId` is empty. */
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

  /** The assignee must have access to the project (via membership or workspace admin). */
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

/** Throws a 404 listing the requested IDs that were not found. */
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
