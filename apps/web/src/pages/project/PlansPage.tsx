import { Fragment, useId, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Archive, ArchiveRestore, Bot, ChevronRight, ClipboardList, Hand, Pencil, Play, Plus } from 'lucide-react';
import { api } from '../../api/client';
import { ArchivedToggle } from '../../components/ArchivedToggle';
import { CaseChecklist, type ChecklistCase } from '../../components/CaseChecklist';
import { Dialog } from '../../components/Dialog';
import { ConfirmDialog } from '../../components/Members';
import { useNotice } from '../../lib/notice';
import { PriorityMark, Tag } from '../../components/StatusChip';
import { EmptyState, FormError, LoadError, Loading, PageHeader } from '../../components/Page';
import { changedFields, hasChanges } from '../../lib/changes';
import { useFocusFallback } from '../../lib/focus';
import { formatDate, formatDateTime } from '../../lib/format';
import { AUTOMATION_LABEL, labelOf } from '../../lib/labels';
import { removeLink } from '../../lib/links';
import { useProjectPermissions } from '../../lib/permissions';
import { useProjectMembers, type ProjectMember } from '../../lib/members';
import { useProjectInfo } from '../../lib/projectInfo';
import type { Suite } from '../../lib/suites';
import { usePageTitle, useResource } from '../../lib/useResource';
import { Select } from '../../components/Select';

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

/** A plan with its cases in order, as GET …/plans/{planId} returns it. */
interface PlanDetail {
  items: {
    id: string;
    assigneeId: string | null;
    testCase: { id: string; title: string; priority: string; automationStatus: string; archivedAt: string | null };
  }[];
}

/** The value of "Unassigned" in the assign-all list; its empty value is the prompt. */
const UNASSIGN = '__unassign__';

/**
 * The cases of a plan, in plan order, under its row: priority, whether each is automated, and
 * who it is assigned to. Admins and testers assign them here, one by one or all at once, while
 * planning; runs started from the plan take the assignees over. Loaded when the row opens, and
 * again after the plan is edited.
 */
