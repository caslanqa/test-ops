import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArchiveRestore, FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { ArchivedToggle } from '../components/ArchivedToggle';
import { Dialog } from '../components/Dialog';
import { ConfirmDialog } from '../components/Members';
import { EmptyState, FormError, LoadError, Loading, PageHeader } from '../components/Page';
import { Tag } from '../components/StatusChip';
import { TypeToConfirmDialog } from '../components/TypeToConfirmDialog';
import { changedFields, hasChanges } from '../lib/changes';
import { useFocusFallback } from '../lib/focus';
import { formatDate } from '../lib/format';
import { useNotice } from '../lib/notice';
import { recordsChanged, useWorkspace, type Project } from '../lib/projectInfo';
import { WorkspaceTabs } from './WorkspaceMembersPage';
import { usePageTitle, useResource } from '../lib/useResource';

interface ProjectRow extends Project {
  description: string | null;
  createdAt: string;
}

/** Edits a project's name and description; the key stays, since case and run ids are built from it. */
function EditProjectForm({ project, onClose, onSaved }: { project: ProjectRow; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = { name: useId(), description: useId() };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const changes = changedFields(
      { name: project.name, description: project.description ?? null },
      { name: name.trim(), description: description.trim() || null },
    );
    if (!hasChanges(changes)) {
      onClose();
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await api.patch(`/projects/${project.id}`, changes);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the project");
      setSaving(false);
    }
  }

  return (
    <form className="dialog-body" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor={ids.name} className="field-label">Name</label>
        <input id={ids.name} value={name} minLength={2} maxLength={150} required onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={ids.description} className="field-label">Description</label>
        <textarea id={ids.description} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <FormError message={error} />
      <div className="dialog-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>Save project</button>
      </div>
    </form>
  );
}

// The form mounts only while the dialog is open: state starts clean on every open, and
// the data the form needs is requested when the dialog opens, not when the page loads.
function CreateProjectDialog({ open, ...props }: Parameters<typeof CreateProjectForm>[0] & { open: boolean }) {
  return (
    <Dialog open={open} onClose={props.onClose} title="New project">
      <CreateProjectForm {...props} />
    </Dialog>
  );
}

