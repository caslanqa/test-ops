import { Fragment, useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArchiveRestore, ChevronRight, Link2, ListChecks, Pencil, Plus, Sparkles } from 'lucide-react';
import { api } from '../../api/client';
import { ArchivedToggle } from '../../components/ArchivedToggle';
import { CaseChecklist, type ChecklistCase } from '../../components/CaseChecklist';
import { ClickableRow } from '../../components/ClickableRow';
import { Dialog } from '../../components/Dialog';
import { GuidanceChoice } from '../../components/GuidanceChoice';
import { ConfirmDialog } from '../../components/Members';
import { useNotice } from '../../lib/notice';
import { EmptyState, FormError, LoadError, Loading, PageHeader } from '../../components/Page';
import { ResultRibbon } from '../../components/ResultRibbon';
import { StatusChip, Tag } from '../../components/StatusChip';
import { OPEN_RUN_STATUSES, type AiRunSummary } from '../../lib/ai';
import { changedFields, hasChanges } from '../../lib/changes';
import { useFocusFallback } from '../../lib/focus';
import { choiceToRequest, loadAppliedGuidance, type RunGuidanceChoice } from '../../lib/guidance';
import { removeLink } from '../../lib/links';
import { useProjectPermissions } from '../../lib/permissions';
import { useProjectInfo } from '../../lib/projectInfo';
import { normalizeCounts } from '../../lib/status';
import type { Suite } from '../../lib/suites';
import { formatDate, plural } from '../../lib/format';
import { AUTOMATION_LABEL, labelOf } from '../../lib/labels';
import { usePageTitle, useResource } from '../../lib/useResource';

interface Requirement {
  id: string;
  title: string;
  description: string | null;
  externalRef: string | null;
  archivedAt: string | null;
  cases: { testCase: { id: string; title: string; automationStatus: string; archivedAt: string | null } }[];
}

/** A linked case's most recent result in the project, and the run it is in. */
interface LatestResult {
  status: string;
  createdAt: string;
  runId: string;
  runTitle: string;
  runCaseId: string;
}

interface CoverageRow {
  requirementId: string;
  caseCount: number;
  hasCoverage: boolean;
  lastResultStatusBreakdown: Record<string, number>;
  cases: { testCaseId: string; latestResult: LatestResult | null }[];
}

/** Linked cases that were never run count as "untested"; the ribbon shows the full coverage. */
function coverageCounts(row: CoverageRow | undefined) {
  const counts = normalizeCounts(row?.lastResultStatusBreakdown);
  const executed = Object.values(counts).reduce((a, b) => a + b, 0);
  counts.UNTESTED += Math.max(0, (row?.caseCount ?? 0) - executed);
  return counts;
}

/**
 * The cases linked to a requirement, under its row: each case's latest result, whether it is
 * automated, and the run of that result. A case's title opens that run showing only this case.
 */
