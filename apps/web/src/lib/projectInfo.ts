import { api } from '../api/client';
import { useResource } from './useResource';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  /** Yalnızca tekil workspace yanıtında gelir. */
  currentUserRole?: 'ADMIN' | 'MEMBER';
}

export interface Project {
  id: string;
  key: string;
  name: string;
  workspaceId: string;
  /** Yalnızca tekil proje yanıtında gelir; workspace admin'leri ADMIN görünür. */
  currentUserRole?: 'ADMIN' | 'TESTER' | 'AUTOMATION' | 'VIEWER';
}

export interface ProjectInfo {
  project: Project;
  workspace: Workspace;
}

// Sidebar, üst bar ve sayfalar aynı kaydı ayrı ayrı istemesin diye oturum boyunca önbellek.
const cache = new Map<string, Promise<ProjectInfo>>();
const workspaceCache = new Map<string, Promise<Workspace>>();

/**
 * Oturum değişince (giriş, çıkış, kayıt) çağrılır: önbellekteki roller bir önceki
 * kullanıcıya aittir ve yeni kullanıcıya gösterilmemelidir.
 */
export function clearProjectInfoCache() {
  cache.clear();
  workspaceCache.clear();
}

/** Workspace'i getirir; başarısız istekler önbellekte tutulmaz. */
export function fetchWorkspace(workspaceId: string): Promise<Workspace> {
  let pending = workspaceCache.get(workspaceId);
  if (!pending) {
    pending = api.get<Workspace>(`/workspaces/${workspaceId}`);
    pending.catch(() => workspaceCache.delete(workspaceId));
    workspaceCache.set(workspaceId, pending);
  }
  return pending;
}

/** Proje ve bağlı workspace'i getirir; başarısız istekler önbellekte tutulmaz. */
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
