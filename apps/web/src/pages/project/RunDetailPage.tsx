import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Bot,
  Bug,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Hand,
  Paperclip,
  Pencil,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { api, downloadFile } from '../../api/client';
import { Dialog } from '../../components/Dialog';
import { FormError, LoadError, Loading, PageHeader } from '../../components/Page';
import { ConfirmDialog } from '../../components/Members';
import { useNotice } from '../../lib/notice';
import { ResultRibbon, StatusLegend } from '../../components/ResultRibbon';
import { describeDelivery, type WebhookDelivery } from '../../lib/webhooks';
import { Link as RouterLink } from 'react-router-dom';
import { StatusChip, Tag } from '../../components/StatusChip';
import { changedFields, hasChanges } from '../../lib/changes';
import { formatBytes, formatDate, formatDateTime, formatDuration, plural } from '../../lib/format';
import { RUN_SOURCE_LABEL, RUN_STATUS_LABEL, labelOf } from '../../lib/labels';
import {
  DEFECT_STATUSES,
  RESULT_CHOICES,
  STATUS_META,
  isResultStatus,
  normalizeCounts,
  pendingCount,
  type ResultStatus,
} from '../../lib/status';
import { useProjectPermissions } from '../../lib/permissions';
import { useProjectMembers } from '../../lib/members';
import { useAuth } from '../../auth/AuthContext';
import { usePageTitle, useResource } from '../../lib/useResource';
import { CaseExecution, DefectForResultDialog, EditResultDialog, type SavedResult } from './RunExecution';
import { Select } from '../../components/Select';

interface CaseSnapshot {
  title: string;
  preconditions: string | null;
  description: string | null;
  steps: { position: number; action: string; expectedResult: string | null }[];
}

interface RunCase {
  id: string;
  testCaseId: string;
  assigneeId: string | null;
  status: string;
  /** How the case is meant to run in this run, chosen when the run started. */
  executionMode: 'MANUAL' | 'AUTOMATED';
  position: number;
  caseSnapshot: CaseSnapshot | null;
  testCase: { id: string; title: string };
  /** Results recorded for the case in this run; more than one means it was retried. */
  attemptCount: number;
  /** Time of all its attempts together, when they reported one. */
  durationMs: number | null;
}

interface RunDetail {
  id: string;
  title: string;
  description: string | null;
  status: string;
  source: string;
  environment: string | null;
  build: string | null;
  configuration: string | null;
  createdAt: string;
  completedAt: string | null;
  runCases: RunCase[];
  progress: Record<string, number>;
  /** What deleting the run removes with it. */
  resultCount: number;
  attachmentCount: number;
  /** Sum of the case durations: the testing time, not the time since the run started. */
  durationMs: number;
}

/** The latest result of each case in the run. */
interface ResultRow {
  id: string;
  source: 'MANUAL' | 'AUTOMATION';
  runCase: { testCaseId: string };
}

/** Where a case's latest result came from: a tester in the app, or automation through the API. */
type SourceFilter = 'ALL' | 'MANUAL' | 'AUTOMATION';

/**
 * The run page's filters and open case live in the URL (?status=failed&source=manual&assignee=me
 * &case=…), so a reload, a shared link or the way back from another page shows the same list.
 * ?only=<run case id> lists just that case, for links from elsewhere (e.g. a requirement's case).
 * Unknown values are ignored. The URL is replaced rather than pushed, so Back leaves the run
 * instead of stepping through every filter and case.
 */
function useRunView() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status')?.toUpperCase() ?? '';
  const source = params.get('source')?.toUpperCase();
  function update(changes: Partial<Record<'status' | 'source' | 'assignee' | 'case' | 'only', string | null>>) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  }
  return {
    statusFilter: isResultStatus(status) ? status : null,
    sourceFilter: (source === 'MANUAL' || source === 'AUTOMATION' ? source : 'ALL') as SourceFilter,
    onlyMine: params.get('assignee') === 'me',
    openCaseId: params.get('case'),
    onlyCaseId: params.get('only'),
    setStatusFilter: (value: ResultStatus | null) => update({ status: value?.toLowerCase() ?? null }),
    setSourceFilter: (value: SourceFilter) => update({ source: value === 'ALL' ? null : value.toLowerCase() }),
    setOnlyMine: (value: boolean) => update({ assignee: value ? 'me' : null }),
    setOpenCaseId: (value: string | null) => update({ case: value }),
    showAllCases: () => update({ only: null }),
  };
}

function EditRunDialog({ open, ...props }: Parameters<typeof EditRunForm>[0] & { open: boolean }) {
  return (
    <Dialog open={open} onClose={props.onClose} title="Edit run">
      <EditRunForm {...props} />
    </Dialog>
  );
}