function RequirementCases({
  id,
  projectId,
  requirement,
  coverage,
}: {
  id: string;
  projectId: string;
  requirement: Requirement;
  coverage: CoverageRow | undefined;
}) {
  const latest = new Map((coverage?.cases ?? []).map((c) => [c.testCaseId, c.latestResult]));
  if (requirement.cases.length === 0) {
    return <p id={id} className="muted">No linked cases.</p>;
  }
  return (
    <ul id={id} className="requirement-cases" aria-label={`Cases linked to ${requirement.title}`}>
      {requirement.cases.map(({ testCase }) => {
        const result = latest.get(testCase.id);
        return (
          <li key={testCase.id}>
            <StatusChip status={result?.status ?? 'UNTESTED'} />
            <span className="requirement-case-title">
              {result ? (
                // The run page lists only this case (?only=) with its panel open (?case=), where this
                // result is in the history.
                <Link to={`/projects/${projectId}/runs/${result.runId}?only=${result.runCaseId}&case=${result.runCaseId}`}>
                  {testCase.title}
                </Link>
              ) : (
                testCase.title
              )}
              {testCase.archivedAt && <span className="muted"> (archived)</span>}
            </span>
            <span className="requirement-case-meta muted">
              {labelOf(AUTOMATION_LABEL, testCase.automationStatus)} ·{' '}
              {result ? (
                <>
                  {result.runTitle}
                  <span className="num nowrap"> · {formatDate(result.createdAt)}</span>
                </>
              ) : (
                'Not run yet'
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// The form mounts only while the dialog is open: state starts clean on every open, and
// the data the form needs is requested when the dialog opens, not when the page loads.
function RequirementDialog({ open, ...props }: Parameters<typeof RequirementForm>[0] & { open: boolean }) {
  return (
    <Dialog open={open} onClose={props.onClose} title={props.requirement ? 'Edit requirement' : 'New requirement'}>
      <RequirementForm {...props} />
    </Dialog>
  );
}

/** Creates a requirement, or saves changes to `requirement` when given. */
function RequirementForm({
  projectId,
  requirement,
  onClose,
  onSaved,
}: {
  projectId: string;
  requirement?: Requirement;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(requirement?.title ?? '');
  const [description, setDescription] = useState(requirement?.description ?? '');
  const [externalRef, setExternalRef] = useState(requirement?.externalRef ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = { title: useId(), description: useId(), ref: useId(), refHint: useId() };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (requirement) {
        // Only changed fields are sent; emptied ones are cleared with null.
        const fields = changedFields(
          { title: requirement.title, description: requirement.description, externalRef: requirement.externalRef },
          { title, description: description.trim() || null, externalRef: externalRef.trim() || null },
        );
        if (hasChanges(fields)) await api.patch(`/projects/${projectId}/requirements/${requirement.id}`, fields);
      } else {
        await api.post(`/projects/${projectId}/requirements`, {
          title,
          description: description.trim() || undefined,
          externalRef: externalRef.trim() || undefined,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the requirement");
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
      <div className="field">
        <label htmlFor={ids.ref} className="field-label">External reference</label>
        <input id={ids.ref} value={externalRef} aria-describedby={ids.refHint} onChange={(e) => setExternalRef(e.target.value)} />
        <p id={ids.refHint} className="field-hint">A Jira or GitHub issue key or URL (e.g. SHOP-142).</p>
      </div>
      <FormError message={error} />
      <div className="dialog-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{requirement ? 'Save changes' : 'Create requirement'}</button>
      </div>
    </form>
  );
}

function LinkCasesDialog({
  requirement,
  ...props
}: Omit<Parameters<typeof LinkCasesForm>[0], 'requirement'> & {
  requirement: Requirement | null;
}) {
  return (
    <Dialog
      open={requirement !== null}
      onClose={props.onClose}
      title="Linked cases"
      description={requirement ? `Choose the cases that cover "${requirement.title}"; clear a case to unlink it.` : undefined}
      wide
    >
      {requirement && <LinkCasesForm requirement={requirement} {...props} />}
    </Dialog>
  );
}

function LinkCasesForm({
  projectId,
  requirement,
  onClose,
  onLinked,
  onChanged,
}: {
  projectId: string;
  requirement: Requirement;
  onClose: () => void;
  onLinked: () => void;
  /** Called when something was saved but the dialog stays open (a partly failed save), so the list can refresh. */
  onChanged: () => void;
}) {
  const [caseIds, setCaseIds] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The links are read from the server rather than taken from the list row, so that a retry
  // after a partly failed save works from what is really linked.
  const [freshLinked, setFreshLinked] = useState<string[] | null>(null);
  const current = useResource(
    () => api.get<Requirement>(`/projects/${projectId}/requirements/${requirement.id}`),
    [projectId, requirement.id],
  );
  // Archived cases are loaded too: the ones already linked must stay visible so they can be unlinked.
  const cases = useResource(() => api.get<ChecklistCase[]>(`/projects/${projectId}/cases?includeArchived=true`), [projectId]);
  const suites = useResource(() => api.get<Suite[]>(`/projects/${projectId}/suites`), [projectId]);
  const linked = freshLinked ?? current.data?.cases.map((c) => c.testCase.id) ?? [];
  const selected = caseIds ?? linked;
  const offered = (cases.data ?? []).filter((c) => !c.archivedAt || linked.includes(c.id));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const added = selected.filter((id) => !linked.includes(id));
    const removed = linked.filter((id) => !selected.includes(id));
    setSaving(true);
    setError(null);
    const base = `/projects/${projectId}/requirements/${requirement.id}`;
    try {
      if (added.length > 0) await api.post(`${base}/cases`, { testCaseIds: added });
      for (const id of removed) await removeLink(`${base}/cases/${id}`);
      onLinked();
    } catch (err) {
      setError(
        `${err instanceof Error ? err.message : "Couldn't save the links"} Some changes may already be saved; check the cases and save again.`,
      );
      // Re-read the links so that a retry works out the right difference, and refresh the list behind the dialog.
      try {
        const fresh = await api.get<Requirement>(base);
        setFreshLinked(fresh.cases.map((c) => c.testCase.id));
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
      {cases.data && suites.data && current.data ? (
        <CaseChecklist
          cases={offered}
          suites={suites.data}
          selected={selected}
          onChange={setCaseIds}
        />
      ) : (
        <Loading label="Loading cases…" />
      )}
      <FormError message={error ?? current.error ?? cases.error} />
      <div className="dialog-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving || !current.data}>Save links</button>
      </div>
    </form>
  );
}

export function RequirementsPage() {
  const { projectId = '' } = useParams();
  const { data: info } = useProjectInfo(projectId);
  const { editRepository } = useProjectPermissions(projectId);
  usePageTitle(info ? `Requirements (${info.project.name})` : 'Requirements');
  const [creating, setCreating] = useState(false);
  const [linking, setLinking] = useState<Requirement | null>(null);
  const [editing, setEditing] = useState<Requirement | null>(null);
  const [archiving, setArchiving] = useState<Requirement | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  // Requirements whose linked cases are listed under their row.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const { notify } = useNotice();
  const navigate = useNavigate();
  // The requirement a run is being started for; the button waits, so a double click starts one run.
  const [starting, setStarting] = useState<string | null>(null);
  // Whether AI is on for the project decides whether the rows get a "Draft test cases" action.
  const aiStatus = useResource(
    () => api.get<{ enabled: boolean }>(`/projects/${projectId}/ai/status`).catch(() => ({ enabled: false })),
    [projectId],
  );
  const aiEnabled = Boolean(aiStatus.data?.enabled);
  // The guidance that applies to the project: when there is some, drafting asks which of it to use first.
  const applied = useResource(
    () => (aiEnabled ? loadAppliedGuidance(projectId).catch(() => []) : Promise.resolve([])),
    [projectId, aiEnabled],
  );
  const [choosing, setChoosing] = useState<Requirement | null>(null);
  const [choice, setChoice] = useState<RunGuidanceChoice>({ mode: 'EFFECTIVE' });
  // The newest runs of the project; a requirement with a run that is going or waiting links to it instead.
  const aiRuns = useResource(
    () => (aiEnabled ? api.get<AiRunSummary[]>(`/projects/${projectId}/ai/runs?limit=100`).catch(() => []) : Promise.resolve([])),
    [projectId, aiEnabled],
  );
  const openRunOf = (requirementId: string) =>
    (aiRuns.data ?? []).find((run) => run.input.requirementId === requirementId && OPEN_RUN_STATUSES.includes(run.status));
  const reqRes = useResource(
    () => api.get<Requirement[]>(`/projects/${projectId}/requirements${showArchived ? '?includeArchived=true' : ''}`),
    [projectId, showArchived],
  );
  const coverageRes = useResource(
    () => api.get<CoverageRow[]>(`/projects/${projectId}/requirements/coverage`),
    [projectId],
  );
  const coverageById = new Map((coverageRes.data ?? []).map((row) => [row.requirementId, row]));
  const requirements = reqRes.data;
  const untested = requirements?.filter((r) => !r.archivedAt && r.cases.length === 0).length ?? 0;
  const active = requirements?.filter((r) => !r.archivedAt).length ?? 0;

  function reload() {
    reqRes.reload();
    coverageRes.reload();
  }

  // A requirement's row can disappear with the change; focus then moves to the page heading.
  const requestFocus = useFocusFallback(requirements);

  function toggle(requirementId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(requirementId)) next.delete(requirementId);
      else next.add(requirementId);
      return next;
    });
  }

  /** Opens a dialog; a message from an earlier action no longer applies. */
  function open(action: () => void) {
    setActionError(null);
    action();
  }

  /** With guidance in the project the person chooses which of it to use first; without any the run just starts. */
  function draftWithAi(r: Requirement) {
    if (starting) return;
    if ((applied.data ?? []).length > 0) {
      setChoice({ mode: 'EFFECTIVE' });
      setChoosing(r);
      return;
    }
    return startRun(r);
  }

  async function startRun(r: Requirement, guidance?: RunGuidanceChoice) {
    if (starting) return;
    setStarting(r.id);
    setActionError(null);
    try {
      const started = await api.post<{ runId: string }>(`/projects/${projectId}/ai/runs`, {
        type: 'REQUIREMENT_TO_CASES',
        requirementId: r.id,
        ...(guidance ? { guidance: choiceToRequest(guidance) } : {}),
      });
      navigate(`/projects/${projectId}/ai/runs/${started.runId}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't start the AI run");
      setChoosing(null);
    } finally {
      setStarting(null);
    }
  }

  async function restore(r: Requirement) {
    setActionError(null);
    try {
      await api.post(`/projects/${projectId}/requirements/${r.id}/restore`);
      notify(`Requirement "${r.title}" restored.`);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't restore the requirement");
    }
  }

  const createButton = editRepository ? (
    <button type="button" className="btn btn-primary" onClick={() => open(() => setCreating(true))}>
      <Plus size={16} aria-hidden="true" />
      New requirement
    </button>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Requirements"
        description={
          active > 0
            ? untested > 0
              ? `${plural(active, 'requirement')}; ${untested} not linked to any case yet.`
              : `${plural(active, 'requirement')}; all covered by at least one case.`
            : 'Link requirements to cases to see coverage and latest results here.'
        }
        actions={
          <>
            <ArchivedToggle checked={showArchived} onChange={(checked) => open(() => setShowArchived(checked))} />
            {createButton}
          </>
        }
      />
      {reqRes.error && <LoadError message={reqRes.error} onRetry={reload} />}
      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {reqRes.loading && <Loading />}
      {requirements && requirements.length === 0 && (
        <div className="surface">
          <EmptyState icon={ListChecks} title="No requirements yet" action={createButton}>
            Add requirements and link them to cases to see which ones have no tests.
          </EmptyState>
        </div>
      )}
      {requirements && requirements.length > 0 && (
        <div className="surface table-wrap">
          <table className="data-table">
            <caption className="visually-hidden">Requirements and coverage</caption>
            <thead>
              <tr>
                <th scope="col" className="col-main">Requirement</th>
                <th scope="col" className="col-ribbon">Latest results</th>
                {editRepository && <th scope="col"><span className="visually-hidden">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {requirements.map((r) => {
                const coverage = coverageById.get(r.id);
                const shown = r.cases.slice(0, 3);
                const isOpen = expanded.has(r.id);
                const casesId = `requirement-${r.id}-cases`;
                return (
                  <Fragment key={r.id}>
                  <ClickableRow className={isOpen ? 'is-expanded' : undefined}>
                    <td>
                      {/* The title opens the list of linked cases under the row. */}
                      <button
                        type="button"
                        className="row-button disclosure-button"
                        aria-expanded={isOpen}
                        aria-controls={isOpen ? casesId : undefined}
                        onClick={() => toggle(r.id)}
                      >
                        <ChevronRight size={16} aria-hidden="true" className="disclosure-icon" />
                        {r.title}
                      </button>
                      {r.externalRef && <span className="ref"> {r.externalRef}</span>}
                      {r.archivedAt && <> <Tag tone="outline">Archived</Tag></>}
                      {isOpen ? null : r.cases.length > 0 ? (
                        <p className="cell-sub">
                          {shown.map((c) => (c.testCase.archivedAt ? `${c.testCase.title} (archived)` : c.testCase.title)).join(', ')}
                          {r.cases.length > shown.length && ` and ${r.cases.length - shown.length} more`}
                        </p>
                      ) : (
                        <p className="cell-sub">No linked cases.</p>
                      )}
                    </td>
                    <td className="col-ribbon">
                      {r.archivedAt ? (
                        // Coverage leaves out archived requirements, so there is no ribbon to show.
                        <Tag tone="outline">Archived</Tag>
                      ) : r.cases.length === 0 ? (
                        <Tag tone="outline">No coverage</Tag>
                      ) : (
                        <div className="ribbon-cell-wrap">
                          <ResultRibbon counts={coverageCounts(coverage)} size="md" label={r.title} showCounts />
                          <span className="ribbon-fraction num">{plural(r.cases.length, 'case')}</span>
                        </div>
                      )}
                    </td>
                    {editRepository && (
                    <td className="cell-actions">
                      {aiEnabled && !r.archivedAt && (
                        openRunOf(r.id) ? (
                          <Link
                            to={`/projects/${projectId}/ai/runs/${openRunOf(r.id)!.id}`}
                            className="btn btn-secondary btn-sm"
                            aria-label={`AI drafts for ${r.title}`}
                          >
                            <Sparkles size={14} aria-hidden="true" />
                            AI drafts
                          </Link>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={starting !== null}
                            onClick={() => draftWithAi(r)}
                            aria-label={`Draft test cases for ${r.title}`}
                          >
                            <Sparkles size={14} aria-hidden="true" />
                            Draft test cases
                          </button>
                        )
                      )}
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => open(() => setLinking(r))}
                        aria-label={`Linked cases of ${r.title}`}
                      >
                        <Link2 size={14} aria-hidden="true" />
                        Cases
                      </button>
                      <button type="button" className="icon-button" onClick={() => open(() => setEditing(r))} aria-label={`Edit ${r.title}`} title="Edit">
                        <Pencil size={16} aria-hidden="true" />
                      </button>
                      {r.archivedAt ? (
                        <button type="button" className="icon-button" onClick={() => restore(r)} aria-label={`Restore ${r.title}`} title="Restore">
                          <ArchiveRestore size={16} aria-hidden="true" />
                        </button>
                      ) : (
                        <button type="button" className="icon-button" onClick={() => open(() => setArchiving(r))} aria-label={`Archive ${r.title}`} title="Archive">
                          <Archive size={16} aria-hidden="true" />
                        </button>
                      )}
                    </td>
                    )}
                  </ClickableRow>
                  {isOpen && (
                    <tr className="requirement-cases-row">
                      <td colSpan={editRepository ? 3 : 2}>
                        <RequirementCases id={casesId} projectId={projectId} requirement={r} coverage={coverage} />
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
      <RequirementDialog
        projectId={projectId}
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          reload();
        }}
      />
      <RequirementDialog
        projectId={projectId}
        requirement={editing ?? undefined}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          notify('Requirement updated.');
          reload();
        }}
      />
      <ConfirmDialog
        open={archiving !== null}
        title="Archive this requirement?"
        message={`"${archiving?.title ?? ''}" leaves the requirement list and coverage; its case links are kept. You can restore it with "Show archived".`}
        confirmLabel="Archive requirement"
        onConfirm={async () => {
          await api.delete(`/projects/${projectId}/requirements/${archiving!.id}`);
          requestFocus();
          setArchiving(null);
          notify(`Requirement "${archiving!.title}" archived.`);
          reload();
        }}
        onClose={() => setArchiving(null)}
      />
      <Dialog
        open={choosing !== null}
        onClose={() => setChoosing(null)}
        title="Draft test cases"
        description={choosing ? `For “${choosing.title}”. The run keeps the guidance you choose; editing guidance later does not change it.` : undefined}
      >
        <form
          className="dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            if (choosing) void startRun(choosing, choice);
          }}
        >
          <GuidanceChoice items={applied.data ?? []} value={choice} onChange={setChoice} />
          <div className="dialog-footer">
            <button type="button" className="btn btn-secondary" onClick={() => setChoosing(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={starting !== null}>Draft test cases</button>
          </div>
        </form>
      </Dialog>
      <LinkCasesDialog
        projectId={projectId}
        requirement={linking}
        onClose={() => setLinking(null)}
        onLinked={() => {
          setLinking(null);
          notify('Linked cases updated.');
          reload();
        }}
        onChanged={reload}
      />
    </>
  );
}
