import { useId, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Archive, ArchiveRestore, ClipboardList, Pencil, Play, Plus } from 'lucide-react';
import { api } from '../../api/client';
import { ArchivedToggle } from '../../components/ArchivedToggle';
import { CaseChecklist, type ChecklistCase } from '../../components/CaseChecklist';
import { Dialog } from '../../components/Dialog';
import { ConfirmDialog } from '../../components/Members';
import { Tag } from '../../components/StatusChip';
import { EmptyState, FormError, LoadError, Loading, PageHeader } from '../../components/Page';
import { formatDate, formatDateTime } from '../../lib/format';
import { useProjectPermissions } from '../../lib/permissions';
import { useProjectMembers } from '../../lib/members';
import { useProjectInfo } from '../../lib/projectInfo';
import type { Suite } from '../../lib/suites';
import { usePageTitle, useResource } from '../../lib/useResource';

/** Name of a run started from a plan: plan name + start time (so several runs from the same plan can be told apart). */
function runTitleFor(planTitle: string): string {
  return `${planTitle} – ${formatDateTime(new Date())}`;
}

interface PlanRow {
  id: string;
  title: string;
  description: string | null;
  environment: string | null;
  configuration: string | null;
  archivedAt: string | null;
  createdAt: string;
  _count: { items: number; runs: number };
}

function EditPlanDialog({ plan, ...props }: Omit<Parameters<typeof EditPlanForm>[0], 'plan'> & { plan: PlanRow | null }) {
  return (
    <Dialog open={plan !== null} onClose={props.onClose} title="Edit plan" wide>
      {plan && <EditPlanForm plan={plan} {...props} />}
    </Dialog>
  );
}

/**
 * Changes a plan's details and cases. Runs started later use the new values; runs already
 * started keep theirs.
 */
