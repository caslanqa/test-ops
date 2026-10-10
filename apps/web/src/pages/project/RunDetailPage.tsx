import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Bug, CheckCheck, Paperclip, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import { api, downloadFile } from '../../api/client';
import { Dialog } from '../../components/Dialog';
import { FormError, LoadError, Loading, PageHeader } from '../../components/Page';
import { ConfirmDialog } from '../../components/Members';
import { ResultRibbon, StatusLegend } from '../../components/ResultRibbon';
import { StatusChip, Tag } from '../../components/StatusChip';
import { formatBytes, formatDate, formatDateTime } from '../../lib/format';
import { RUN_SOURCE_LABEL, RUN_STATUS_LABEL, labelOf } from '../../lib/labels';
import {
  RESULT_CHOICES,
  STATUS_META,
  isResultStatus,
  normalizeCounts,
  type ResultStatus,
} from '../../lib/status';
import { useProjectPermissions } from '../../lib/permissions';
import { useProjectMembers } from '../../lib/members';
import { useAuth } from '../../auth/AuthContext';
import { usePageTitle, useResource } from '../../lib/useResource';

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
  position: number;
  caseSnapshot: CaseSnapshot | null;
  testCase: { id: string; title: string };
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
}

interface ResultRow {
  id: string;
  runCase: { testCaseId: string };
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
      await api.patch(`/projects/${projectId}/runs/${run.id}`, {
        title,
        description: description.trim() || null,
        environment: environment.trim() || null,
        build: build.trim() || null,
        configuration: configuration.trim() || null,
      });
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

interface ResultEntry {
  id: string;
  status: string;
  comment: string | null;
  attemptNumber: number;
  source: string;
  automationSourceLabel: string | null;
  authorUserId: string | null;
  createdAt: string;
}

interface AttachmentInfo {
  id: string;
  fileName: string;
  sizeBytes: number;
}

/** A result with its comment, as entered in the case panel; files are uploaded after it is saved. */
function RecordResultForm({
  projectId,
  runId,
  runCase,
  onSaved,
}: {
  projectId: string;
  runId: string;
  runCase: RunCase;
  onSaved: (message: string) => void;
}) {
  const [status, setStatus] = useState<ResultStatus>('PASSED');
  const [comment, setComment] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const statusId = useId();
  const commentId = useId();
  const filesId = useId();
  const filesHintId = useId();
  const title = runCase.caseSnapshot?.title ?? runCase.testCase.title;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await api.post<{ id: string }>(`/projects/${projectId}/runs/${runId}/results`, {
        testCaseId: runCase.testCaseId,
        status,
        comment: comment.trim() || undefined,
        source: 'MANUAL',
      });
      let message = `${title} marked as ${STATUS_META[status].label.toLowerCase()}.`;
      if (files.length > 0) {
        const form = new FormData();
        for (const file of files) form.append('files', file);
        try {
          await api.upload(`/projects/${projectId}/results/${result.id}/attachments`, form);
        } catch (err) {
          // The result stays; only the files are missing, so say exactly that.
          setError(`The result was saved, but the files weren't: ${err instanceof Error ? err.message : 'upload failed'}`);
          message = `${title} marked as ${STATUS_META[status].label.toLowerCase()}, without the files.`;
          onSaved(message);
          return;
        }
      }
      setComment('');
      setFiles([]);
      if (fileInput.current) fileInput.current.value = '';
      onSaved(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the result");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="record-result" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor={statusId} className="field-label">Result</label>
        <select id={statusId} value={status} onChange={(e) => setStatus(e.target.value as ResultStatus)}>
          {RESULT_CHOICES.map((choice) => (
            <option key={choice} value={choice}>{STATUS_META[choice].label}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={commentId} className="field-label">Comment</label>
        <textarea id={commentId} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={filesId} className="field-label">Evidence</label>
        <input
          id={filesId}
          ref={fileInput}
          type="file"
          multiple
          aria-describedby={filesHintId}
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
        <p id={filesHintId} className="field-hint">Screenshots, logs or recordings; the server's size and type limits apply.</p>
      </div>
      <FormError message={error} />
      <button type="submit" className="btn btn-primary" disabled={saving}>
        {saving ? 'Saving…' : 'Save result'}
      </button>
    </form>
  );
}

/** Earlier attempts of the case in this run, newest first, with comments and files (FR-043). */
function ResultHistory({
  projectId,
  runId,
  runCase,
  memberName,
  version,
}: {
  projectId: string;
  runId: string;
  runCase: RunCase;
  memberName: Map<string, string>;
  version: number;
}) {
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const history = useResource(async () => {
    const results = await api.get<ResultEntry[]>(
      `/projects/${projectId}/results?runId=${runId}&testCaseId=${runCase.testCaseId}&limit=20`,
    );
    const files = await Promise.all(
      results.map((r) => api.get<AttachmentInfo[]>(`/projects/${projectId}/attachments?resultId=${r.id}`)),
    );
    return results.map((r, i) => ({ ...r, attachments: files[i] }));
  }, [projectId, runId, runCase.testCaseId, version]);

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
              <span className="muted">
                Attempt {r.attemptNumber} · {formatDateTime(r.createdAt)} ·{' '}
                {r.source === 'CI'
                  ? r.automationSourceLabel ?? 'Automation'
                  : (r.authorUserId && memberName.get(r.authorUserId)) ?? 'A project member'}
              </span>
            </div>
            {r.comment && <p className="prose">{r.comment}</p>}
            {r.attachments.length > 0 && (
              <ul className="attachment-list">
                {r.attachments.map((file) => (
                  <li key={file.id}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => download(file)}>
                      <Paperclip size={14} aria-hidden="true" />
                      {file.fileName}
                      <span className="muted">{formatBytes(file.sizeBytes)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * The case's steps as they were when the run started (snapshot), the form for a result with a
 * comment and evidence, and the case's results in this run.
 */
function RunCasePanel({
  projectId,
  runId,
  runCase,
  canRecord,
  memberName,
  onSaved,
  onClose,
}: {
  projectId: string;
  runId: string;
  runCase: RunCase;
  canRecord: boolean;
  memberName: Map<string, string>;
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  const [version, setVersion] = useState(0);
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
      <section className="detail-section">
        <h3>Preconditions</h3>
        <p className={snapshot?.preconditions ? 'prose' : 'muted'}>
          {snapshot?.preconditions ?? 'No preconditions.'}
        </p>
      </section>
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
      {canRecord && (
        <section className="detail-section">
          <h3>Record a result</h3>
          <RecordResultForm
            projectId={projectId}
            runId={runId}
            runCase={runCase}
            onSaved={(message) => {
              setVersion((v) => v + 1);
              onSaved(message);
            }}
          />
        </section>
      )}
      <section className="detail-section">
        <h3>Results in this run</h3>
        <ResultHistory projectId={projectId} runId={runId} runCase={runCase} memberName={memberName} version={version} />
      </section>
    </aside>
  );
}

/**
 * Result buttons for a case (current status via aria-pressed) and, if it failed, filing a defect.
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
      {runCase.status === 'FAILED' && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDefect(runCase)}>
          <Bug size={16} aria-hidden="true" />
          Create defect
        </button>
      )}
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

  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; defectLink?: boolean } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  const [confirmingComplete, setConfirmingComplete] = useState(false);
  const [editingRun, setEditingRun] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const latestResultByCase = new Map(
    (resultsRes.data ?? []).map((r) => [r.runCase.testCaseId, r.id]),
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

  async function createDefect(rc: RunCase) {
    setActionError(null);
    const resultId = latestResultByCase.get(rc.testCaseId);
    try {
      await api.post(`/projects/${projectId}/defects`, {
        title: `Failed: ${rc.testCase.title}`,
        resultIds: resultId ? [resultId] : [],
      });
      setNotice({ text: `Defect created for "${rc.testCase.title}".`, defectLink: true });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't create the defect");
    }
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
  const done = total - counts.UNTESTED;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const openCase = runCases.find((rc) => rc.id === openCaseId) ?? null;
  // Admins and testers assign cases; a tester can narrow the list to their own.
  const canAssign = editRepository;
  const memberName = new Map((members.data ?? []).map((m) => [m.user.id, m.user.displayName]));
  const shownCases = onlyMine ? runCases.filter((rc) => rc.assigneeId === user?.id) : runCases;

  function closePanel() {
    const id = openCaseId;
    setOpenCaseId(null);
    if (id) requestAnimationFrame(() => document.getElementById(`runcase-${id}`)?.focus());
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
              <button type="button" className="icon-button" onClick={() => setEditingRun(true)} aria-label="Edit the run" title="Edit">
                <Pencil size={16} aria-hidden="true" />
              </button>
            )}
            {deleteRecords && (
              <button type="button" className="icon-button" onClick={() => setConfirmingDelete(true)} aria-label="Delete the run" title="Delete">
                <Trash2 size={16} aria-hidden="true" />
              </button>
            )}
            {canRecord ? (
              <button type="button" className="btn btn-primary" onClick={() => setConfirmingComplete(true)}>
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

      {/* Fixed to the bottom of the screen so the confirmation stays visible wherever in the list the
          result was entered; role=status also announces it to screen readers without moving focus (WCAG 4.1.3). */}
      <div className="toast-region" role="status">
        {notice && (
          <div className="toast">
            <p>
              {notice.text}{' '}
              {notice.defectLink && <Link to={`/projects/${projectId}/defects`}>Go to defects</Link>}
            </p>
            <button
              type="button"
              className="icon-button icon-button--on-dark"
              onClick={() => setNotice(null)}
              aria-label="Dismiss notification"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      {actionError && <p className="form-error" role="alert">{actionError}</p>}

      <section className="run-summary surface" aria-labelledby="run-progress-heading">
        <div className="run-summary-head">
          <h2 id="run-progress-heading" className="section-title">Progress</h2>
          <p className="run-progress-text">
            <span className="run-percent num">{percent}%</span>
            <span className="muted num">{done}/{total} cases have a result</span>
          </p>
        </div>
        <ResultRibbon statuses={statuses} size="lg" label="Run results" />
        <StatusLegend counts={counts} />
      </section>

      <div className="segmented" role="group" aria-label="Filter cases by assignee">
        <button type="button" aria-pressed={!onlyMine} onClick={() => setOnlyMine(false)}>All cases</button>
        <button type="button" aria-pressed={onlyMine} onClick={() => setOnlyMine(true)}>Assigned to me</button>
      </div>

      <div className={`run-body${openCase ? ' run-body--with-panel' : ''}`}>
        <div className="surface table-wrap">
          <table className="data-table data-table--interactive">
            <caption className="visually-hidden">Cases in this run and their results</caption>
            <thead>
              <tr>
                <th scope="col" className="col-index hide-sm">Order</th>
                <th scope="col" className="col-main">Test case</th>
                <th scope="col">Status</th>
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
                    <div className="runcase-assignee">
                      {canAssign ? (
                        <select
                          className="inline-select"
                          aria-label={`Assignee for ${rc.caseSnapshot?.title ?? rc.testCase.title}`}
                          value={rc.assigneeId ?? ''}
                          onChange={(e) => assign(rc, e.target.value)}
                        >
                          <option value="">Unassigned</option>
                          {rc.assigneeId && !memberName.has(rc.assigneeId) && (
                            <option value={rc.assigneeId}>Assigned</option>
                          )}
                          {(members.data ?? []).map((m) => (
                            <option key={m.user.id} value={m.user.id}>{m.user.displayName}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="muted">
                          {rc.assigneeId ? memberName.get(rc.assigneeId) ?? 'Assigned' : 'Unassigned'}
                        </span>
                      )}
                    </div>
                    {canRecord && (
                      <div className="show-sm cell-actions-sm">
                        <ResultActions runCase={rc} pending={pending === rc.id} onMark={markResult} onDefect={createDefect} />
                      </div>
                    )}
                  </td>
                  <td><StatusChip status={rc.status} /></td>
                  {canRecord && (
                    <td className="hide-sm">
                      <ResultActions runCase={rc} pending={pending === rc.id} onMark={markResult} onDefect={createDefect} />
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
            <p className="table-empty">No cases in this run are assigned to you.</p>
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
            onSaved={(message) => {
              setNotice({ text: message });
              reload();
            }}
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
      <EditRunDialog
        key={editingRun ? 'open' : 'closed'}
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
        message={`"${run.title}" is deleted with all of its results, their attachments and their links to defects. This can't be undone.`}
        confirmLabel="Delete run"
        onConfirm={async () => {
          await api.delete(`/projects/${projectId}/runs/${runId}`);
          navigate(`/projects/${projectId}/runs`);
        }}
        onClose={() => setConfirmingDelete(false)}
      />
    </>
  );
}
