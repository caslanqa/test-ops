import type { ProjectRole } from './labels';
import { useProjectInfo } from './projectInfo';

export interface ProjectPermissions {
  role: ProjectRole | undefined;
  /** The project is archived, so its data can't be changed. */
  archived: boolean;
  /** Creating/editing cases, suites, requirements and plans. */
  editRepository: boolean;
  /** Starting runs, entering results, filing defects. */
  execute: boolean;
  /** Managing project members and their roles. */
  manageMembers: boolean;
  /** Deleting suites, runs and defects, which only project admins can do. */
  deleteRecords: boolean;
}

/**
 * UI counterpart of the server's WRITE_ROLES rules: actions the user can't perform
 * are hidden. Permissions are always checked on the server as well; this only keeps
 * users from running into buttons that would get them a 403. An archived project is
 * read-only for everyone (the server answers 409); members can still be managed.
 */
export function projectPermissions(
  role: ProjectRole | undefined,
  archived = false,
): ProjectPermissions {
  return {
    role,
    archived,
    editRepository: !archived && (role === 'ADMIN' || role === 'TESTER'),
    execute: !archived && (role === 'ADMIN' || role === 'TESTER' || role === 'AUTOMATION'),
    manageMembers: role === 'ADMIN',
    deleteRecords: !archived && role === 'ADMIN',
  };
}

/** Who is acting: a workspace admin is `ADMIN` in every project, so the project role alone doesn't tell. */
export interface RoleGiver {
  workspaceAdmin: boolean;
}

const BELOW_PROJECT_ADMIN: ProjectRole[] = ['TESTER', 'AUTOMATION', 'VIEWER'];

/**
 * The project roles the user may give: every role for a workspace admin, the ones below Project admin for
 * a project admin (a project admin can't raise anyone to their own level). The server enforces the same rule
 * (projectRoleLimits in the API); this only keeps the other roles out of the lists.
 */
export function assignableProjectRoles({ workspaceAdmin }: RoleGiver): ProjectRole[] {
  return workspaceAdmin ? ['ADMIN', ...BELOW_PROJECT_ADMIN] : BELOW_PROJECT_ADMIN;
}

/** The roles of the members the user may change or remove: the same list as the roles they may give. */
export function manageableProjectRoles(who: RoleGiver): ProjectRole[] {
  return assignableProjectRoles(who);
}

export function useProjectPermissions(projectId: string | undefined): ProjectPermissions {
  const { data } = useProjectInfo(projectId);
  return projectPermissions(data?.project.currentUserRole, Boolean(data?.project.archivedAt));
}
