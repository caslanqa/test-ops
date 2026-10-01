import { useId, useState, type FormEvent } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Dialog } from '../components/Dialog';
import { ConfirmDialog, MemberTable, RoleRadioGroup, type MemberRow } from '../components/Members';
import { FormError, LoadError, Loading, PageHeader } from '../components/Page';
import { WORKSPACE_ROLE_DESCRIPTION, WORKSPACE_ROLE_LABEL, type WorkspaceRole } from '../lib/labels';
import { useWorkspace } from '../lib/projectInfo';
import { usePageTitle, useResource } from '../lib/useResource';

const ROLE_OPTIONS = (Object.keys(WORKSPACE_ROLE_LABEL) as WorkspaceRole[]).map((role) => ({
  value: role,
  label: WORKSPACE_ROLE_LABEL[role],
  description: WORKSPACE_ROLE_DESCRIPTION[role],
}));

/** Workspace sayfasının bölümleri: projeler ve üyeler. */
export function WorkspaceTabs({ workspaceId }: { workspaceId: string }) {
  return (
    <nav className="tabs" aria-label="Workspace sections">
      <NavLink to={`/workspaces/${workspaceId}`} end>Projects</NavLink>
      <NavLink to={`/workspaces/${workspaceId}/members`}>Members</NavLink>
    </nav>
  );
}

function AddWorkspaceMemberForm({
  workspaceId,
  onClose,
  onAdded,
}: {
  workspaceId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('MEMBER');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = { email: useId(), name: useId(), password: useId(), newHint: useId() };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post(`/workspaces/${workspaceId}/members`, {
        email,
        role,
        displayName: displayName.trim() || undefined,
        password: password || undefined,
      });
      onAdded();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? 'No account exists for this email. Enter a full name and a temporary password to create one.'
          : err instanceof Error
            ? err.message
            : "Couldn't add the member",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="dialog-body" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor={ids.email} className="field-label">Email</label>
        <input id={ids.email} type="email" value={email} required onChange={(e) => setEmail(e.target.value)} />
      </div>
      <RoleRadioGroup legend="Role" name="workspace-role" value={role} options={ROLE_OPTIONS} onChange={setRole} />
      <fieldset className="subfieldset">
        <legend className="field-label">If they don't have an account</legend>
        <p id={ids.newHint} className="field-hint">
          Fill these in if the person has no TestOps account; one is created with these details. Share the
          temporary password with them; they can change it on the Account page after signing in.
        </p>
        <div className="field-grid">
          <div className="field">
            <label htmlFor={ids.name} className="field-label">Full name</label>
            <input id={ids.name} value={displayName} aria-describedby={ids.newHint} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={ids.password} className="field-label">Temporary password</label>
            <input
              id={ids.password}
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={72}
              value={password}
              aria-describedby={ids.newHint}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
      </fieldset>
      <FormError message={error} />
      <div className="dialog-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>Add member</button>
      </div>
    </form>
  );
}

export function WorkspaceMembersPage() {
  const { workspaceId = '' } = useParams();
  const { user } = useAuth();
  const { data: workspace } = useWorkspace(workspaceId);
  usePageTitle(workspace ? `Members (${workspace.name})` : 'Members');
  const isAdmin = workspace?.currentUserRole === 'ADMIN';
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<MemberRow | null>(null);
  const { data: members, error, loading, reload } = useResource(
    () => api.get<MemberRow[]>(`/workspaces/${workspaceId}/members`),
    [workspaceId],
  );

  return (
    <>
      <PageHeader
        title={workspace?.name ?? 'Workspace'}
        description="Workspace members. Only workspace members can be added to projects; removing someone here also removes them from every project."
        actions={
          isAdmin && (
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              <UserPlus size={16} aria-hidden="true" />
              Add member
            </button>
          )
        }
      />
      <WorkspaceTabs workspaceId={workspaceId} />
      {error && <LoadError message={error} onRetry={reload} />}
      {loading && <Loading />}
      {members && (
        <MemberTable
          caption="Workspace members"
          members={members}
          roleOptions={ROLE_OPTIONS}
          canManage={isAdmin}
          currentUserId={user?.id}
          onRoleChange={async (member, role) => {
            await api.patch(`/workspaces/${workspaceId}/members/${member.id}`, { role });
            reload();
          }}
          onRemove={setRemoving}
        />
      )}
      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a workspace member"
        description="Add an existing account by email, or create a new account."
        wide
      >
        <AddWorkspaceMemberForm
          workspaceId={workspaceId}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            reload();
          }}
        />
      </Dialog>
      <ConfirmDialog
        open={removing !== null}
        title="Remove member"
        message={
          removing
            ? `${removing.user.displayName} will be removed from this workspace and all of its projects. Their account isn't deleted.`
            : ''
        }
        confirmLabel="Remove member"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          await api.delete(`/workspaces/${workspaceId}/members/${removing.id}`);
          setRemoving(null);
          reload();
        }}
      />
    </>
  );
}
