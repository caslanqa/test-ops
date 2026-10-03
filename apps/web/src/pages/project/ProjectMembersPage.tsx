import { useId, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Info, UserPlus } from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Dialog } from '../../components/Dialog';
import { ConfirmDialog, MemberTable, RoleRadioGroup, type MemberRow } from '../../components/Members';
import { FormError, LoadError, Loading, PageHeader } from '../../components/Page';
import { PROJECT_ROLE_DESCRIPTION, PROJECT_ROLE_LABEL, type ProjectRole } from '../../lib/labels';
import { useProjectPermissions } from '../../lib/permissions';
import { useProjectInfo } from '../../lib/projectInfo';
import { usePageTitle, useResource } from '../../lib/useResource';

const ROLE_OPTIONS = (Object.keys(PROJECT_ROLE_LABEL) as ProjectRole[]).map((role) => ({
  value: role,
  label: PROJECT_ROLE_LABEL[role],
  description: PROJECT_ROLE_DESCRIPTION[role],
}));

/** People added to the project are picked from the workspace members (the server enforces this too). */
function AddProjectMemberForm({
  projectId,
  workspaceId,
  existingUserIds,
  onClose,
  onAdded,
}: {
  projectId: string;
  workspaceId: string;
  existingUserIds: Set<string>;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('TESTER');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const personId = useId();
  const workspaceMembers = useResource(
    () => api.get<MemberRow[]>(`/workspaces/${workspaceId}/members`),
    [workspaceId],
  );
  const candidates = (workspaceMembers.data ?? []).filter((m) => !existingUserIds.has(m.user.id));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email) {
      setError('Select a person to add.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post(`/projects/${projectId}/members`, { email, role });
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the member");
    } finally {
      setSaving(false);
    }
  }

  if (workspaceMembers.error) return <div className="dialog-body"><LoadError message={workspaceMembers.error} /></div>;
  if (!workspaceMembers.data) return <div className="dialog-body"><Loading /></div>;

  return (
    <form className="dialog-body" onSubmit={onSubmit}>
      {candidates.length === 0 ? (
        <p className="muted">
          Everyone in the workspace is already in this project. To add someone new, first make them a{' '}
          <Link to={`/workspaces/${workspaceId}/members`}>workspace member</Link>.
        </p>
      ) : (
        <div className="field">
          <label htmlFor={personId} className="field-label">Person</label>
          <select id={personId} value={email} required onChange={(e) => setEmail(e.target.value)}>
            <option value="">Choose a workspace member</option>
            {candidates.map((m) => (
              <option key={m.id} value={m.user.email}>
                {m.user.displayName} ({m.user.email})
              </option>
            ))}
          </select>
        </div>
      )}
      <RoleRadioGroup legend="Project role" name="project-role" value={role} options={ROLE_OPTIONS} onChange={setRole} />
      <FormError message={error} />
      <div className="dialog-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving || candidates.length === 0}>
          Add to project
        </button>
      </div>
    </form>
  );
}

export function ProjectMembersPage() {
  const { projectId = '' } = useParams();
  const { user } = useAuth();
  const { data: info } = useProjectInfo(projectId);
  const permissions = useProjectPermissions(projectId);
  usePageTitle(info ? `Members (${info.project.name})` : 'Members');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<MemberRow | null>(null);
  const { data: members, error, loading, reload } = useResource(
    () => api.get<MemberRow[]>(`/projects/${projectId}/members`),
    [projectId],
  );

  return (
    <>
      <PageHeader
        title="Members"
        description="Who can do what in this project. Roles are enforced by the server; actions you can't perform are hidden."
        actions={
          permissions.manageMembers && (
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              <UserPlus size={16} aria-hidden="true" />
              Add member
            </button>
          )
        }
      />
      <p className="info-note">
        <Info size={16} aria-hidden="true" />
        Workspace admins have admin rights in every project, even if they're not listed here.
      </p>
      {error && <LoadError message={error} onRetry={reload} />}
      {loading && <Loading />}
      {members && (
        <MemberTable
          caption="Project members"
          members={members}
          roleOptions={ROLE_OPTIONS}
          canManage={permissions.manageMembers}
          currentUserId={user?.id}
          onRoleChange={async (member, role) => {
            await api.patch(`/projects/${projectId}/members/${member.id}`, { role });
            reload();
          }}
          onRemove={setRemoving}
        />
      )}
      <section className="role-guide" aria-labelledby="role-guide-title">
        <h2 id="role-guide-title" className="section-title">Roles</h2>
        <dl>
          {ROLE_OPTIONS.map((o) => (
            <div key={o.value}>
              <dt>{o.label}</dt>
              <dd>{o.description}</dd>
            </div>
          ))}
        </dl>
      </section>
      {info && (
        <Dialog open={adding} onClose={() => setAdding(false)} title="Add a project member" wide>
          <AddProjectMemberForm
            projectId={projectId}
            workspaceId={info.workspace.id}
            existingUserIds={new Set((members ?? []).map((m) => m.user.id))}
            onClose={() => setAdding(false)}
            onAdded={() => {
              setAdding(false);
              reload();
            }}
          />
        </Dialog>
      )}
      <ConfirmDialog
        open={removing !== null}
        title="Remove from project"
        message={
          removing
            ? `${removing.user.displayName} will lose access to this project. Their workspace membership stays.`
            : ''
        }
        confirmLabel="Remove from project"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          await api.delete(`/projects/${projectId}/members/${removing.id}`);
          setRemoving(null);
          reload();
        }}
      />
    </>
  );
}
