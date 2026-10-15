import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ProjectRole, WorkspaceRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { DEMO_WORKSPACE_ID } from "../demo/demo.constants";

export const ARCHIVED_PROJECT_MESSAGE =
  "This project is archived, so it is read-only. A project admin can restore it.";

export interface ProjectWriteOptions {
  /**
   * Also allow the write while the project is archived: restoring it, and deciding who can
   * read it (members, turning a public run link off).
   */
  allowArchived?: boolean;
}

/** How a user may read a workspace: as a member, or as a viewer of the demo workspace. */
export interface WorkspaceReadAccess {
  role: WorkspaceRole;
  /** Not a member: read-only access because this is the demo workspace. */
  demoViewer: boolean;
}

// FR-003: every query must be limited to the workspace/project the user is authorized for.
// Membership is verified on every access to prevent data leaks through guessed object IDs.
//
// The built-in demo workspace (DEMO_WORKSPACE, see DemoService) is readable by every signed-in user without a membership
// record, so its member lists don't fill up with everyone who signs up, and nobody sees the other
// visitors. Only the read checks below (requireWorkspaceReadAccess,
// requireProjectAccessOrWorkspaceAdmin) let them in, as a workspace MEMBER and project VIEWER;
// every role check for a change still needs a real membership. Both report `demoViewer`, so
// responses can leave out what visitors must not see, such as the members' email addresses.
@Injectable()
export class AccessControlService {
  private readonly demoWorkspaceId: string | null;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.demoWorkspaceId = config.get<boolean>("demo.enabled") ? DEMO_WORKSPACE_ID : null;
  }

  /** The id of the workspace every signed-in user may read, or null when there is none. */
  get demoWorkspace(): string | null {
    return this.demoWorkspaceId;
  }

  isDemoWorkspace(workspaceId: string): boolean {
    return this.demoWorkspaceId !== null && workspaceId === this.demoWorkspaceId;
  }

  /** Read access to a workspace: its members, and everyone for the demo workspace. */
  async requireWorkspaceReadAccess(userId: string, workspaceId: string): Promise<WorkspaceReadAccess> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (member) return { role: member.role, demoViewer: false };
    if (this.isDemoWorkspace(workspaceId)) return { role: WorkspaceRole.MEMBER, demoViewer: true };
    throw new ForbiddenException("You don't have access to this workspace");
  }

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
    return this.isWorkspaceAdmin(userId, project.workspaceId);
  }

  private async isWorkspaceAdmin(userId: string, workspaceId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    return member?.role === WorkspaceRole.ADMIN;
  }

  /**
   * Access check for changes to a project. Workspace admins can act as ADMIN in every project
   * of their own workspace. An archived project is read-only: after the role check, changes
   * get 409 unless `allowArchived` is set.
   */
  async requireProjectRoleOrWorkspaceAdmin(
    userId: string,
    projectId: string,
    roles: ProjectRole[],
    { allowArchived = false }: ProjectWriteOptions = {},
  ) {
    if (await this.isWorkspaceAdminOfProject(userId, projectId)) {
      if (!allowArchived) await this.assertProjectNotArchived(projectId);
      return { role: ProjectRole.ADMIN, viaWorkspaceAdmin: true };
    }
    const member = await this.requireProjectRole(userId, projectId, roles);
    if (!allowArchived) await this.assertProjectNotArchived(projectId);
    return { ...member, viaWorkspaceAdmin: false };
  }

  /** Runs after the role check, so people without access can't learn that a project is archived. */
  private async assertProjectNotArchived(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { archivedAt: true },
    });
    if (project?.archivedAt) throw new ConflictException(ARCHIVED_PROJECT_MESSAGE);
  }

  /**
   * Verifies read access to the project: any role (at least VIEWER), a workspace admin, or, in
   * the demo workspace, everyone as a VIEWER.
   */
  async requireProjectAccessOrWorkspaceAdmin(
    userId: string,
    projectId: string,
  ): Promise<{ role: ProjectRole; viaWorkspaceAdmin: boolean; demoViewer: boolean }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (project && (await this.isWorkspaceAdmin(userId, project.workspaceId))) {
      return { role: ProjectRole.ADMIN, viaWorkspaceAdmin: true, demoViewer: false };
    }
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (member) return { role: member.role, viaWorkspaceAdmin: false, demoViewer: false };
    if (project && this.isDemoWorkspace(project.workspaceId)) {
      return { role: ProjectRole.VIEWER, viaWorkspaceAdmin: false, demoViewer: true };
    }
    throw new ForbiddenException("You don't have access to this project");
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

  async assertRequirementsInProject(projectId: string, requirementIds: string[]) {
    const ids = [...new Set(requirementIds)];
    if (ids.length === 0) return;
    const found = await this.prisma.requirement.findMany({
      where: { id: { in: ids }, projectId },
      select: { id: true },
    });
    throwIfMissing(ids, found, "Requirements not found in this project");
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

  /** Of the given users, those who can still be assigned in the project (members and workspace admins). */
  async assignableUserIds(projectId: string, userIds: string[]) {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Set<string>();
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        members: { where: { userId: { in: ids } }, select: { userId: true } },
        workspace: {
          select: {
            members: {
              where: { userId: { in: ids }, role: WorkspaceRole.ADMIN },
              select: { userId: true },
            },
          },
        },
      },
    });
    return new Set([
      ...(project?.members ?? []).map((m) => m.userId),
      ...(project?.workspace.members ?? []).map((m) => m.userId),
    ]);
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