function CreateProjectForm({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const keyId = useId();
  const keyHintId = useId();
  const nameId = useId();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const created = await api.post<Project>(`/workspaces/${workspaceId}/projects`, { key, name });
      onClose();
      navigate(`/projects/${created.id}/cases`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the project");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="dialog-body" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor={nameId} className="field-label">Name</label>
        <input id={nameId} value={name} minLength={2} maxLength={150} required onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={keyId} className="field-label">Project key</label>
        <input
          id={keyId}
          value={key}
          pattern="[A-Z0-9_\-]{2,20}"
          required
          aria-describedby={keyHintId}
          onChange={(e) => setKey(e.target.value.toLocaleUpperCase('en-US'))}
        />
        <p id={keyHintId} className="field-hint">
          2–20 characters: uppercase letters, digits, hyphens or underscores (e.g. WEB, CHECKOUT).
        </p>
      </div>
      <FormError message={error} />
      <div className="dialog-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>Create project</button>
      </div>
    </form>
  );
}

export function WorkspaceDetailPage() {
  const { workspaceId = '' } = useParams();
  const { notify } = useNotice();
  const { data: workspace } = useWorkspace(workspaceId);
  usePageTitle(workspace?.name);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<ProjectRow | null>(null);
  const [archiving, setArchiving] = useState<ProjectRow | null>(null);
  const [deleting, setDeleting] = useState<ProjectRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // The list endpoint gives either the active or the archived projects; "Show archived" lists both.
  const { data: projects, error, loading, reload } = useResource(
    async () => {
      const active = await api.get<ProjectRow[]>(`/workspaces/${workspaceId}/projects`);
      if (!showArchived) return active;
      return [...active, ...(await api.get<ProjectRow[]>(`/workspaces/${workspaceId}/projects?archived=true`))];
    },
    [workspaceId, showArchived],
  );
  const requestFocus = useFocusFallback(projects);

  // Creating projects is open only to workspace admins (the server enforces the same rule).
  const isAdmin = workspace?.currentUserRole === 'ADMIN';
  // Project admins edit, archive and restore their project; deleting one for good is for
  // workspace admins only, once it's archived.
  const canManage = (p: ProjectRow) => p.currentUserRole === 'ADMIN';
  const anyActions = (projects ?? []).some(canManage);

  /** After a project changes, the side menu and cached project details load again too. */
  function changed(message: string) {
    recordsChanged();
    notify(message);
    reload();
  }

  async function restore(project: ProjectRow) {
    setActionError(null);
    try {
      await api.post(`/projects/${project.id}/restore`);
      changed(`Project "${project.name}" restored.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't restore the project");
    }
  }
  const createButton = isAdmin ? (
    <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
      <Plus size={16} aria-hidden="true" />
      New project
    </button>
  ) : undefined;

  return (
    <>
      <PageHeader
        title={workspace?.name ?? 'Workspace'}
        description={
          workspace?.isDemo
            ? isAdmin
              ? 'The demo workspace: everyone who signs in can look around in these projects, read-only.'
              : 'A read-only demo that everyone can look around in. To add cases and run tests, create a workspace of your own.'
            : isAdmin
              ? 'Projects in this workspace. Each project has its own test cases, plans and runs.'
              : "Projects in this workspace that you're a member of."
        }
        actions={
          workspace?.isDemo && !isAdmin ? (
            <Link to="/workspaces?create" className="btn btn-secondary">
              <Plus size={16} aria-hidden="true" />
              New workspace
            </Link>
          ) : (
            <>
              <ArchivedToggle checked={showArchived} onChange={setShowArchived} />
              {createButton}
            </>
          )
        }
      />
      <WorkspaceTabs workspaceId={workspaceId} />
      <FormError message={actionError} />
      {error && <LoadError message={error} onRetry={reload} />}
      {loading && <Loading />}
      {projects && projects.length === 0 && (
        <div className="surface">
          <EmptyState
            icon={FolderPlus}
            title={isAdmin ? 'This workspace has no projects' : "You haven't been added to a project yet"}
            action={createButton}
          >
            {isAdmin
              ? 'Create a project; test cases, plans and runs live inside a project.'
              : 'Projects appear here once a workspace admin adds you.'}
          </EmptyState>
        </div>
      )}
      {projects && projects.length > 0 && (
        <div className="surface table-wrap">
          <table className="data-table">
            <caption className="visually-hidden">Projects</caption>
            <thead>
              <tr>
                <th scope="col" className="col-main">Project</th>
                <th scope="col">Key</th>
                <th scope="col">Created</th>
                {anyActions && (
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                )}
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/projects/${p.id}/cases`} className="row-link">{p.name}</Link>
                    {p.archivedAt && <> <Tag tone="outline">Archived</Tag></>}
                    {p.description && <p className="cell-sub">{p.description}</p>}
                  </td>
                  <td><span className="project-key project-key--light">{p.key}</span></td>
                  <td className="muted num">{formatDate(p.createdAt)}</td>
                  {anyActions && (
                    <td className="cell-actions">
                      {canManage(p) && !p.archivedAt && (
                        <>
                          <button type="button" className="icon-button" onClick={() => { setActionError(null); setEditing(p); }} aria-label={`Edit ${p.name}`} title="Edit">
                            <Pencil size={16} aria-hidden="true" />
                          </button>
                          <button type="button" className="icon-button" onClick={() => { setActionError(null); setArchiving(p); }} aria-label={`Archive ${p.name}`} title="Archive">
                            <Archive size={16} aria-hidden="true" />
                          </button>
                        </>
                      )}
                      {canManage(p) && p.archivedAt && (
                        <button type="button" className="icon-button" onClick={() => restore(p)} aria-label={`Restore ${p.name}`} title="Restore">
                          <ArchiveRestore size={16} aria-hidden="true" />
                        </button>
                      )}
                      {isAdmin && p.archivedAt && (
                        <button type="button" className="icon-button" onClick={() => { setActionError(null); setDeleting(p); }} aria-label={`Delete ${p.name} permanently`} title="Delete permanently">
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CreateProjectDialog workspaceId={workspaceId} open={creating} onClose={() => setCreating(false)} />
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title="Edit project">
        {editing && (
          <EditProjectForm
            project={editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              changed('Project saved.');
            }}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={archiving !== null}
        title="Archive this project?"
        message={`"${archiving?.name ?? ''}" leaves the project lists and becomes read-only; its cases, runs and results are kept. You can restore it with "Show archived".`}
        confirmLabel="Archive project"
        onClose={() => setArchiving(null)}
        onConfirm={async () => {
          await api.delete(`/projects/${archiving!.id}`);
          requestFocus();
          setArchiving(null);
          changed(`Project "${archiving!.name}" archived.`);
        }}
      />
      <TypeToConfirmDialog
        open={deleting !== null}
        title="Delete this project permanently?"
        message={`"${deleting?.name ?? ''}" is deleted for good, with its cases, requirements, plans, runs, results, defects and attachments. This can't be undone.`}
        expected={deleting?.key ?? ''}
        confirmLabel="Delete project"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          await api.delete(`/projects/${deleting!.id}/permanently`, { confirmKey: deleting!.key });
          requestFocus();
          setDeleting(null);
          changed(`Project "${deleting!.name}" deleted.`);
        }}
      />
    </>
  );
}