function EditPlanForm({
  projectId,
  plan,
  onClose,
  onSaved,
}: {
  projectId: string;
  plan: PlanRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(plan.title);
  const [description, setDescription] = useState(plan.description ?? '');
  const [environment, setEnvironment] = useState(plan.environment ?? '');
  const [configuration, setConfiguration] = useState(plan.configuration ?? '');
  const [caseIds, setCaseIds] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = { title: useId(), description: useId(), environment: useId(), configuration: useId() };
  const planned = useResource(
    () => api.get<{ testCaseIds: string[] }>(`/projects/${projectId}/plans/${plan.id}/case-ids`),
    [projectId, plan.id],
  );
  const cases = useResource(() => api.get<ChecklistCase[]>(`/projects/${projectId}/cases`), [projectId]);
  const suites = useResource(() => api.get<Suite[]>(`/projects/${projectId}/suites`), [projectId]);
  const before = planned.data?.testCaseIds ?? [];
  const selected = caseIds ?? before;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const base = `/projects/${projectId}/plans/${plan.id}`;
      await api.patch(base, {
        title,
        description: description.trim() || null,
        environment: environment.trim() || null,
        configuration: configuration.trim() || null,
      });
      const added = selected.filter((id) => !before.includes(id));
      const removed = before.filter((id) => !selected.includes(id));
      if (added.length > 0) await api.post(`${base}/cases`, { testCaseIds: added });
      for (const id of removed) await api.delete(`${base}/cases/${id}`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the plan");
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
        <textarea id={ids.description} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="field-grid">
        <div className="field">
          <label htmlFor={ids.environment} className="field-label">Environment</label>
          <input id={ids.environment} value={environment} placeholder="e.g. staging" onChange={(e) => setEnvironment(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={ids.configuration} className="field-label">Configuration</label>
          <input id={ids.configuration} value={configuration} placeholder="e.g. chrome" onChange={(e) => setConfiguration(e.target.value)} />
        </div>
      </div>
      {cases.data && suites.data && planned.data ? (
        <CaseChecklist cases={cases.data} suites={suites.data} selected={selected} onChange={setCaseIds} />
      ) : (
        <Loading label="Loading cases…" />
      )}
      <FormError message={error ?? planned.error ?? cases.error} />
      <div className="dialog-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving || !planned.data}>Save changes</button>
      </div>
    </form>
  );
}

// The form mounts only while the dialog is open: state starts clean on every open, and
// the data the form needs is requested when the dialog opens, not when the page loads.
function CreatePlanDialog({ open, ...props }: Parameters<typeof CreatePlanForm>[0] & { open: boolean }) {
  return (
    <Dialog
      open={open}
      onClose={props.onClose}
      title="New plan"
      description="A plan is a curated list of cases for a release or goal; you can start many runs from the same plan."
      wide
    >
      <CreatePlanForm {...props} />
    </Dialog>
  );
}

function CreatePlanForm({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [caseIds, setCaseIds] = useState<string[]>([]);
  const [assigneeId, setAssigneeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const assigneeFieldId = useId();
  const members = useProjectMembers(projectId);
  const cases = useResource(() => api.get<ChecklistCase[]>(`/projects/${projectId}/cases`), [projectId]);
  const suites = useResource(() => api.get<Suite[]>(`/projects/${projectId}/suites`), [projectId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post(`/projects/${projectId}/plans`, {
        title,
        description: description.trim() || undefined,
        testCaseIds: caseIds,
        assigneeId: assigneeId || undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the plan");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="dialog-body" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor={titleId} className="field-label">Title</label>
        <input id={titleId} value={title} required placeholder="e.g. Release 2.4 regression" onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={descriptionId} className="field-label">Description</label>
        <textarea id={descriptionId} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={assigneeFieldId} className="field-label">Assign the cases to</label>
        <select id={assigneeFieldId} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
          <option value="">Nobody yet</option>
          {(members.data ?? []).map((m) => (
            <option key={m.user.id} value={m.user.id}>{m.user.displayName}</option>
          ))}
        </select>
        <p className="field-hint">Runs started from this plan take over the assignment.</p>
      </div>
      {cases.data && suites.data ? (
        <CaseChecklist cases={cases.data} suites={suites.data} selected={caseIds} onChange={setCaseIds} />
      ) : (
        <Loading label="Loading cases…" />
      )}
      <FormError message={error} />
      <div className="dialog-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>Create plan</button>
      </div>
    </form>
  );
}

export function PlansPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const { data: info } = useProjectInfo(projectId);
  const { editRepository, execute } = useProjectPermissions(projectId);
  usePageTitle(info ? `Plans (${info.project.name})` : 'Plans');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [archiving, setArchiving] = useState<PlanRow | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const { data: plans, error, loading, reload } = useResource(
    () => api.get<PlanRow[]>(`/projects/${projectId}/plans${showArchived ? '?includeArchived=true' : ''}`),
    [projectId, showArchived],
  );

  async function restore(plan: PlanRow) {
    setStartError(null);
    try {
      await api.post(`/projects/${projectId}/plans/${plan.id}/restore`);
      reload();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Couldn't restore the plan");
    }
  }

  async function startRun(plan: PlanRow) {
    setStarting(plan.id);
    setStartError(null);
    try {
      const run = await api.post<{ id: string }>(`/projects/${projectId}/runs`, {
        title: runTitleFor(plan.title),
        planId: plan.id,
        source: 'MANUAL',
      });
      navigate(`/projects/${projectId}/runs/${run.id}`);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Couldn't start the run");
      setStarting(null);
    }
  }

  const createButton = editRepository ? (
    <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
      <Plus size={16} aria-hidden="true" />
      New plan
    </button>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Plans"
        description="Reusable test scopes. Start as many runs from each plan as you need."
        actions={
          <>
            <ArchivedToggle checked={showArchived} onChange={setShowArchived} />
            {createButton}
          </>
        }
      />
      {startError && <p className="form-error" role="alert">{startError}</p>}
      {error && <LoadError message={error} onRetry={reload} />}
      {loading && <Loading />}
      {plans && plans.length === 0 && (
        <div className="surface">
          <EmptyState icon={ClipboardList} title="No plans yet" action={createButton}>
            Pick the cases for a release or goal and save them as a plan.
          </EmptyState>
        </div>
      )}
      {plans && plans.length > 0 && (
        <div className="surface table-wrap">
          <table className="data-table">
            <caption className="visually-hidden">Plans</caption>
            <thead>
              <tr>
                <th scope="col" className="col-main">Plan</th>
                <th scope="col" className="num-col">Case</th>
                <th scope="col" className="num-col hide-sm">Run</th>
                <th scope="col" className="hide-sm">Created</th>
                {(execute || editRepository) && <th scope="col"><span className="visually-hidden">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id}>
                  <td>
                    <span className="cell-title">{plan.title}</span>
                    {plan.archivedAt && <> <Tag tone="outline">Archived</Tag></>}
                    {plan.description && <p className="cell-sub">{plan.description}</p>}
                  </td>
                  <td className="num-col num">{plan._count.items}</td>
                  <td className="num-col num hide-sm">{plan._count.runs}</td>
                  <td className="muted num hide-sm">{formatDate(plan.createdAt)}</td>
                  {(execute || editRepository) && (
                  <td className="cell-actions">
                    {execute && !plan.archivedAt && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => startRun(plan)}
                        disabled={starting === plan.id || plan._count.items === 0}
                        aria-label={`Start a run from ${plan.title}`}
                      >
                        <Play size={14} aria-hidden="true" />
                        Start run
                      </button>
                    )}
                    {editRepository && (
                      <>
                        <button type="button" className="icon-button" onClick={() => setEditing(plan)} aria-label={`Edit ${plan.title}`} title="Edit">
                          <Pencil size={16} aria-hidden="true" />
                        </button>
                        {plan.archivedAt ? (
                          <button type="button" className="icon-button" onClick={() => restore(plan)} aria-label={`Restore ${plan.title}`} title="Restore">
                            <ArchiveRestore size={16} aria-hidden="true" />
                          </button>
                        ) : (
                          <button type="button" className="icon-button" onClick={() => setArchiving(plan)} aria-label={`Archive ${plan.title}`} title="Archive">
                            <Archive size={16} aria-hidden="true" />
                          </button>
                        )}
                      </>
                    )}
                  </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CreatePlanDialog
        projectId={projectId}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          reload();
        }}
      />
      <EditPlanDialog
        key={editing?.id ?? 'none'}
        projectId={projectId}
        plan={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reload();
        }}
      />
      <ConfirmDialog
        open={archiving !== null}
        title="Archive this plan?"
        message={`"${archiving?.title ?? ''}" leaves the plan list and can't start runs; runs started from it keep it. You can restore it with "Show archived".`}
        confirmLabel="Archive plan"
        onConfirm={async () => {
          await api.delete(`/projects/${projectId}/plans/${archiving!.id}`);
          setArchiving(null);
          reload();
        }}
        onClose={() => setArchiving(null)}
      />
    </>
  );
}
