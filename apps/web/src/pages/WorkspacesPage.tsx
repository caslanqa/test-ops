import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Boxes, Info, Plus, Sparkles } from 'lucide-react';
import { api } from '../api/client';
import { Dialog } from '../components/Dialog';
import { ClickableRow } from '../components/ClickableRow';
import { EmptyState, FormError, LoadError, Loading, PageHeader } from '../components/Page';
import { Tag } from '../components/StatusChip';
import { slugify } from '../lib/format';
import { recordsChanged, type Workspace } from '../lib/projectInfo';
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

/** GET /demo-workspace */
interface DemoStatus {
  enabled: boolean;
  workspaceId: string | null;
}

/**
 * Offered to someone who deleted their demo workspace: a fresh one with the example project.
 * Making it takes a moment, since the whole project is written as a user would.
 */
function NewDemoNote() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const demo = await api.post<Workspace>('/demo-workspace');
      recordsChanged();
      navigate(`/workspaces/${demo.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the demo workspace");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="info-note">
        <Sparkles size={16} aria-hidden="true" />
        <span>Try TestOps on example data: a demo workspace has a sample shop's cases, plan, runs and defects.</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={create} disabled={busy}>
          {busy ? 'Creating…' : 'Create a demo workspace'}
        </button>
      </div>
      <FormError message={error} />
    </>
  );
}

export function WorkspacesPage() {
  usePageTitle('Workspaces');
  // ?create opens the new-workspace dialog.
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(() => params.has('create'));
  const closeCreate = () => {
    setCreating(false);
    if (params.has('create')) setParams({}, { replace: true });
  };
  const { data: workspaces, error, loading, reload } = useResource(
    () => api.get<Workspace[]>('/workspaces'),
    [],
  );

  const hasDemo = workspaces?.some((w) => w.isDemo) ?? false;
  // Asked only when the list has no demo: whether this server makes them, to offer a new one.
  const demoStatus = useResource(
    () => (workspaces && !hasDemo ? api.get<DemoStatus>('/demo-workspace') : Promise.resolve(null)),
    [workspaces, hasDemo],
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
      {demoStatus.data?.enabled && <NewDemoNote />}
      {workspaces && workspaces.length === 0 && (
        <div className="surface">
          <EmptyState icon={Boxes} title="You don't have a workspace yet" action={createButton}>
            Create a workspace, then add your first project.
          </EmptyState>
        </div>
      )}
      {hasDemo && (
        <p className="info-note">
          <Info size={16} aria-hidden="true" />
          DEMO is your own workspace with an example shop project: try anything there. Create a workspace of your own for your team's real projects.
        </p>
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
                <ClickableRow key={w.id}>
                  <td>
                    <Link to={`/workspaces/${w.id}`} className="row-link">{w.name}</Link>
                    {w.isDemo && <> <Tag tone="outline">Demo</Tag></>}
                  </td>
                  <td className="muted">{w.slug}</td>
                </ClickableRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CreateWorkspaceDialog open={creating} onClose={closeCreate} />
    </>
  );
}
