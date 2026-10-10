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

export function useProjectPermissions(projectId: string | undefined): ProjectPermissions {
  const { data } = useProjectInfo(projectId);
  return projectPermissions(data?.project.currentUserRole, Boolean(data?.project.archivedAt));
}
