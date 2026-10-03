import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Boxes, Plus } from 'lucide-react';
import { api } from '../api/client';
import { Dialog } from '../components/Dialog';
import { EmptyState, FormError, LoadError, Loading, PageHeader } from '../components/Page';
import { slugify } from '../lib/format';
import type { Workspace } from '../lib/projectInfo';
import { usePageTitle, useResource } from '../lib/useResource';

// The form mounts only while the dialog is open: state starts clean on every open, and
// the data the form needs is requested when the dialog opens, not when the page loads.
function CreateWorkspaceDialog({ open, ...props }: Parameters<typeof CreateWorkspaceForm>[0] & { open: boolean }) {
  return (
    <Dialog
      open={open}
      onClose={props.onClose}
      title="New workspace"
      description="A workspace holds your team's projects and members."
    >
      <CreateWorkspaceForm {...props} />
    </Dialog>
  );
}

function CreateWorkspaceForm({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameId = useId();
  const slugId = useId();
  const slugHintId = useId();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const created = await api.post<Workspace>('/workspaces', { name, slug });
      onClose();
      navigate(`/workspaces/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the workspace");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="dialog-body" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor={nameId} className="field-label">Name</label>
        <input
          id={nameId}
          value={name}
          minLength={2}
          maxLength={100}
          required
          onChange={(e) => {
            setName(e.target.value);
            if (!slugEdited) setSlug(slugify(e.target.value));
          }}
        />
      </div>
      <div className="field">
        <label htmlFor={slugId} className="field-label">Slug</label>
        <input
          id={slugId}
          value={slug}
          // The browser compiles pattern with the `v` flag; an unescaped `-` inside a class is invalid.
          pattern="[a-z0-9\-]+"
          required
          aria-describedby={slugHintId}
          onChange={(e) => {
            setSlugEdited(true);
            setSlug(e.target.value);
          }}
        />
        <p id={slugHintId} className="field-hint">
          Lowercase letters, digits and hyphens. Must be unique.
        </p>
      </div>
      <FormError message={error} />
      <div className="dialog-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          Create workspace
        </button>
      </div>
    </form>
  );
}

export function WorkspacesPage() {
  usePageTitle('Workspaces');
  const [creating, setCreating] = useState(false);
  const { data: workspaces, error, loading, reload } = useResource(
    () => api.get<Workspace[]>('/workspaces'),
    [],
  );

  const createButton = (
    <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
      <Plus size={16} aria-hidden="true" />
      New workspace
    </button>
  );

  return (
    <>
      <PageHeader
        title="Workspaces"
        description="Workspaces you're a member of. Projects and roles are managed inside a workspace."
        actions={createButton}
      />
      {error && <LoadError message={error} onRetry={reload} />}
      {loading && <Loading />}
      {workspaces && workspaces.length === 0 && (
        <div className="surface">
          <EmptyState icon={Boxes} title="You don't have a workspace yet" action={createButton}>
            Create a workspace, then add your first project.
          </EmptyState>
        </div>
      )}
      {workspaces && workspaces.length > 0 && (
        <div className="surface table-wrap">
          <table className="data-table">
            <caption className="visually-hidden">Workspaces</caption>
            <thead>
              <tr>
                <th scope="col" className="col-main">Workspace</th>
                <th scope="col">Slug</th>
              </tr>
            </thead>
            <tbody>
              {workspaces.map((w) => (
                <tr key={w.id}>
                  <td>
                    <Link to={`/workspaces/${w.id}`} className="row-link">{w.name}</Link>
                  </td>
                  <td className="muted">{w.slug}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
