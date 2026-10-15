import { useId, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Settings, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { EmptyState, FormError, Loading, PageHeader } from '../components/Page';
import { TypeToConfirmDialog } from '../components/TypeToConfirmDialog';
import { useNotice } from '../lib/notice';
import { clearProjectInfoCache, recordsChanged, useWorkspace, type Workspace } from '../lib/projectInfo';
import { usePageTitle } from '../lib/useResource';
import { WorkspaceTabs } from './WorkspaceMembersPage';

/** Renames the workspace. The slug stays as it is. */
function NameSection({ workspace }: { workspace: Workspace }) {
  const [name, setName] = useState(workspace.name);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const ids = { title: useId(), name: useId(), slug: useId(), slugHint: useId() };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await api.patch(`/workspaces/${workspace.id}`, { name: name.trim() });
      setSaved(true);
      // The side menu, the top bar and the page title show the name.
      recordsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't rename the workspace");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="surface settings-section" aria-labelledby={ids.title}>
      <h2 id={ids.title} className="section-title">Name</h2>
      <form className="settings-form" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor={ids.name} className="field-label">Workspace name</label>
          <input
            id={ids.name}
            value={name}
            minLength={2}
            maxLength={100}
            required
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor={ids.slug} className="field-label">Slug</label>
          <input id={ids.slug} value={workspace.slug} readOnly aria-readonly="true" aria-describedby={ids.slugHint} className="mono" />
          <p id={ids.slugHint} className="field-hint">Set when the workspace was created; it doesn't change.</p>
        </div>
        <FormError message={error} />
        <div className="settings-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>Save name</button>
          <span className="save-status" role="status">{saved && 'Name saved.'}</span>
        </div>
      </form>
    </section>
  );
}

/** Deletes the workspace and everything in it, after its name is typed. */
function DeleteSection({ workspace }: { workspace: Workspace }) {
  const navigate = useNavigate();
  const { notify } = useNotice();
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();

  return (
    <section className="surface settings-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="section-title">Delete workspace</h2>
      <p className="settings-intro">
        Deletes the workspace with every project, case, plan, run, result, defect and attachment in it, and
        everyone loses access to it. This can't be undone. To keep a project's data but stop using it, archive the
        project on the Projects tab instead.
      </p>
      <div className="settings-actions">
        <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>
          <Trash2 size={16} aria-hidden="true" />
          Delete workspace
        </button>
      </div>
      <TypeToConfirmDialog
        open={confirming}
        title="Delete this workspace?"
        message={`Everything in "${workspace.name}" is deleted for good.`}
        expected={workspace.name}
        confirmLabel="Delete workspace"
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          await api.delete(`/workspaces/${workspace.id}`, { confirmName: workspace.name });
          // Only the cache is dropped: telling the open pages to reload would make this one ask for
          // the workspace that is gone. The side menu reloads on the way to /workspaces anyway.
          clearProjectInfoCache();
          notify(`Workspace "${workspace.name}" deleted.`, undefined, true);
          navigate('/workspaces');
        }}
      />
    </section>
  );
}

/** Workspace settings for its admins: the name, and deleting the workspace. */
export function WorkspaceSettingsPage() {
  const { workspaceId = '' } = useParams();
  const { data: workspace, loading } = useWorkspace(workspaceId);
  usePageTitle(workspace ? `Settings (${workspace.name})` : 'Settings');
  // The server allows these changes to workspace admins only.
  const isAdmin = workspace?.currentUserRole === 'ADMIN';

  return (
    <>
      <PageHeader title={workspace?.name ?? 'Workspace'} description="The workspace's name, and deleting the workspace." />
      <WorkspaceTabs workspaceId={workspaceId} />
      {loading && <Loading />}
      {workspace && !isAdmin && (
        <div className="surface">
          <EmptyState icon={Settings} title="Only workspace admins can change these settings">
            Ask a workspace admin to rename or delete this workspace.
          </EmptyState>
        </div>
      )}
      {workspace && isAdmin && (
        <div className="settings-stack">
          <NameSection workspace={workspace} />
          <DeleteSection workspace={workspace} />
        </div>
      )}
    </>
  );
}