/** The run's own details; its cases and results don't change. */
function EditRunForm({
  projectId,
  run,
  onClose,
  onSaved,
}: {
  projectId: string;
  run: RunDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(run.title);
  const [description, setDescription] = useState(run.description ?? '');
  const [environment, setEnvironment] = useState(run.environment ?? '');
  const [build, setBuild] = useState(run.build ?? '');
  const [configuration, setConfiguration] = useState(run.configuration ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = { title: useId(), description: useId(), environment: useId(), build: useId(), configuration: useId() };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // Only changed fields are sent.
      const fields = changedFields(
        {
          title: run.title,
          description: run.description,
          environment: run.environment,
          build: run.build,
          configuration: run.configuration,
        },
        {
          title,
          description: description.trim() || null,
          environment: environment.trim() || null,
          build: build.trim() || null,
          configuration: configuration.trim() || null,
        },
      );
      if (hasChanges(fields)) await api.patch(`/projects/${projectId}/runs/${run.id}`, fields);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the run");
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
          <input id={ids.environment} value={environment} onChange={(e) => setEnvironment(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={ids.build} className="field-label">Build</label>
          <input id={ids.build} value={build} onChange={(e) => setBuild(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={ids.configuration} className="field-label">Configuration</label>
          <input id={ids.configuration} value={configuration} onChange={(e) => setConfiguration(e.target.value)} />
        </div>
      </div>
      <FormError message={error} />
      <div className="dialog-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>Save changes</button>
      </div>
    </form>
  );
}

interface AttachmentInfo {
  id: string;
  fileName: string;
  sizeBytes: number;
}

interface ResultEntry {
  id: string;
  status: string;
  comment: string | null;
  attemptNumber: number;
  /** The attempt that sets the case's status; the only one the panel lets testers correct. */
  isLatest: boolean;
  source: string;
  automationSourceLabel: string | null;
  authorUserId: string | null;
  createdAt: string;
  durationMs: number | null;
  attachments: AttachmentInfo[];
  stepResults: { stepPosition: number; status: string; comment: string | null; attachments: AttachmentInfo[] }[];
}

/** Files as download buttons with their size. */
function AttachmentList({ files, onDownload }: { files: AttachmentInfo[]; onDownload: (file: AttachmentInfo) => void }) {
  if (files.length === 0) return null;
  return (
    <ul className="attachment-list">
      {files.map((file) => (
        <li key={file.id}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDownload(file)}>
            <Paperclip size={14} aria-hidden="true" />
            {file.fileName}
            <span className="muted">{formatBytes(file.sizeBytes)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Attempts of the case in this run, newest first, with comments, step results and files (FR-043).
 * The latest attempt can be corrected when `onEdit` is given.
 */
function ResultHistory({
  projectId,
  runId,
  runCase,
  steps,
  memberName,
  version,
  onEdit,
}: {
  projectId: string;
  runId: string;
  runCase: RunCase;
  steps: CaseSnapshot['steps'];
  memberName: Map<string, string>;
  version: number;
  onEdit?: (result: ResultEntry) => void;
}) {
  const [downloadError, setDownloadError] = useState<string | null>(null);
  // Each result comes with its own and its steps' file details, so one request fills the list.
  const history = useResource(
    () => api.get<ResultEntry[]>(`/projects/${projectId}/results?runId=${runId}&testCaseId=${runCase.testCaseId}&limit=20`),
    [projectId, runId, runCase.testCaseId, version],
  );

  async function download(file: AttachmentInfo) {
    setDownloadError(null);
    try {
      await downloadFile(`/projects/${projectId}/attachments/${file.id}`, file.fileName);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Couldn't download the file");
    }
  }

  if (history.error) return <p className="form-error" role="alert">{history.error}</p>;
  if (!history.data) return <Loading label="Loading results…" />;
  if (history.data.length === 0) return <p className="muted">No results yet.</p>;
  return (
    <>
      <FormError message={downloadError} />
      <ol className="result-history">
        {history.data.map((r) => (
          <li key={r.id}>
            <div className="result-history-head">
              <StatusChip status={r.status} />
              <span className="muted result-history-meta">
                Attempt {r.attemptNumber} · {formatDateTime(r.createdAt)} ·{' '}
                {r.source === 'AUTOMATION'
                  ? r.automationSourceLabel ?? 'Automation'
                  : (r.authorUserId && memberName.get(r.authorUserId)) ?? 'A project member'}
                {r.durationMs !== null && <> · <span className="num">{formatDuration(r.durationMs)}</span></>}
              </span>
              {onEdit && r.isLatest && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onEdit(r)}
                  aria-label={`Edit attempt ${r.attemptNumber}`}
                >
                  <Pencil size={14} aria-hidden="true" />
                  Edit
                </button>
              )}
            </div>
            {r.comment && <p className="prose">{r.comment}</p>}
            <StepOutcomes stepResults={r.stepResults} steps={steps} onDownload={download} />
            <AttachmentList files={r.attachments} onDownload={download} />
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * Where the case's latest result came from, as an icon plus text so it doesn't rely on the icon
 * alone. Before the first result it shows, dimmed, how the case is planned to run.
 */
function SourceLabel({ result, mode }: { result: ResultRow | undefined; mode: RunCase['executionMode'] }) {
  const manual = result ? result.source === 'MANUAL' : mode === 'MANUAL';
  return (
    <span className={`source-label${result ? '' : ' muted'}`} title={result ? undefined : 'Planned for this run; no result yet'}>
      {manual ? <Hand size={14} aria-hidden="true" /> : <Bot size={14} aria-hidden="true" />}
      {manual ? 'Manual' : 'Automation'}
      {!result && <span className="visually-hidden"> (planned, no result yet)</span>}
    </span>
  );
}

/**
 * The steps of an attempt that didn't pass or have a note or files, with what actually happened;
 * plain passed steps stay quiet.
 */
function StepOutcomes({
  stepResults,
  steps,
  onDownload,
}: {
  stepResults: ResultEntry['stepResults'];
  steps: CaseSnapshot['steps'];
  onDownload: (file: AttachmentInfo) => void;
}) {
  const notable = stepResults.filter((s) => s.status !== 'PASSED' || s.comment || s.attachments.length > 0);
  if (notable.length === 0) return null;
  const number = new Map(steps.map((step, index) => [step.position, index + 1]));
  return (
    <ul className="step-outcomes">
      {notable.map((s) => (
        <li key={s.stepPosition}>
          <span>
            <StatusChip status={s.status} /> Step {number.get(s.stepPosition) ?? s.stepPosition + 1}
            {s.comment && <>: <span className="prose">{s.comment}</span></>}
          </span>
          <AttachmentList files={s.attachments} onDownload={onDownload} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The case's steps as they were when the run started (snapshot) with a result per step, the form
 * for the case result with time spent, a comment and evidence, and the case's results in this run.
 */
function RunCasePanel({
  projectId,
  runId,
  runCase,
  canRecord,
  memberName,
  place,
  previousCase,
  nextCase,
  onOpenCase,
  onSaved,
  onEdited,
  onRetest,
  onClose,
}: {
  projectId: string;
  runId: string;
  runCase: RunCase;
  canRecord: boolean;
  memberName: Map<string, string>;
  /** Where the case is in the list as filtered, e.g. "Case 3 of 12"; null when the filters hide it. */
  place: string | null;
  previousCase: RunCase | null;
  nextCase: RunCase | null;
  onOpenCase: (rc: RunCase) => void;
  onSaved: (message: string, saved: SavedResult) => void;
  onEdited: (message: string) => void;
  onRetest: (rc: RunCase) => void;
  onClose: () => void;
}) {
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<ResultEntry | null>(null);
  // A case with a result can be run again; one already waiting for it can't.
  const canRunAgain = canRecord && runCase.status !== 'UNTESTED' && runCase.status !== 'RETEST';
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const snapshot = runCase.caseSnapshot;
  const steps = [...(snapshot?.steps ?? [])].sort((a, b) => a.position - b.position);

  useEffect(() => {
    headingRef.current?.focus();
  }, [runCase.id]);

  return (
    <aside className="run-panel" aria-labelledby={headingId}>
      <div className="detail-header">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="detail-title">
          {snapshot?.title ?? runCase.testCase.title}
        </h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close steps">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <p className="detail-path">Steps as they were when the run started</p>
      <nav className="run-panel-nav" aria-label="Cases in this run">
        {place && <span className="muted num">{place}</span>}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!previousCase}
          onClick={() => previousCase && onOpenCase(previousCase)}
        >
          <ChevronLeft size={14} aria-hidden="true" />
          Previous case
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!nextCase}
          onClick={() => nextCase && onOpenCase(nextCase)}
        >
          Next case
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </nav>
      {canRunAgain && (
        <div className="run-panel-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onRetest(runCase)}>
            <RotateCcw size={14} aria-hidden="true" />
            Run again
          </button>
          <span className="field-hint">Marks the case Retest; earlier attempts stay below.</span>
        </div>
      )}
      <section className="detail-section">
        <h3>Preconditions</h3>
        <p className={snapshot?.preconditions ? 'prose' : 'muted'}>
          {snapshot?.preconditions ?? 'No preconditions.'}
        </p>
      </section>
      {canRecord ? (
        <CaseExecution
          projectId={projectId}
          runId={runId}
          runCaseId={runCase.id}
          testCaseId={runCase.testCaseId}
          title={snapshot?.title ?? runCase.testCase.title}
          steps={steps}
          hasNext={nextCase !== null}
          onSaved={(message, saved) => {
            setVersion((v) => v + 1);
            onSaved(message, saved);
          }}
        />
      ) : (
        <section className="detail-section">
          <h3>Steps</h3>
          {steps.length === 0 ? (
            <p className="muted">This case has no steps.</p>
          ) : (
            <ol className="steps">
              {steps.map((step) => (
                <li key={step.position} className="step">
                  <p className="step-action">{step.action}</p>
                  {step.expectedResult && (
                    <p className="step-expected">
                      <span className="step-expected-label">Expected:</span> {step.expectedResult}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
      <section className="detail-section">
        <h3>Results in this run</h3>
        <ResultHistory
          projectId={projectId}
          runId={runId}
          runCase={runCase}
          steps={steps}
          memberName={memberName}
          version={version}
          onEdit={canRecord ? setEditing : undefined}
        />
      </section>
      <EditResultDialog
        projectId={projectId}
        runId={runId}
        result={editing}
        onClose={() => setEditing(null)}
        onSaved={(message) => {
          setEditing(null);
          setVersion((v) => v + 1);
          onEdited(message);
        }}
      />
    </aside>
  );
}

/**
 * Result buttons for a case (current status via aria-pressed) and, for a failed, blocked or invalid
 * case, filing or linking a defect.
 * Shown in a separate column on desktop and under the case title on narrow screens; the hidden
 * copy is also removed from the accessibility tree by display:none.
 */
function ResultActions({
  runCase,
  pending,
  onMark,
  onDefect,
}: {
  runCase: RunCase;
  pending: boolean;
  onMark: (rc: RunCase, status: ResultStatus) => void;
  onDefect: (rc: RunCase) => void;
}) {
  return (
    <div className="result-actions">
      <div className="result-buttons" role="group" aria-label={`Result for ${runCase.testCase.title}`}>
        {RESULT_CHOICES.map((status) => {
          const { label, icon: Icon } = STATUS_META[status];
          return (
            <button
              key={status}
              type="button"
              className={`result-button result-button--${status.toLowerCase()}`}
              aria-pressed={runCase.status === status}
              disabled={pending}
              onClick={() => onMark(runCase, status)}
              title={label}
            >
              <Icon size={16} aria-hidden="true" />
              <span className="result-button-label">{label}</span>
            </button>
          );
        })}
      </div>
      {isResultStatus(runCase.status) && DEFECT_STATUSES.includes(runCase.status) && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDefect(runCase)}>
          <Bug size={16} aria-hidden="true" />
          Defect
        </button>
      )}
    </div>
  );
}

/**
 * Whether CI was called for a run with cases for automation, under the run's header, with a way
 * to call it again. A call still being retried is checked again every 15 seconds.
 */
function RunCiStatus({
  projectId,
  runId,
  canTrigger,
  isAdmin,
}: {
  projectId: string;
  runId: string;
  canTrigger: boolean;
  isAdmin: boolean;
}) {
  const status = useResource(
    () => api.get<{ configured: boolean; lastDelivery: WebhookDelivery | null }>(`/projects/${projectId}/runs/${runId}/ci`),
    [projectId, runId],
  );
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const pending = status.data?.lastDelivery?.status === 'PENDING';
  const { reload } = status;
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(reload, 15_000);
    return () => window.clearTimeout(timer);
  }, [pending, reload]);

  async function trigger() {
    setSending(true);
    setError(null);
    try {
      await api.post(`/projects/${projectId}/runs/${runId}/ci`);
      status.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't call CI");
    } finally {
      setSending(false);
    }
  }

  if (!status.data) return null;
  const { configured, lastDelivery } = status.data;
  return (
    <div className="ci-status" role="status">
      <Bot size={16} aria-hidden="true" />
      {!configured ? (
        <span className="muted">
          Automated cases wait for results from CI.
          {isAdmin && <> No CI webhook is set up: <RouterLink to={`/projects/${projectId}/integrations`}>set one up</RouterLink>.</>}
        </span>
      ) : !lastDelivery ? (
        <span className="muted">CI hasn't been called for this run.</span>
      ) : lastDelivery.status === 'SUCCEEDED' ? (
        <span>CI was called {formatDateTime(lastDelivery.createdAt)} ({describeDelivery(lastDelivery)}).</span>
      ) : lastDelivery.status === 'PENDING' ? (
        <span>Calling CI… try {lastDelivery.attempts} failed ({describeDelivery(lastDelivery)}); trying again.</span>
      ) : (
        <span className="form-error">Calling CI failed: {describeDelivery(lastDelivery)}</span>
      )}
      {canTrigger && configured && (
        <button type="button" className="btn btn-secondary btn-sm" disabled={sending} onClick={trigger}>
          <RotateCcw size={14} aria-hidden="true" />
          {lastDelivery ? 'Trigger CI again' : 'Trigger CI'}
        </button>
      )}
      {error && <span className="form-error">{error}</span>}
    </div>
  );
}

export function RunDetailPage() {
  const { projectId = '', runId = '' } = useParams();
  const runRes = useResource(() => api.get<RunDetail>(`/projects/${projectId}/runs/${runId}`), [projectId, runId]);
  const resultsRes = useResource(
    () => api.get<ResultRow[]>(`/projects/${projectId}/runs/${runId}/results`),
    [projectId, runId],
  );
  const run = runRes.data;
  const { execute, editRepository, deleteRecords, role, archived } = useProjectPermissions(projectId);
  const navigate = useNavigate();
  const members = useProjectMembers(projectId);
  const { user } = useAuth();
  usePageTitle(run?.title);

  const {
    statusFilter,
    sourceFilter,
    onlyMine,
    openCaseId,
    onlyCaseId,
    setStatusFilter,
    setSourceFilter,
    setOnlyMine,
    setOpenCaseId,
    showAllCases,
  } = useRunView();
  const [pending, setPending] = useState<string | null>(null);
  const { notify, dismiss } = useNotice();
  // Messages go to the app-wide live region (components/Notice) so that they are announced on every page.
  const setNotice = (notice: { text: string; defectLink?: boolean } | null) => {
    if (notice) notify(notice.text, notice.defectLink ? { to: `/projects/${projectId}/defects`, label: 'Go to defects' } : undefined);
    else dismiss();
  };
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingComplete, setConfirmingComplete] = useState(false);
  const [editingRun, setEditingRun] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // thenOpen: the case to open once the defect dialog closes, after "Save and next".
  const [defectFor, setDefectFor] = useState<{
    resultId: string;
    caseTitle: string;
    summary: string;
    thenOpen?: string;
  } | null>(null);

  const latestResultByCase = new Map(
    (resultsRes.data ?? []).map((r) => [r.runCase.testCaseId, r]),
  );

  function reload() {
    runRes.reload();
    resultsRes.reload();
  }

  async function markResult(rc: RunCase, status: ResultStatus) {
    setPending(rc.id);
    setActionError(null);
    try {
      await api.post(`/projects/${projectId}/runs/${runId}/results`, {
        testCaseId: rc.testCaseId,
        status,
        source: 'MANUAL',
      });
      setNotice({ text: `${rc.testCase.title} marked as ${STATUS_META[status].label.toLowerCase()}.` });
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't save the result");
    } finally {
      setPending(null);
    }
  }

  async function assign(rc: RunCase, assigneeId: string) {
    setActionError(null);
    try {
      await api.patch(`/projects/${projectId}/runs/${runId}/cases/${rc.id}`, { assigneeId: assigneeId || null });
      runRes.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't change the assignee");
    }
  }

  // Errors are shown in the confirmation dialog, which stays open.
  async function completeRun() {
    await api.post(`/projects/${projectId}/runs/${runId}/complete`);
    setConfirmingComplete(false);
    setNotice({ text: "Run completed. Completed runs don't accept new results." });
    reload();
  }

  async function reopenRun() {
    setActionError(null);
    try {
      await api.post(`/projects/${projectId}/runs/${runId}/reopen`);
      setNotice({ text: 'Run reopened; it accepts results again.' });
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't reopen the run");
    }
  }

  async function retest(rc: RunCase) {
    setActionError(null);
    try {
      await api.post(`/projects/${projectId}/runs/${runId}/cases/${rc.id}/retest`);
      setNotice({ text: `${rc.caseSnapshot?.title ?? rc.testCase.title} set to retest.` });
      runRes.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't mark the case for retest");
    }
  }

  // The latest result of the case gets the defect; the dialog creates one or links an open one.
  function openDefect(rc: RunCase) {
    setActionError(null);
    const resultId = latestResultByCase.get(rc.testCaseId)?.id;
    if (!resultId) {
      setActionError(`"${rc.testCase.title}" has no result to file a defect for yet.`);
      return;
    }
    setDefectFor({ resultId, caseTitle: rc.caseSnapshot?.title ?? rc.testCase.title, summary: '' });
  }

  if (runRes.error && !run) return <LoadError message={runRes.error} onRetry={reload} />;
  if (!run) return <Loading />;

  const isOpen = run.status === 'OPEN';
  // Result entry only on open runs and for roles with execute permission (Admin, Tester, Automation).
  const canRecord = isOpen && execute;
  // Reopening is for project admins, as on the server.
  const canReopen = !isOpen && role === 'ADMIN' && !archived;
  const runCases = [...run.runCases].sort((a, b) => a.position - b.position);
  const statuses = runCases.map((rc) => (isResultStatus(rc.status) ? rc.status : 'UNTESTED'));
  const counts = normalizeCounts(run.progress);
  const total = runCases.length;
  const done = total - pendingCount(counts);
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const openCase = runCases.find((rc) => rc.id === openCaseId) ?? null;
  // Admins and testers assign cases; a tester can narrow the list to their own.
  const canAssign = editRepository;
  const memberName = new Map((members.data ?? []).map((m) => [m.user.id, m.user.displayName]));
  // A case's source is where its latest result came from, or before that how it is planned to run.
  const sourceOf = (rc: RunCase) =>
    latestResultByCase.get(rc.testCaseId)?.source ?? (rc.executionMode === 'AUTOMATED' ? 'AUTOMATION' : 'MANUAL');
  const matchesFilters = (rc: RunCase) =>
    (!onlyCaseId || rc.id === onlyCaseId) &&
    (!onlyMine || rc.assigneeId === user?.id) &&
    (!statusFilter || rc.status === statusFilter) &&
    (sourceFilter === 'ALL' || sourceOf(rc) === sourceFilter);
  const shownCases = runCases.filter(matchesFilters);
  const filtered = onlyCaseId !== null || onlyMine || statusFilter !== null || sourceFilter !== 'ALL';
  const onlyCase = onlyCaseId ? runCases.find((rc) => rc.id === onlyCaseId) : undefined;
  // Choosing the selected status again shows every case.
  const toggleStatus = (status: ResultStatus) => setStatusFilter(statusFilter === status ? null : status);
  const filterName = statusFilter ? STATUS_META[statusFilter].label.toLowerCase() : null;

  /**
   * The nearest case before or after the open one that the filters show, in run order. The open
   * case itself may no longer match (its new result can fall outside a status filter), so this
   * walks the whole run instead of the shown list; with "Untested" chosen, Next skips done cases.
   */
  function neighbour(step: 1 | -1): RunCase | null {
    const at = runCases.findIndex((rc) => rc.id === openCaseId);
    if (at < 0) return null;
    for (let i = at + step; i >= 0 && i < runCases.length; i += step) {
      if (matchesFilters(runCases[i])) return runCases[i];
    }
    return null;
  }
  const openIndex = openCase ? shownCases.indexOf(openCase) : -1;
  const place =
    openIndex < 0 ? null : `Case ${openIndex + 1} of ${shownCases.length}${filtered ? ' shown' : ''}`;

  /** Who tests the case: a select for admins and testers, the name for everyone else. */
  function assigneeControl(rc: RunCase) {
    const title = rc.caseSnapshot?.title ?? rc.testCase.title;
    return canAssign ? (
      <Select
        className="inline-select"
        aria-label={`Assignee for ${title}`}
        value={rc.assigneeId ?? ''}
        onChange={(e) => assign(rc, e.target.value)}
      >
        <option value="">Unassigned</option>
        {rc.assigneeId && !memberName.has(rc.assigneeId) && <option value={rc.assigneeId}>Assigned</option>}
        {(members.data ?? []).map((m) => (
          <option key={m.user.id} value={m.user.id}>{m.user.displayName}</option>
        ))}
      </Select>
    ) : (
      <span className="muted">{rc.assigneeId ? memberName.get(rc.assigneeId) ?? 'Assigned' : 'Unassigned'}</span>
    );
  }

  function closePanel() {
    const id = openCaseId;
    setOpenCaseId(null);
    if (id) requestAnimationFrame(() => document.getElementById(`runcase-${id}`)?.focus());
  }

  // After "Save and next" with a defect to file, the next case opens once the dialog has closed
  // and handed focus back, so that the next case's title can take focus.
  function closeDefectDialog(message?: string) {
    const next = defectFor?.thenOpen;
    setDefectFor(null);
    if (message) setNotice({ text: message, defectLink: true });
    if (next) requestAnimationFrame(() => setOpenCaseId(next));
  }

  return (
    <>
      <PageHeader
        title={run.title}
        meta={
          <dl className="meta-list">
            <div>
              <dt>Status</dt>
              <dd><Tag tone={isOpen ? 'strong' : 'neutral'}>{labelOf(RUN_STATUS_LABEL, run.status)}</Tag></dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{labelOf(RUN_SOURCE_LABEL, run.source)}</dd>
            </div>
            {run.environment && (
              <div>
                <dt>Environment</dt>
                <dd>{run.environment}</dd>
              </div>
            )}
            {run.build && (
              <div>
                <dt>Build</dt>
                <dd>{run.build}</dd>
              </div>
            )}
            {run.configuration && (
              <div>
                <dt>Configuration</dt>
                <dd>{run.configuration}</dd>
              </div>
            )}
            <div>
              <dt>Started</dt>
              <dd className="num">{formatDate(run.createdAt)}</dd>
            </div>
            {run.completedAt && (
              <div>
                <dt>Completed</dt>
                <dd className="num">{formatDate(run.completedAt)}</dd>
              </div>
            )}
          </dl>
        }
        actions={
          <>
            {execute && (
              <button type="button" className="icon-button" onClick={() => { setActionError(null); setEditingRun(true); }} aria-label="Edit the run" title="Edit">
                <Pencil size={16} aria-hidden="true" />
              </button>
            )}
            {deleteRecords && (
              <button type="button" className="icon-button" onClick={() => { setActionError(null); setConfirmingDelete(true); }} aria-label="Delete the run" title="Delete">
                <Trash2 size={16} aria-hidden="true" />
              </button>
            )}
            {canRecord ? (
              <button type="button" className="btn btn-primary" onClick={() => { setActionError(null); setConfirmingComplete(true); }}>
                <CheckCheck size={16} aria-hidden="true" />
                Complete run
              </button>
            ) : canReopen ? (
              <button type="button" className="btn btn-secondary" onClick={reopenRun}>
                <RotateCcw size={16} aria-hidden="true" />
                Reopen run
              </button>
            ) : null}
          </>
        }
      />

      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {run.runCases.some((rc) => rc.executionMode === 'AUTOMATED') && (
        <RunCiStatus projectId={projectId} runId={runId} canTrigger={canRecord} isAdmin={role === 'ADMIN'} />
      )}

      <section className="run-summary surface" aria-labelledby="run-progress-heading">
        <div className="run-summary-head">
          <h2 id="run-progress-heading" className="section-title">Progress</h2>
          <p className="run-progress-text">
            <span className="run-percent num">{percent}%</span>
            <span className="muted num">{done}/{total} cases have a result</span>
            {run.durationMs > 0 && (
              <span className="muted num" title="Sum of the time spent on each case">
                · {formatDuration(run.durationMs)} testing time
              </span>
            )}
          </p>
        </div>
        <ResultRibbon
          statuses={statuses}
          size="lg"
          label="Run results"
          showCounts
          selected={statusFilter}
          onSelect={toggleStatus}
        />
        <StatusLegend counts={counts} selected={statusFilter} onSelect={toggleStatus} />
        <p className="visually-hidden" role="status">
          {filterName ? `Showing ${plural(shownCases.length, `${filterName} case`)}.` : ''}
        </p>
      </section>

      <div className="segmented" role="group" aria-label="Filter cases by assignee">
        <button type="button" aria-pressed={!onlyMine} onClick={() => setOnlyMine(false)}>All cases</button>
        <button type="button" aria-pressed={onlyMine} onClick={() => setOnlyMine(true)}>Assigned to me</button>
      </div>
      <div className="segmented" role="group" aria-label="Filter cases by result source">
        <button type="button" aria-pressed={sourceFilter === 'ALL'} onClick={() => setSourceFilter('ALL')}>All sources</button>
        <button type="button" aria-pressed={sourceFilter === 'MANUAL'} onClick={() => setSourceFilter('MANUAL')}>
          <Hand size={14} aria-hidden="true" /> Manual
        </button>
        <button type="button" aria-pressed={sourceFilter === 'AUTOMATION'} onClick={() => setSourceFilter('AUTOMATION')}>
          <Bot size={14} aria-hidden="true" /> Automation
        </button>
      </div>
      {onlyCaseId && (
        <p className="filter-note">
          {/* One text node for the sentence, so the note's flex gap only separates it from the button. */}
          <span>
            {onlyCase ? (
              <>Showing only <strong>{onlyCase.caseSnapshot?.title ?? onlyCase.testCase.title}</strong>.</>
            ) : (
              "The case you followed isn't in this run."
            )}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={showAllCases}>
            Show all cases
          </button>
        </p>
      )}
      {statusFilter && (
        <p className="filter-note">
          Showing only <StatusChip status={statusFilter} /> cases.{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStatusFilter(null)}>
            Show all cases
          </button>
        </p>
      )}

      <div className={`run-body${openCase ? ' run-body--with-panel' : ''}`}>
        <div className="surface table-wrap">
          <table className="data-table data-table--interactive">
            <caption className="visually-hidden">Cases in this run and their results</caption>
            <thead>
              <tr>
                <th scope="col" className="col-index hide-sm">Order</th>
                <th scope="col" className="col-main">Test case</th>
                <th scope="col" className="hide-sm">Assignee</th>
                <th scope="col">Status</th>
                <th scope="col" className="hide-sm">Source</th>
                <th scope="col" className="hide-sm num">Duration</th>
                {canRecord && <th scope="col" className="hide-sm">Record result</th>}
              </tr>
            </thead>
            <tbody>
              {shownCases.map((rc) => (
                <tr key={rc.id} className={rc.id === openCaseId ? 'is-selected' : undefined}>
                  <td className="col-index muted num hide-sm">{runCases.indexOf(rc) + 1}</td>
                  <td>
                    <button
                      type="button"
                      id={`runcase-${rc.id}`}
                      className="row-button"
                      aria-expanded={rc.id === openCaseId}
                      onClick={() => setOpenCaseId(rc.id === openCaseId ? null : rc.id)}
                    >
                      {rc.caseSnapshot?.title ?? rc.testCase.title}
                    </button>
                    {/* On narrow screens the assignee and source columns are hidden, so they sit under the title. */}
                    <div className="runcase-assignee show-sm">
                      {assigneeControl(rc)}
                      <SourceLabel result={latestResultByCase.get(rc.testCaseId)} mode={rc.executionMode} />
                    </div>
                    {canRecord && (
                      <div className="show-sm cell-actions-sm">
                        <ResultActions runCase={rc} pending={pending === rc.id} onMark={markResult} onDefect={openDefect} />
                      </div>
                    )}
                  </td>
                  <td className="hide-sm runcase-assignee">{assigneeControl(rc)}</td>
                  <td>
                    <span className="status-cell">
                      <StatusChip status={rc.status} />
                      {rc.attemptCount > 1 && (
                        <span className="attempt-count" title={`${plural(rc.attemptCount, 'attempt')} in this run`}>
                          +{rc.attemptCount - 1}
                          <span className="visually-hidden"> earlier {rc.attemptCount === 2 ? 'attempt' : 'attempts'}</span>
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="hide-sm">
                    <SourceLabel result={latestResultByCase.get(rc.testCaseId)} mode={rc.executionMode} />
                  </td>
                  <td className="hide-sm num muted">{formatDuration(rc.durationMs)}</td>
                  {canRecord && (
                    <td className="hide-sm">
                      <ResultActions runCase={rc} pending={pending === rc.id} onMark={markResult} onDefect={openDefect} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {runCases.length === 0 && (
            <p className="table-empty">This run has no cases. Start a new run from a plan or by picking cases.</p>
          )}
          {runCases.length > 0 && shownCases.length === 0 && (
            <p className="table-empty">No cases in this run match the chosen filters.</p>
          )}
        </div>
        {openCase && (
          <RunCasePanel
            key={openCase.id}
            projectId={projectId}
            runId={runId}
            runCase={openCase}
            canRecord={canRecord}
            memberName={memberName}
            place={place}
            previousCase={neighbour(-1)}
            nextCase={neighbour(1)}
            onOpenCase={(rc) => setOpenCaseId(rc.id)}
            onSaved={(message, saved) => {
              setNotice({ text: message });
              reload();
              const next = saved.openNext ? neighbour(1)?.id : undefined;
              if (saved.wantsDefect) {
                setDefectFor({
                  resultId: saved.resultId,
                  caseTitle: openCase.caseSnapshot?.title ?? openCase.testCase.title,
                  summary: saved.summary,
                  thenOpen: next,
                });
              } else if (next) {
                setOpenCaseId(next);
              }
            }}
            onEdited={(message) => {
              setNotice({ text: message });
              reload();
            }}
            onRetest={retest}
            onClose={closePanel}
          />
        )}
      </div>
      <ConfirmDialog
        open={confirmingComplete}
        title="Complete this run?"
        message={`Completed runs don't accept new results, from testers or from CI. ${
          role === 'ADMIN' ? 'You can reopen it later.' : 'Only a project admin can reopen it.'
        }`}
        confirmLabel="Complete run"
        onConfirm={completeRun}
        onClose={() => setConfirmingComplete(false)}
      />
      <DefectForResultDialog
        open={defectFor !== null}
        projectId={projectId}
        resultId={defectFor?.resultId ?? ''}
        caseTitle={defectFor?.caseTitle ?? ''}
        summary={defectFor?.summary ?? ''}
        onClose={() => closeDefectDialog()}
        onDone={(message) => closeDefectDialog(message)}
      />
      <EditRunDialog
        projectId={projectId}
        run={run}
        open={editingRun}
        onClose={() => setEditingRun(false)}
        onSaved={() => {
          setEditingRun(false);
          setNotice({ text: 'Run updated.' });
          runRes.reload();
        }}
      />
      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this run?"
        message={`"${run.title}" is deleted with its ${plural(run.resultCount, 'result')} and ${plural(run.attachmentCount, 'attachment')}, and the links from those results to defects. This can't be undone.`}
        confirmLabel="Delete run"
        onConfirm={async () => {
          await api.delete(`/projects/${projectId}/runs/${runId}`);
          // The message outlives this page; the app shell moves focus to the runs page's content.
          notify(`Run "${run.title}" deleted.`, undefined, true);
          navigate(`/projects/${projectId}/runs`);
        }}
        onClose={() => setConfirmingDelete(false)}
      />
    </>
  );
}
