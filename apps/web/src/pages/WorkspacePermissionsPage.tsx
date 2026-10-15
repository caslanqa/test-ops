import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { EmptyState, FormError, LoadError, Loading, PageHeader } from '../components/Page';
import { Select } from '../components/Select';
import {
  PROJECT_ROLE_DESCRIPTION,
  PROJECT_ROLE_LABEL,
  WORKSPACE_ROLE_DESCRIPTION,
  WORKSPACE_ROLE_LABEL,
  type ProjectRole,
  type WorkspaceRole,
} from '../lib/labels';
import { useNotice } from '../lib/notice';
import { recordsChanged, useWorkspace } from '../lib/projectInfo';
import { usePageTitle, useResource } from '../lib/useResource';
import { WorkspaceTabs } from './WorkspaceMembersPage';

interface PermissionMember {
  id: string;
  role: WorkspaceRole;
  user: { id: string; email: string; displayName: string };
}

interface PermissionProject {
  id: string;
  key: string;
  name: string;
}

/** GET /workspaces/:id/permissions */
interface Permissions {
  members: PermissionMember[];
  projects: PermissionProject[];
  projectMembers: { projectId: string; userId: string; role: ProjectRole }[];
}

/** The select's value for "not a member of the project". */
const NO_ACCESS = '';
const PROJECT_ROLES = Object.keys(PROJECT_ROLE_LABEL) as ProjectRole[];
const WORKSPACE_ROLES = Object.keys(WORKSPACE_ROLE_LABEL) as WorkspaceRole[];

const cellKey = (userId: string, projectId: string) => `${userId}:${projectId}`;

/** What each role can do, under the matrix, so the choice in a cell is an informed one. */
function RoleLegend() {
  return (
    <section className="permissions-legend" aria-labelledby="role-legend-title">
      <h2 id="role-legend-title" className="section-title">What each role can do</h2>
      <dl>
        {WORKSPACE_ROLES.map((role) => (
          <div key={`ws-${role}`}>
            <dt>Workspace {WORKSPACE_ROLE_LABEL[role].toLocaleLowerCase('en-US')}</dt>
            <dd>{WORKSPACE_ROLE_DESCRIPTION[role]}</dd>
          </div>
        ))}
        {PROJECT_ROLES.map((role) => (
          <div key={role}>
            {/* "Admin" alone would read like the workspace role above it. */}
            <dt>{role === 'ADMIN' ? 'Project admin' : PROJECT_ROLE_LABEL[role]}</dt>
            <dd>{PROJECT_ROLE_DESCRIPTION[role]}</dd>
          </div>
        ))}
        <div>
          <dt>No access</dt>
          <dd>Doesn't see the project.</dd>
        </div>
      </dl>
    </section>
  );
}

/**
 * Who can do what in the workspace, on one screen: a row per member with their workspace role and
 * their role in each active project. Every change is saved at once. Workspace admins are admins in
 * every project, so their project cells only say so. People join on the Members tab.
 */
