import { useId, useState, type FormEvent } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { CopyButton } from '../components/CopyButton';
import { Dialog } from '../components/Dialog';
import { ConfirmDialog, MemberTable, RoleRadioGroup, type MemberRow } from '../components/Members';
import { FormError, LoadError, Loading, PageHeader } from '../components/Page';
import { Select } from '../components/Select';
import { formatDate } from '../lib/format';
import {
  USER_TYPES,
  USER_TYPE_DESCRIPTION,
  USER_TYPE_LABEL,
  WORKSPACE_ROLE_DESCRIPTION,
  WORKSPACE_ROLE_LABEL,
  invitationRoles,
  invitationTypeLabel,
  type UserType,
  type WorkspaceRole,
} from '../lib/labels';
import { useWorkspace } from '../lib/projectInfo';
import { usePageTitle, useResource } from '../lib/useResource';

interface Invitation {
  id: string;
  email: string;
  role: string;
  /** Set with `project`: the role the person gets in that project when they join. */
  projectRole?: string | null;
  project?: { id: string; key: string; name: string } | null;
  expiresAt: string;
}

/** The token is in this response only; the server keeps just its hash. */
interface CreatedInvitation extends Invitation {
  token: string;
}

const ROLE_OPTIONS = (Object.keys(WORKSPACE_ROLE_LABEL) as WorkspaceRole[]).map((role) => ({
  value: role,
  label: WORKSPACE_ROLE_LABEL[role],
  description: WORKSPACE_ROLE_DESCRIPTION[role],
}));

const TYPE_OPTIONS = USER_TYPES.map((type) => ({
  value: type,
  label: USER_TYPE_LABEL[type],
  description: USER_TYPE_DESCRIPTION[type],
}));

/** Sections of the workspace page: projects and members, and for admins settings. */
export function WorkspaceTabs({ workspaceId }: { workspaceId: string }) {
  const { data: workspace } = useWorkspace(workspaceId);
  // The server allows the settings to workspace admins only.
  const isAdmin = workspace?.currentUserRole === 'ADMIN';
  return (
    <nav className="tabs" aria-label="Workspace sections">
      <NavLink to={`/workspaces/${workspaceId}`} end>Projects</NavLink>
      <NavLink to={`/workspaces/${workspaceId}/members`}>Members</NavLink>
      {isAdmin && <NavLink to={`/workspaces/${workspaceId}/ai`}>AI</NavLink>}
      {isAdmin && <NavLink to={`/workspaces/${workspaceId}/settings`}>Settings</NavLink>}
    </nav>
  );
}

/**
 * Invites one email address. The link is shown once; the person joins after signing in with that
 * address, or creates the account with it. Whether the address has an account isn't revealed.
 */
function InviteMemberForm({
  workspaceId,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState('');
  const [type, setType] = useState<UserType>('VIEWER');
  const [projectId, setProjectId] = useState('');
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = { email: useId(), link: useId(), project: useId() };
  // Every type but Workspace admin is given for a project; archived projects can't be picked.
  const projects = useResource(
    () => api.get<{ id: string; key: string; name: string }[]>(`/workspaces/${workspaceId}/projects`),
    [workspaceId],
  );
  const needsProject = type !== 'WORKSPACE_ADMIN';
  const noProject = needsProject && projects.data !== undefined && projects.data.length === 0;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (needsProject && !projectId) {
      setError('Choose the project the person joins.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      setCreated(
        await api.post<CreatedInvitation>(`/workspaces/${workspaceId}/invitations`, {
          email,
          ...invitationRoles(type, projectId),
        }),
      );
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the invitation");
    } finally {
      setSaving(false);
    }
  }

  if (created) {
    const link = `${window.location.origin}/invite/${created.token}`;
    return (
      <div className="dialog-body">
        <p>
          Send this link to <strong>{created.email}</strong>, who joins as <strong>{invitationTypeLabel(created)}</strong>.
          It works once, until {formatDate(created.expiresAt)}, and only with that email address. Copy it now; it
          isn't shown again.
        </p>
        <div className="field">
          <label htmlFor={ids.link} className="field-label">Invitation link</label>
          <div className="copy-field">
            <input id={ids.link} value={link} readOnly className="mono" onFocus={(e) => e.target.select()} />
            <CopyButton text={link} what="invitation link" targetId={ids.link} />
          </div>
        </div>
        <div className="dialog-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    );
  }

  return (
    <form className="dialog-body" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor={ids.email} className="field-label">Email</label>
        <input id={ids.email} type="email" value={email} required onChange={(e) => setEmail(e.target.value)} />
      </div>
      <RoleRadioGroup legend="Type" name="user-type" value={type} options={TYPE_OPTIONS} onChange={(value) => setType(value as UserType)} />
      {needsProject && noProject && (
        <p className="muted">
          This workspace has no active project yet. Create one first, or invite a workspace admin.
        </p>
      )}
      {needsProject && projects.error && <LoadError message={projects.error} onRetry={projects.reload} />}
      {needsProject && !noProject && !projects.error && (
        <div className="field">
          <label htmlFor={ids.project} className="field-label">Project</label>
          <Select id={ids.project} value={projectId} required onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Choose a project</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.key})</option>
            ))}
          </Select>
        </div>
      )}
      <FormError message={error} />
      <div className="dialog-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving || noProject || (needsProject && Boolean(projects.error))}>Create invitation link</button>
      </div>
    </form>
  );
}