function PlanCases({
  id,
  projectId,
  plan,
  version,
  members,
  canAssign,
  onAssigned,
}: {
  id: string;
  projectId: string;
  plan: PlanRow;
  version: number;
  members: ProjectMember[];
  canAssign: boolean;
  onAssigned: (message: string) => void;
}) {
  const detail = useResource(
    () => api.get<PlanDetail>(`/projects/${projectId}/plans/${plan.id}`),
    [projectId, plan.id, version],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const memberName = new Map(members.map((m) => [m.user.id, m.user.displayName]));
  // An archived plan can't start runs, so its assignees are shown but not changed.
  const editable = canAssign && !plan.archivedAt;

  async function assign(testCaseIds: string[], assigneeId: string | null, message?: string) {
    setSaving(true);
    setError(null);
    try {
      if (testCaseIds.length === 1) {
        await api.patch(`/projects/${projectId}/plans/${plan.id}/cases/${testCaseIds[0]}`, { assigneeId });
      } else {
        await api.patch(`/projects/${projectId}/plans/${plan.id}/cases`, { testCaseIds, assigneeId });
      }
      detail.reload();
      if (message) onAssigned(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change the assignee");
    } finally {
      setSaving(false);
    }
  }

  if (detail.error) return <p id={id} className="form-error" role="alert">{detail.error}</p>;
  if (!detail.data) return <div id={id}><Loading label="Loading the plan's cases…" /></div>;
  const items = detail.data.items;
  if (items.length === 0) return <p id={id} className="muted">This plan has no cases yet.</p>;
  const memberOptions = members.map((m) => (
    <option key={m.user.id} value={m.user.id}>{m.user.displayName}</option>
  ));
  return (
    <div id={id} className="plan-cases-wrap">
      {editable && (
        <div className="plan-cases-tools">
          <Select
            className="inline-select"
            aria-label={`Assign every case of ${plan.title}`}
            value=""
            disabled={saving}
            onChange={(e) => {
              const assigneeId = e.target.value === UNASSIGN ? null : e.target.value;
              const who = assigneeId ? memberName.get(assigneeId) ?? 'the chosen person' : null;
              assign(
                items.map((item) => item.testCase.id),
                assigneeId,
                who ? `Every case of "${plan.title}" assigned to ${who}.` : `Every case of "${plan.title}" unassigned.`,
              );
            }}
          >
            <option value="">Assign every case to…</option>
            <option value={UNASSIGN}>Unassigned</option>
            {memberOptions}
          </Select>
          <span className="field-hint">Runs started from this plan take the assignees over.</span>
        </div>
      )}
      <FormError message={error} />
      <ol className="plan-cases" aria-label={`Cases in ${plan.title}`}>
        {items.map((item, index) => (
          <li key={item.id}>
            <span className="muted num">{index + 1}</span>
            <span className="plan-case-title">
              {item.testCase.title}
              {item.testCase.archivedAt && <span className="muted"> (archived, left out of new runs)</span>}
            </span>
            <PriorityMark priority={item.testCase.priority} />
            <span className="muted">{labelOf(AUTOMATION_LABEL, item.testCase.automationStatus)}</span>
            {editable ? (
              <Select
                className="inline-select"
                aria-label={`Assignee for ${item.testCase.title}`}
                value={item.assigneeId ?? ''}
                disabled={saving}
                onChange={(e) => assign([item.testCase.id], e.target.value || null)}
              >
                <option value="">Unassigned</option>
                {item.assigneeId && !memberName.has(item.assigneeId) && <option value={item.assigneeId}>Assigned</option>}
                {memberOptions}
              </Select>
            ) : (
              <span className="muted">
                {item.assigneeId ? memberName.get(item.assigneeId) ?? 'Assigned' : 'Unassigned'}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** How a case runs in a run: by a tester, or by automation from CI. */
type ExecutionMode = 'MANUAL' | 'AUTOMATED';

const definedMode = (testCase: { automationStatus: string }): ExecutionMode =>
  testCase.automationStatus === 'AUTOMATED' ? 'AUTOMATED' : 'MANUAL';

function StartRunDialog({ plan, ...props }: Omit<Parameters<typeof StartRunForm>[0], 'plan'> & { plan: PlanRow | null }) {
  return (
    <Dialog
      open={plan !== null}
      onClose={props.onClose}
      title="Start a run"
      description={plan ? `From "${plan.title}". Choose how each case runs this time; the cases themselves don't change.` : undefined}
      wide
    >
      {plan && <StartRunForm plan={plan} {...props} />}
    </Dialog>
  );
}

/**
 * Starts a run from a plan. Every case starts as its automation status says (automated cases run
 * from CI, the rest by testers), and can be switched for this run only.
 */
function StartRunForm({
  projectId,
  plan,
  onClose,
  onStarted,
}: {
  projectId: string;
  plan: PlanRow;
  onClose: () => void;
  onStarted: (runId: string) => void;
}) {
  const detail = useResource(() => api.get<PlanDetail>(`/projects/${projectId}/plans/${plan.id}`), [projectId, plan.id]);
  const [title, setTitle] = useState(() => runTitleFor(plan.title));
  // The modes chosen here, by case; a case not in it runs as it is defined.
  const [chosen, setChosen] = useState<Record<string, ExecutionMode>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const titleId = useId();
  // Archived cases are left out of new runs, so they aren't offered.
  const cases = (detail.data?.items ?? []).filter((item) => !item.testCase.archivedAt).map((item) => item.testCase);
  const modeOf = (testCase: PlanDetail['items'][number]['testCase']) => chosen[testCase.id] ?? definedMode(testCase);
  const automated = cases.filter((c) => modeOf(c) === 'AUTOMATED');
  const setAll = (mode: ExecutionMode | null) =>
    setChosen(mode ? Object.fromEntries(cases.map((c) => [c.id, mode])) : {});

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const run = await api.post<{ id: string }>(`/projects/${projectId}/runs`, {
        title: title.trim(),
        planId: plan.id,
        source: 'MANUAL',
        automatedCaseIds: automated.map((c) => c.id),
      });
      onStarted(run.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the run");
      setSaving(false);
    }
  }

  return (
    <form className="dialog-body" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor={titleId} className="field-label">Run title</label>
        <input id={titleId} value={title} required maxLength={300} onChange={(e) => setTitle(e.target.value)} />
      </div>
      {detail.error ? (
        <p className="form-error" role="alert">{detail.error}</p>
      ) : !detail.data ? (
        <Loading label="Loading the plan's cases…" />
      ) : (
        <fieldset className="mode-picker">
          <legend className="field-label">How the cases run</legend>
          <div className="mode-picker-tools">
            <span className="muted" role="status">
              {automated.length} automated, {cases.length - automated.length} manual
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll(null)}>As defined</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll('MANUAL')}>All manual</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll('AUTOMATED')}>All automated</button>
          </div>
          <p className="field-hint">Automated cases wait for their results from CI; testers record the manual ones.</p>
          <ul className="mode-list">
            {cases.map((testCase) => {
              const mode = modeOf(testCase);
              const changed = mode !== definedMode(testCase);
              return (
                <li key={testCase.id}>
                  <span className="mode-case-title">
                    {testCase.title}
                    {changed && <span className="muted"> · changed for this run</span>}
                  </span>
                  <span className="segmented segmented--sm" role="group" aria-label={`How "${testCase.title}" runs`}>
                    <button
                      type="button"
                      aria-pressed={mode === 'MANUAL'}
                      onClick={() => setChosen((current) => ({ ...current, [testCase.id]: 'MANUAL' }))}
                    >
                      <Hand size={14} aria-hidden="true" /> Manual
                    </button>
                    <button
                      type="button"
                      aria-pressed={mode === 'AUTOMATED'}
                      onClick={() => setChosen((current) => ({ ...current, [testCase.id]: 'AUTOMATED' }))}
                    >
                      <Bot size={14} aria-hidden="true" /> Automation
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}
      <FormError message={error} />
      <div className="dialog-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving || !detail.data || cases.length === 0}>
          <Play size={16} aria-hidden="true" />
          Start run
        </button>
      </div>
    </form>
  );
}

// No `key` on the dialog: its form mounts only while it is open, and a changing key would remove
// the open <dialog> from the DOM instead of closing it, which drops keyboard focus.
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
  onChanged,
}: {
  projectId: string;
  plan: PlanRow;
  onClose: () => void;
  onSaved: () => void;
  /** Called when something was saved but the dialog stays open (a partly failed save), so the list can refresh. */
  onChanged: () => void;
}) {
  // What the server holds, for sending only changed fields; updated as saves go through.
  const [baseline, setBaseline] = useState({
    title: plan.title,
    description: plan.description,
    environment: plan.environment,
    configuration: plan.configuration,
  });
  const [title, setTitle] = useState(plan.title);
  const [description, setDescription] = useState(plan.description ?? '');
  const [environment, setEnvironment] = useState(plan.environment ?? '');
  const [configuration, setConfiguration] = useState(plan.configuration ?? '');
  const [caseIds, setCaseIds] = useState<string[] | null>(null);
  // The plan's cases as last read from the server; replaces the first read after a failed save.
  const [freshIds, setFreshIds] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = { title: useId(), description: useId(), environment: useId(), configuration: useId() };
  const planned = useResource(
    () => api.get<{ testCaseIds: string[] }>(`/projects/${projectId}/plans/${plan.id}/case-ids`),
    [projectId, plan.id],
  );
  // Archived cases are loaded too: the ones already in the plan must stay visible so they can be removed.
  const cases = useResource(() => api.get<ChecklistCase[]>(`/projects/${projectId}/cases?includeArchived=true`), [projectId]);
  const suites = useResource(() => api.get<Suite[]>(`/projects/${projectId}/suites`), [projectId]);
  const before = freshIds ?? planned.data?.testCaseIds ?? [];
  const selected = caseIds ?? before;
  const offered = (cases.data ?? []).filter((c) => !c.archivedAt || before.includes(c.id));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const base = `/projects/${projectId}/plans/${plan.id}`;
    try {
      const fields = changedFields(baseline, {
        title,
        description: description.trim() || null,
        environment: environment.trim() || null,
        configuration: configuration.trim() || null,
      });
      if (hasChanges(fields)) {
        await api.patch(base, fields);
        setBaseline((prev) => ({ ...prev, ...fields }));
      }
      const added = selected.filter((id) => !before.includes(id));
      const removed = before.filter((id) => !selected.includes(id));
      if (added.length > 0) await api.post(`${base}/cases`, { testCaseIds: added });
      for (const id of removed) await removeLink(`${base}/cases/${id}`);
      onSaved();
    } catch (err) {
      setError(
        `${err instanceof Error ? err.message : "Couldn't save the plan"} Some changes may already be saved; check the cases and save again.`,
      );
      // Re-read the plan's cases so that a retry works out the right difference, and refresh the list behind the dialog.
      try {
        setFreshIds((await api.get<{ testCaseIds: string[] }>(`${base}/case-ids`)).testCaseIds);
      } catch {
        // Keep the earlier state; the error above is already shown.
      }
      onChanged();
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
        <CaseChecklist cases={offered} suites={suites.data} selected={selected} onChange={setCaseIds} />
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
        <Select id={assigneeFieldId} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
          <option value="">Nobody yet</option>
          {(members.data ?? []).map((m) => (
            <option key={m.user.id} value={m.user.id}>{m.user.displayName}</option>
          ))}
        </Select>
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
  // The plan whose start-run dialog is open.
  const [startFrom, setStartFrom] = useState<PlanRow | null>(null);
  // Plans whose cases are listed under their row, and a counter that refreshes those lists.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [casesVersion, setCasesVersion] = useState(0);
  const members = useProjectMembers(projectId);
  const { notify } = useNotice();
  const { data: plans, error, loading, reload } = useResource(
    () => api.get<PlanRow[]>(`/projects/${projectId}/plans${showArchived ? '?includeArchived=true' : ''}`),
    [projectId, showArchived],
  );

  // An archived plan's row can disappear with the change; focus then moves to the page heading.
  const requestFocus = useFocusFallback(plans);

  function toggle(planId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(planId)) next.delete(planId);
      else next.add(planId);
      return next;
    });
  }

  async function restore(plan: PlanRow) {
    setStartError(null);
    try {
      await api.post(`/projects/${projectId}/plans/${plan.id}/restore`);
      notify(`Plan "${plan.title}" restored.`);
      reload();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Couldn't restore the plan");
    }
  }

  const createButton = editRepository ? (
    <button type="button" className="btn btn-primary" onClick={() => { setStartError(null); setCreating(true); }}>
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
              {plans.map((plan) => {
                const isOpen = expanded.has(plan.id);
                const casesId = `plan-${plan.id}-cases`;
                return (
                <Fragment key={plan.id}>
                <tr className={isOpen ? 'is-expanded' : undefined}>
                  <td>
                    {/* The title opens the list of the plan's cases under the row. */}
                    <button
                      type="button"
                      className="row-button disclosure-button"
                      aria-expanded={isOpen}
                      aria-controls={isOpen ? casesId : undefined}
                      onClick={() => toggle(plan.id)}
                    >
                      <ChevronRight size={16} aria-hidden="true" className="disclosure-icon" />
                      {plan.title}
                    </button>
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
                        onClick={() => { setStartError(null); setStartFrom(plan); }}
                        disabled={plan._count.items === 0}
                        aria-label={`Start a run from ${plan.title}`}
                      >
                        <Play size={14} aria-hidden="true" />
                        Start run
                      </button>
                    )}
                    {editRepository && (
                      <>
                        <button type="button" className="icon-button" onClick={() => { setStartError(null); setEditing(plan); }} aria-label={`Edit ${plan.title}`} title="Edit">
                          <Pencil size={16} aria-hidden="true" />
                        </button>
                        {plan.archivedAt ? (
                          <button type="button" className="icon-button" onClick={() => restore(plan)} aria-label={`Restore ${plan.title}`} title="Restore">
                            <ArchiveRestore size={16} aria-hidden="true" />
                          </button>
                        ) : (
                          <button type="button" className="icon-button" onClick={() => { setStartError(null); setArchiving(plan); }} aria-label={`Archive ${plan.title}`} title="Archive">
                            <Archive size={16} aria-hidden="true" />
                          </button>
                        )}
                      </>
                    )}
                  </td>
                  )}
                </tr>
                {isOpen && (
                  <tr className="expanded-row">
                    <td colSpan={execute || editRepository ? 5 : 4}>
                      <PlanCases
                        id={casesId}
                        projectId={projectId}
                        plan={plan}
                        version={casesVersion}
                        members={members.data ?? []}
                        canAssign={editRepository}
                        onAssigned={(message) => notify(message)}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <StartRunDialog
        projectId={projectId}
        plan={startFrom}
        onClose={() => setStartFrom(null)}
        onStarted={(runId) => navigate(`/projects/${projectId}/runs/${runId}`)}
      />
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
        projectId={projectId}
        plan={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          notify('Plan updated.');
          reload();
          setCasesVersion((v) => v + 1);
        }}
        onChanged={() => {
          reload();
          setCasesVersion((v) => v + 1);
        }}
      />
      <ConfirmDialog
        open={archiving !== null}
        title="Archive this plan?"
        message={`"${archiving?.title ?? ''}" leaves the plan list and can't start runs; runs started from it keep it. You can restore it with "Show archived".`}
        confirmLabel="Archive plan"
        onConfirm={async () => {
          await api.delete(`/projects/${projectId}/plans/${archiving!.id}`);
          requestFocus();
          setArchiving(null);
          notify(`Plan "${archiving!.title}" archived.`);
          reload();
        }}
        onClose={() => setArchiving(null)}
      />
    </>
  );
}