export function WorkspacePermissionsPage() {
  const { workspaceId = '' } = useParams();
  const { user } = useAuth();
  const { notify } = useNotice();
  const { data: workspace, loading: workspaceLoading } = useWorkspace(workspaceId);
  usePageTitle(workspace ? `Permissions (${workspace.name})` : 'Permissions');
  // The server answers this page to workspace admins only.
  const isAdmin = workspace?.currentUserRole === 'ADMIN';
  const { data, error, loading, reload } = useResource(
    () => (isAdmin ? api.get<Permissions>(`/workspaces/${workspaceId}/permissions`) : Promise.resolve(null)),
    [workspaceId, isAdmin],
  );
  // Saved changes over the loaded data. Each save answers with what the server stored, so the
  // matrix doesn't reload (and lose its place) after every change.
  const [workspaceRoles, setWorkspaceRoles] = useState<Record<string, WorkspaceRole>>({});
  const [projectRoles, setProjectRoles] = useState<Record<string, ProjectRole | null>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadedRoles = new Map((data?.projectMembers ?? []).map((m) => [cellKey(m.userId, m.projectId), m.role]));
  const workspaceRoleOf = (member: PermissionMember) => workspaceRoles[member.id] ?? member.role;
  const projectRoleOf = (userId: string, projectId: string) => {
    const key = cellKey(userId, projectId);
    return key in projectRoles ? projectRoles[key] : (loadedRoles.get(key) ?? null);
  };

  async function changeWorkspaceRole(member: PermissionMember, role: WorkspaceRole) {
    setSaving(member.id);
    setSaveError(null);
    try {
      await api.patch(`/workspaces/${workspaceId}/members/${member.id}`, { role });
      setWorkspaceRoles((prev) => ({ ...prev, [member.id]: role }));
      notify(`${member.user.displayName} is now a workspace ${WORKSPACE_ROLE_LABEL[role].toLocaleLowerCase('en-US')}.`);
      // Your own role decides what the app offers you, starting with this page.
      if (member.user.id === user?.id) recordsChanged();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't change the workspace role");
    } finally {
      setSaving(null);
    }
  }

  async function changeProjectRole(member: PermissionMember, project: PermissionProject, value: string) {
    const key = cellKey(member.user.id, project.id);
    setSaving(key);
    setSaveError(null);
    try {
      const saved = await api.put<{ role: ProjectRole | null }>(
        `/workspaces/${workspaceId}/permissions/projects/${project.id}/users/${member.user.id}`,
        { role: value === NO_ACCESS ? null : value },
      );
      setProjectRoles((prev) => ({ ...prev, [key]: saved.role }));
      notify(
        saved.role
          ? `${member.user.displayName} is now ${PROJECT_ROLE_LABEL[saved.role]} in ${project.name}.`
          : `${member.user.displayName} no longer has access to ${project.name}.`,
      );
      if (member.user.id === user?.id) recordsChanged();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't change the project role");
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <PageHeader
        title={workspace?.name ?? 'Workspace'}
        description="Who can do what in each project. Changes are saved as soon as you pick a role. Workspace admins are admins in every project; to add people, invite them on the Members tab."
      />
      <WorkspaceTabs workspaceId={workspaceId} />
      {workspaceLoading && <Loading />}
      {workspace && !isAdmin && (
        <div className="surface">
          <EmptyState icon={ShieldCheck} title="Only workspace admins can manage permissions">
            Ask a workspace admin if you need another role.
          </EmptyState>
        </div>
      )}
      {error && <LoadError message={error} onRetry={reload} />}
      {isAdmin && loading && <Loading />}
      <FormError message={saveError} />
      {data && (
        <div className="surface table-wrap">
          <table className="data-table permissions-table">
            <caption className="visually-hidden">Workspace role and project roles of each member</caption>
            <thead>
              <tr>
                <th scope="col" className="col-main">Member</th>
                <th scope="col">Workspace</th>
                {data.projects.map((project) => (
                  <th key={project.id} scope="col">
                    <Link to={`/projects/${project.id}/members`} className="row-link">{project.name}</Link>
                    <span className="project-key project-key--light">{project.key}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.members.map((member) => {
                const workspaceRole = workspaceRoleOf(member);
                const name = member.user.displayName;
                return (
                  <tr key={member.id}>
                    <th scope="row">
                      <span className="member">
                        {/* On a phone the member column stays in view while the projects scroll, so it keeps only the name. */}
                        <span className="avatar avatar--light hide-sm" aria-hidden="true">
                          {name.slice(0, 1).toLocaleUpperCase()}
                        </span>
                        <span className="member-text">
                          <span className="cell-title">
                            {name}
                            {member.user.id === user?.id && <span className="muted"> (you)</span>}
                          </span>
                          <span className="cell-sub hide-sm">{member.user.email}</span>
                        </span>
                      </span>
                    </th>
                    <td>
                      <Select
                        className="inline-select"
                        aria-label={`${name}: workspace role`}
                        value={workspaceRole}
                        disabled={saving === member.id}
                        onChange={(e) => changeWorkspaceRole(member, e.target.value as WorkspaceRole)}
                      >
                        {WORKSPACE_ROLES.map((role) => (
                          <option key={role} value={role}>{WORKSPACE_ROLE_LABEL[role]}</option>
                        ))}
                      </Select>
                    </td>
                    {data.projects.map((project) => {
                      const key = cellKey(member.user.id, project.id);
                      return (
                        <td key={project.id}>
                          {workspaceRole === 'ADMIN' ? (
                            <span className="muted permissions-inherited">Admin (workspace admin)</span>
                          ) : (
                            <Select
                              className="inline-select"
                              aria-label={`${name}: role in ${project.name}`}
                              value={projectRoleOf(member.user.id, project.id) ?? NO_ACCESS}
                              disabled={saving === key}
                              onChange={(e) => changeProjectRole(member, project, e.target.value)}
                            >
                              <option value={NO_ACCESS}>No access</option>
                              {PROJECT_ROLES.map((role) => (
                                <option key={role} value={role}>{PROJECT_ROLE_LABEL[role]}</option>
                              ))}
                            </Select>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && data.projects.length === 0 && (
        <p className="muted permissions-note">This workspace has no active projects yet; project roles appear here once one is created.</p>
      )}
      {data && <RoleLegend />}
    </>
  );
}