/** Invitations nobody has used yet; revoking one makes its link stop working. */
function PendingInvitations({
  invitations,
  onRevoke,
}: {
  invitations: Invitation[];
  onRevoke: (invitation: Invitation) => void;
}) {
  return (
    <section className="members-invitations" aria-labelledby="pending-invitations-title">
      <h2 id="pending-invitations-title" className="section-title">Pending invitations</h2>
      <div className="surface table-wrap">
        <table className="data-table">
          <caption className="visually-hidden">Pending invitations</caption>
          <thead>
            <tr>
              <th scope="col" className="col-main">Email</th>
              <th scope="col">Type</th>
              <th scope="col" className="hide-sm">Expires</th>
              <th scope="col"><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {invitations.map((invitation) => (
              <tr key={invitation.id}>
                <td><span className="cell-title">{invitation.email}</span></td>
                <td>{invitationTypeLabel(invitation)}</td>
                <td className="muted num hide-sm">{formatDate(invitation.expiresAt)}</td>
                <td className="cell-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => onRevoke(invitation)}
                    aria-label={`Revoke the invitation for ${invitation.email}`}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function WorkspaceMembersPage() {
  const { workspaceId = '' } = useParams();
  const { user } = useAuth();
  const { data: workspace } = useWorkspace(workspaceId);
  usePageTitle(workspace ? `Members (${workspace.name})` : 'Members');
  const isAdmin = workspace?.currentUserRole === 'ADMIN';
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<MemberRow | null>(null);
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const { data: members, error, loading, reload } = useResource(
    () => api.get<MemberRow[]>(`/workspaces/${workspaceId}/members`),
    [workspaceId],
  );
  // Only admins may see who is invited.
  const invitations = useResource(
    () => (isAdmin ? api.get<Invitation[]>(`/workspaces/${workspaceId}/invitations`) : Promise.resolve([])),
    [workspaceId, isAdmin],
  );

  return (
    <>
      <PageHeader
        title={workspace?.name ?? 'Workspace'}
        description="Workspace members. People join with an invitation link; only workspace members can be added to projects, and removing someone here also removes them from every project."
        actions={
          isAdmin && (
            <button type="button" className="btn btn-primary" onClick={() => setInviting(true)}>
              <UserPlus size={16} aria-hidden="true" />
              Invite member
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
      {invitations.error && <LoadError message={invitations.error} onRetry={invitations.reload} />}
      {invitations.data && invitations.data.length > 0 && (
        <PendingInvitations invitations={invitations.data} onRevoke={setRevoking} />
      )}
      <Dialog
        open={inviting}
        onClose={() => setInviting(false)}
        title="Invite to the workspace"
        description="Create a link for one email address. The person joins by signing in with that address, or creates the account with the link."
        wide
      >
        <InviteMemberForm
          workspaceId={workspaceId}
          onClose={() => setInviting(false)}
          onCreated={invitations.reload}
        />
      </Dialog>
      <ConfirmDialog
        open={revoking !== null}
        title="Revoke invitation"
        message={revoking ? `The link sent to ${revoking.email} stops working. You can invite them again later.` : ''}
        confirmLabel="Revoke invitation"
        onClose={() => setRevoking(null)}
        onConfirm={async () => {
          if (!revoking) return;
          await api.delete(`/workspaces/${workspaceId}/invitations/${revoking.id}`);
          setRevoking(null);
          invitations.reload();
        }}
      />
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
