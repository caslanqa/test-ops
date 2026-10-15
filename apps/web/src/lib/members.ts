import { api } from '../api/client';
import { useResource } from './useResource';

export interface ProjectMember {
  id: string;
  role: 'ADMIN' | 'TESTER' | 'AUTOMATION' | 'VIEWER';
  /** Visitors of the demo workspace get members without their email address. */
  user: { id: string; email?: string; displayName: string };
}

/** Members of a project; the people cases can be assigned to. */
export function useProjectMembers(projectId: string) {
  return useResource(() => api.get<ProjectMember[]>(`/projects/${projectId}/members`), [projectId]);
}
