import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FolderPlus, Plus } from 'lucide-react';
import { api } from '../api/client';
import { Dialog } from '../components/Dialog';
import { EmptyState, FormError, LoadError, Loading, PageHeader } from '../components/Page';
import { formatDate } from '../lib/format';
import { useWorkspace, type Project } from '../lib/projectInfo';
import { WorkspaceTabs } from './WorkspaceMembersPage';
import { usePageTitle, useResource } from '../lib/useResource';

interface ProjectRow extends Project {
  description: string | null;
  createdAt: string;
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
  const { data: workspace } = useWorkspace(workspaceId);
  usePageTitle(workspace?.name);
  const [creating, setCreating] = useState(false);
  const { data: projects, error, loading, reload } = useResource(
    () => api.get<ProjectRow[]>(`/workspaces/${workspaceId}/projects`),
    [workspaceId],
  );

  // Creating projects is open only to workspace admins (the server enforces the same rule).
  const isAdmin = workspace?.currentUserRole === 'ADMIN';
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
          isAdmin
            ? 'Projects in this workspace. Each project has its own test cases, plans and runs.'
            : "Projects in this workspace that you're a member of."
        }
        actions={createButton}
      />
      <WorkspaceTabs workspaceId={workspaceId} />
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
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/projects/${p.id}/cases`} className="row-link">{p.name}</Link>
                    {p.description && <p className="cell-sub">{p.description}</p>}
                  </td>
                  <td><span className="project-key project-key--light">{p.key}</span></td>
                  <td className="muted num">{formatDate(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CreateProjectDialog workspaceId={workspaceId} open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
