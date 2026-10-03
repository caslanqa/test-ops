import type { ProjectRole } from './labels';
import { useProjectInfo } from './projectInfo';

export interface ProjectPermissions {
  role: ProjectRole | undefined;
  /** Creating/editing cases, suites, requirements and plans. */
  editRepository: boolean;
  /** Starting runs, entering results, filing defects. */
  execute: boolean;
  /** Managing project members and their roles. */
  manageMembers: boolean;
}

/**
 * UI counterpart of the server's WRITE_ROLES rules: actions the user can't perform
 * are hidden. Permissions are always checked on the server as well; this only keeps
 * users from running into buttons that would get them a 403.
 */
export function projectPermissions(role: ProjectRole | undefined): ProjectPermissions {
  return {
    role,
    editRepository: role === 'ADMIN' || role === 'TESTER',
    execute: role === 'ADMIN' || role === 'TESTER' || role === 'AUTOMATION',
    manageMembers: role === 'ADMIN',
  };
}

export function useProjectPermissions(projectId: string | undefined): ProjectPermissions {
  const { data } = useProjectInfo(projectId);
  return projectPermissions(data?.project.currentUserRole);
}
