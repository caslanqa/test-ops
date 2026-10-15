import { useSyncExternalStore } from 'react';
import { api } from '../api/client';
import { useResource } from './useResource';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  /** Only present in the single-workspace response. */
  currentUserRole?: 'ADMIN' | 'MEMBER';
  /** The built-in DEMO workspace: every signed-in user can look around in it, read-only. */
  isDemo?: boolean;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  workspaceId: string;
  /** The caller's role in the project (in the single-project and workspace-list responses); workspace admins appear as ADMIN. */
  currentUserRole?: 'ADMIN' | 'TESTER' | 'AUTOMATION' | 'VIEWER';
  /** Set while the project is archived; it is read-only until an admin restores it. */
  archivedAt?: string | null;
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

// Bumped by recordsChanged(), so the hooks below and lists of names (the side menu) load again.
let recordsVersion = 0;
const versionListeners = new Set<() => void>();

/**
 * Call after renaming, archiving or deleting a workspace or project, or after changing someone's
 * role: the cached copies are dropped, and everything showing them loads again.
 */
export function recordsChanged() {
  clearProjectInfoCache();
  recordsVersion += 1;
  for (const listener of versionListeners) listener();
}

/** Changes whenever recordsChanged() runs; put it in a useResource's dependencies to reload then. */
export function useRecordsVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      versionListeners.add(listener);
      return () => versionListeners.delete(listener);
    },
    () => recordsVersion,
  );
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
  const version = useRecordsVersion();
  return useResource<ProjectInfo | null>(
    () => (projectId ? fetchProjectInfo(projectId) : Promise.resolve(null)),
    [projectId, version],
  );
}

export function useWorkspace(workspaceId: string | undefined) {
  const version = useRecordsVersion();
  return useResource<Workspace | null>(
    () => (workspaceId ? fetchWorkspace(workspaceId) : Promise.resolve(null)),
    [workspaceId, version],
  );
}
