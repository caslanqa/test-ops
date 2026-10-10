import { useId, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Bug, ExternalLink, Pencil, Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import { Dialog } from '../../components/Dialog';
import { ConfirmDialog } from '../../components/Members';
import { EmptyState, FormError, LoadError, Loading, PageHeader } from '../../components/Page';
import { PriorityMark, Tag } from '../../components/StatusChip';
import { formatDate } from '../../lib/format';
import { DEFECT_SEVERITY_LABEL, DEFECT_STATUS_LABEL, labelOf } from '../../lib/labels';
import { useProjectMembers, type ProjectMember } from '../../lib/members';
import { useProjectPermissions } from '../../lib/permissions';
import { useProjectInfo } from '../../lib/projectInfo';
import { plural } from '../../lib/format';
import { usePageTitle, useResource } from '../../lib/useResource';

interface Defect {
  id: string;
  title: string;
  description: string | null;
  status: string;
  severity: string;
  assigneeId: string | null;
  externalProvider: string | null;
  externalIssueId: string | null;
  externalUrl: string | null;
  createdAt: string;
  _count: { results: number };
}

/** Only http(s) URLs open as links; other schemes from the free-text field (javascript: etc.) are blocked. */
function safeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function EditDefectDialog({ defect, ...props }: Omit<Parameters<typeof EditDefectForm>[0], 'defect'> & { defect: Defect | null }) {
  return (
    <Dialog open={defect !== null} onClose={props.onClose} title="Edit defect">
      {defect && <EditDefectForm defect={defect} {...props} />}
    </Dialog>
  );
}

/** Status, severity and assignee move a defect through its lifecycle; emptied fields are cleared. */
function EditDefectForm({
  projectId,
  defect,
  members,
  onClose,
  onSaved,
}: {
  projectId: string;
  defect: Defect;
  members: ProjectMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(defect.title);
  const [description, setDescription] = useState(defect.description ?? '');
  const [status, setStatus] = useState(defect.status);
  const [severity, setSeverity] = useState(defect.severity);
  const [assigneeId, setAssigneeId] = useState(defect.assigneeId ?? '');
  const [externalProvider, setExternalProvider] = useState(defect.externalProvider ?? '');
  const [externalIssueId, setExternalIssueId] = useState(defect.externalIssueId ?? '');
  const [externalUrl, setExternalUrl] = useState(defect.externalUrl ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = {
    title: useId(), description: useId(), status: useId(), severity: useId(), assignee: useId(),
    provider: useId(), issue: useId(), url: useId(),
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/projects/${projectId}/defects/${defect.id}`, {
        title,
        description: description.trim() || null,
        status,
        severity,
        assigneeId: assigneeId || null,
        externalProvider: externalProvider.trim() || null,
        externalIssueId: externalIssueId.trim() || null,
        externalUrl: externalUrl.trim() || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the defect");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="dialog-body" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor={ids.title} className="field-label">Title</label>
        <input id={ids.title} value={title} required onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={ids.description} className="field-label">Description</label>
        <textarea id={ids.description} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="field-grid">
        <div className="field">
          <label htmlFor={ids.status} className="field-label">Status</label>
          <select id={ids.status} value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(DEFECT_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.severity} className="field-label">Severity</label>
          <select id={ids.severity} value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {Object.entries(DEFECT_SEVERITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.assignee} className="field-label">Assignee</label>
          <select id={ids.assignee} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Unassigned</option>
            {defect.assigneeId && !members.some((m) => m.user.id === defect.assigneeId) && (
              <option value={defect.assigneeId}>Current assignee</option>
            )}
            {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.displayName}</option>)}
          </select>
        </div>
      </div>
      <div className="field-grid">
        <div className="field">
          <label htmlFor={ids.provider} className="field-label">Issue tracker</label>
          <input id={ids.provider} value={externalProvider} placeholder="e.g. Jira" onChange={(e) => setExternalProvider(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={ids.issue} className="field-label">Issue key</label>
          <input id={ids.issue} value={externalIssueId} placeholder="e.g. SHOP-142" onChange={(e) => setExternalIssueId(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor={ids.url} className="field-label">Issue link</label>
        <input id={ids.url} type="url" value={externalUrl} placeholder="https://" onChange={(e) => setExternalUrl(e.target.value)} />
      </div>
      <FormError message={error} />
      <div className="dialog-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>Save changes</button>
      </div>
    </form>
  );
}

export function DefectsPage() {
  const { projectId = '' } = useParams();
  const { data: info } = useProjectInfo(projectId);
  usePageTitle(info ? `Defects (${info.project.name})` : 'Defects');
  const { execute, deleteRecords } = useProjectPermissions(projectId);
  const members = useProjectMembers(projectId);
  const memberName = new Map((members.data ?? []).map((m) => [m.user.id, m.user.displayName]));
  const [editing, setEditing] = useState<Defect | null>(null);
  const [deleting, setDeleting] = useState<Defect | null>(null);
  const { data: defects, error, loading, reload } = useResource(
    () => api.get<Defect[]>(`/projects/${projectId}/defects`),
    [projectId],
  );
  const open = defects?.filter((d) => d.status === 'OPEN' || d.status === 'IN_PROGRESS').length ?? 0;

  return (
    <>
      <PageHeader
        title="Defects"
        description={
          defects && defects.length > 0
            ? `${plural(defects.length, 'defect')}, ${open} open.`
            : 'Bugs found during runs, linked to the results that exposed them.'
        }
      />
      {error && <LoadError message={error} onRetry={reload} />}
      {loading && <Loading />}
      {defects && defects.length === 0 && (
        <div className="surface">
          <EmptyState icon={Bug} title="No defects yet">
            Defects you create with "Create defect" on a failed case in a run are listed here.
          </EmptyState>
        </div>
      )}
      {defects && defects.length > 0 && (
        <div className="surface table-wrap">
          <table className="data-table">
            <caption className="visually-hidden">Defects</caption>
            <thead>
              <tr>
                <th scope="col" className="col-main">Defect</th>
                <th scope="col">Severity</th>
                <th scope="col">Status</th>
                <th scope="col" className="num-col hide-sm">Results</th>
                <th scope="col" className="hide-sm">External issue</th>
                <th scope="col" className="hide-sm">Created</th>
                {(execute || deleteRecords) && <th scope="col"><span className="visually-hidden">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {defects.map((d) => {
                const href = safeUrl(d.externalUrl);
                const externalLabel = d.externalIssueId ?? d.externalProvider;
                return (
                  <tr key={d.id}>
                    <td>
                      <span className="cell-title">{d.title}</span>
                      {d.assigneeId && <p className="cell-sub">Assigned to {memberName.get(d.assigneeId) ?? 'a former member'}</p>}
                    </td>
                    <td><PriorityMark priority={d.severity} /></td>
                    <td>
                      <Tag tone={d.status === 'OPEN' ? 'strong' : 'neutral'}>{labelOf(DEFECT_STATUS_LABEL, d.status)}</Tag>
                    </td>
                    <td className="num-col num hide-sm">{d._count.results}</td>
                    <td className="hide-sm">
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer noopener" className="external-link">
                          {externalLabel ?? 'Open issue'}
                          <ExternalLink size={14} aria-hidden="true" />
                          <span className="visually-hidden"> (opens in a new tab)</span>
                        </a>
                      ) : (
                        <span className="muted">{externalLabel ?? '—'}</span>
                      )}
                    </td>
                    <td className="muted num hide-sm">{formatDate(d.createdAt)}</td>
                    {(execute || deleteRecords) && (
                      <td className="cell-actions">
                        {execute && (
                          <button type="button" className="icon-button" onClick={() => setEditing(d)} aria-label={`Edit ${d.title}`} title="Edit">
                            <Pencil size={16} aria-hidden="true" />
                          </button>
                        )}
                        {deleteRecords && (
                          <button type="button" className="icon-button" onClick={() => setDeleting(d)} aria-label={`Delete ${d.title}`} title="Delete">
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <EditDefectDialog
        key={editing?.id ?? 'none'}
        projectId={projectId}
        defect={editing}
        members={members.data ?? []}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reload();
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this defect?"
        message={`"${deleting?.title ?? ''}" is deleted with its attachments; the results it was linked to stay. This can't be undone.`}
        confirmLabel="Delete defect"
        onConfirm={async () => {
          await api.delete(`/projects/${projectId}/defects/${deleting!.id}`);
          setDeleting(null);
          reload();
        }}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
