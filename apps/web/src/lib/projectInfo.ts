import { api } from '../api/client';
import { useResource } from './useResource';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  /** Only present in the single-workspace response. */
  currentUserRole?: 'ADMIN' | 'MEMBER';
}

export interface Project {
  id: string;
  key: string;
  name: string;
  workspaceId: string;
  /** Only present in the single-project response; workspace admins appear as ADMIN. */
  currentUserRole?: 'ADMIN' | 'TESTER' | 'AUTOMATION' | 'VIEWER';
}

export interface ProjectInfo {
  project: Project;
  workspace: Workspace;
}

// Session-long cache so the sidebar, top bar and pages don't each request the same record.
const cache = new Map<string, Promise<ProjectInfo>>();
const workspaceCache = new Map<string, Promise<Workspace>>();

/**
 * Called when the session changes (sign-in, sign-out, registration): cached roles belong
 * to the previous user and must not be shown to the new one.
 */
export function clearProjectInfoCache() {
  cache.clear();
  workspaceCache.clear();
}

/** Fetches a workspace; failed requests are not cached. */
export function fetchWorkspace(workspaceId: string): Promise<Workspace> {
  let pending = workspaceCache.get(workspaceId);
  if (!pending) {
    pending = api.get<Workspace>(`/workspaces/${workspaceId}`);
    pending.catch(() => workspaceCache.delete(workspaceId));
    workspaceCache.set(workspaceId, pending);
  }
  return pending;
}

/** Fetches a project and its workspace; failed requests are not cached. */
export function fetchProjectInfo(projectId: string): Promise<ProjectInfo> {
  let pending = cache.get(projectId);
  if (!pending) {
    pending = (async () => {
      const project = await api.get<Project>(`/projects/${projectId}`);
      const workspace = await fetchWorkspace(project.workspaceId);
      return { project, workspace };
    })();
    pending.catch(() => cache.delete(projectId));
    cache.set(projectId, pending);
  }
  return pending;
}

export function useProjectInfo(projectId: string | undefined) {
  return useResource<ProjectInfo | null>(
    () => (projectId ? fetchProjectInfo(projectId) : Promise.resolve(null)),
    [projectId],
  );
}

export function useWorkspace(workspaceId: string | undefined) {
  return useResource<Workspace | null>(
    () => (workspaceId ? fetchWorkspace(workspaceId) : Promise.resolve(null)),
    [workspaceId],
  );
}
