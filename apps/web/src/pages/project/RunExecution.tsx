import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Timer } from 'lucide-react';
import { api } from '../../api/client';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/Page';
import { DEFECT_SEVERITY_LABEL } from '../../lib/labels';
import { changedFields, hasChanges } from '../../lib/changes';
import { formatClock, parseClock } from '../../lib/format';
import { useProjectMembers } from '../../lib/members';
import {
  DEFECT_STATUSES,
  RESULT_CHOICES,
  STATUS_META,
  STEP_RESULT_CHOICES,
  type ResultStatus,
} from '../../lib/status';
import { Select } from '../../components/Select';

export interface CaseStep {
  position: number;
  action: string;
  expectedResult: string | null;
}

type StepStatus = (typeof STEP_RESULT_CHOICES)[number];

interface StepMark {
  status: StepStatus;
  comment: string;
}

/** What the tester has entered for a case but not saved yet. */
interface ExecutionDraft {
  steps: Record<number, StepMark>;
  /** Time the case has been open, summed over visits. */
  elapsedMs: number;
  /** When the case was first opened for this attempt. */
  startedAt: string;
}

/** What the run page needs after a result is saved, to offer a defect for it. */
export interface SavedResult {
  resultId: string;
  status: ResultStatus;
  wantsDefect: boolean;
  /** Comment and failed steps, as a starting point for the defect's actual result. */
  summary: string;
  /** "Save and next" was used and every file went up, so the following case opens. */
  openNext: boolean;
}

/** The parts of a saved result the API returns that the form needs for the step files. */
interface CreatedResult {
  id: string;
  stepResults: { id: string; stepPosition: number }[];
}

const TIME_FORMAT_ERROR = 'Time spent must look like 1:05:09, 5:09 or 45.';

/**
 * Uploads each group of files to its own target, one request per group. Returns a line for every
 * group that failed, so the caller can say exactly which files are missing; the others stay.
 */
async function uploadAll(uploads: { label: string; path: string; files: File[] }[]): Promise<string[]> {
  const failed: string[] = [];
  for (const upload of uploads) {
    if (upload.files.length === 0) continue;
    const form = new FormData();
    for (const file of upload.files) form.append('files', file);
    try {
      await api.upload(upload.path, form);
    } catch (err) {
      failed.push(`${upload.label}: ${err instanceof Error ? err.message : 'upload failed'}`);
    }
  }
  return failed;
}

// The draft lives in sessionStorage so step marks and the timer survive a reload or a visit to
// another case; it is per tab and is cleared once the result is saved. Storage can be missing
// (private windows, blocked site data), so every access is guarded and the form works without it.
const draftKey = (runCaseId: string) => `testops:run-draft:${runCaseId}`;

function readDraft(runCaseId: string): ExecutionDraft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(runCaseId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<ExecutionDraft>;
    if (typeof draft.elapsedMs !== 'number' || typeof draft.startedAt !== 'string' || typeof draft.steps !== 'object') {
      return null;
    }
    return draft as ExecutionDraft;
  } catch {
    return null;
  }
}

function writeDraft(runCaseId: string, draft: ExecutionDraft) {
  try {
    sessionStorage.setItem(draftKey(runCaseId), JSON.stringify(draft));
  } catch {
    /* storage unavailable: the draft only lasts while the panel is open */
  }
}

function clearDraft(runCaseId: string) {
  try {
    sessionStorage.removeItem(draftKey(runCaseId));
  } catch {
    /* nothing to clear */
  }
}

/** Counts the time the case stays open, a second at a time, starting from what earlier visits counted. */
function useCaseTimer(initialMs: number) {
  const [elapsedMs, setElapsedMs] = useState(initialMs);
  useEffect(() => {
    let last = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      setElapsedMs((ms) => ms + (now - last));
      last = now;
    }, 1000);
    return () => window.clearInterval(id);
  }, []);
  return [elapsedMs, setElapsedMs] as const;
}

/** A failed step outweighs a blocked one; any other step leaves the case result as it is. */
function caseStatusForStep(current: ResultStatus, step: StepStatus): ResultStatus {
  if (step === 'FAILED') return 'FAILED';
  if (step === 'BLOCKED' && current !== 'FAILED') return 'BLOCKED';
  return current;
}

/** Comment plus each failed or blocked step with what actually happened, for a defect's description. */
function describeOutcome(steps: CaseStep[], marks: Record<number, StepMark>, comment: string): string {
  const lines = steps
    .map((step, index) => ({ step, index, mark: marks[step.position] }))
    .filter(({ mark }) => mark && (mark.status === 'FAILED' || mark.status === 'BLOCKED'))
    .map(({ step, index, mark }) => {
      const actual = mark.comment.trim();
      return `Step ${index + 1} ${STATUS_META[mark.status].label.toLowerCase()}: ${step.action}${actual ? `\nActual: ${actual}` : ''}`;
    });
  return [comment.trim(), ...lines].filter(Boolean).join('\n\n');
}

/**
 * Executes a case: a result per step with what actually happened and its own files, a timer for
 * the time spent, and the case result with a comment and evidence. A failed or blocked step sets
 * the case result accordingly; the tester can still change it before saving. "Save and next"
 * saves and moves on to the following case, so a run can be worked through case by case.
 */
export function CaseExecution({
  projectId,
  runId,
  runCaseId,
  testCaseId,
  title,
  steps,
  hasNext,
  onSaved,
}: {
  projectId: string;
  runId: string;
  runCaseId: string;
  testCaseId: string;
  title: string;
  steps: CaseStep[];
  /** Whether a case follows this one in the list, for "Save and next". */
  hasNext: boolean;
  onSaved: (message: string, saved: SavedResult) => void;
}) {
  const [initial] = useState(() => readDraft(runCaseId));
  const [startedAt, setStartedAt] = useState(() => initial?.startedAt ?? new Date().toISOString());
  const [marks, setMarks] = useState<Record<number, StepMark>>(() => initial?.steps ?? {});
  const [elapsedMs, setElapsedMs] = useCaseTimer(initial?.elapsedMs ?? 0);
  // Null while the field follows the timer; the tester's own text once they correct it.
  const [typedTime, setTypedTime] = useState<string | null>(null);
  const [status, setStatus] = useState<ResultStatus>(() => {
    const marked = Object.values(initial?.steps ?? {});
    return marked.reduce<ResultStatus>((current, mark) => caseStatusForStep(current, mark.status), 'PASSED');
  });
  const [wantsDefect, setWantsDefect] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  // Files can't be kept in the session draft, so a step's files last while the panel is open.
  const [stepFiles, setStepFiles] = useState<Record<number, File[]>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const ids = {
    status: useId(),
    time: useId(),
    timeHint: useId(),
    comment: useId(),
    files: useId(),
    filesHint: useId(),
    defect: useId(),
  };
  // The defect box follows the result until the tester sets it themselves.
  const defectChecked = wantsDefect ?? DEFECT_STATUSES.includes(status);

  useEffect(() => {
    writeDraft(runCaseId, { steps: marks, elapsedMs, startedAt });
  }, [runCaseId, marks, elapsedMs, startedAt]);

  function markStep(step: CaseStep, index: number, stepStatus: StepStatus) {
    const current = marks[step.position];
    if (current?.status === stepStatus) {
      // Pressing the selected result again clears it, with the step's files.
      const { [step.position]: _removed, ...rest } = marks;
      setMarks(rest);
      const { [step.position]: _files, ...otherFiles } = stepFiles;
      setStepFiles(otherFiles);
      return;
    }
    setMarks({ ...marks, [step.position]: { status: stepStatus, comment: current?.comment ?? '' } });
    const next = caseStatusForStep(status, stepStatus);
    if (next !== status) {
      setStatus(next);
      setAnnouncement(`Step ${index + 1} ${STATUS_META[stepStatus].label.toLowerCase()}, so the case result is now ${STATUS_META[next].label.toLowerCase()}.`);
    }
  }

  function setStepComment(position: number, value: string) {
    const mark = marks[position];
    if (mark) setMarks({ ...marks, [position]: { ...mark, comment: value } });
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const wantsNext = (e.nativeEvent as SubmitEvent).submitter?.dataset.next === 'true';
    const durationMs = typedTime === null ? elapsedMs : parseClock(typedTime);
    if (durationMs === null) {
      setError(TIME_FORMAT_ERROR);
      return;
    }
    setSaving(true);
    setError(null);
    const label = STATUS_META[status].label.toLowerCase();
    const summary = describeOutcome(steps, marks, comment);
    try {
      const result = await api.post<CreatedResult>(`/projects/${projectId}/runs/${runId}/results`, {
        testCaseId,
        status,
        comment: comment.trim() || undefined,
        source: 'MANUAL',
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs: Math.round(durationMs),
        stepResults: steps
          .filter((step) => marks[step.position])
          .map((step) => ({
            stepPosition: step.position,
            status: marks[step.position].status,
            comment: marks[step.position].comment.trim() || undefined,
          })),
      });
      // Files go up once the result exists: the case's evidence, then each step's own files.
      const stepNumber = new Map(steps.map((step, index) => [step.position, index + 1]));
      const failed = await uploadAll([
        { label: 'Evidence', path: `/projects/${projectId}/results/${result.id}/attachments`, files },
        ...result.stepResults.map((stepResult) => ({
          label: `Step ${stepNumber.get(stepResult.stepPosition) ?? stepResult.stepPosition + 1}`,
          path: `/projects/${projectId}/step-results/${stepResult.id}/attachments`,
          files: stepFiles[stepResult.stepPosition] ?? [],
        })),
      ]);
      let message = `${title} marked as ${label}.`;
      if (failed.length > 0) {
        // The result stays; only some files are missing, so say exactly which.
        setError(`The result was saved, but some files weren't. ${failed.join(' ')}`);
        message = `${title} marked as ${label}, without some files.`;
      }
      // The next attempt starts from scratch.
      clearDraft(runCaseId);
      setMarks({});
      setElapsedMs(0);
      setTypedTime(null);
      setStartedAt(new Date().toISOString());
      setStatus('PASSED');
      setWantsDefect(null);
      setComment('');
      setFiles([]);
      setStepFiles({});
      setAnnouncement('');
      if (fileInput.current) fileInput.current.value = '';
      onSaved(message, {
        resultId: result.id,
        status,
        wantsDefect: defectChecked,
        summary,
        // The case stays open when files are missing, so the message about them can be read.
        openNext: wantsNext && failed.length === 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the result");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="record-result" onSubmit={onSubmit}>
      <section className="detail-section">
        <h3>Steps</h3>
        {steps.length === 0 ? (
          <p className="muted">This case has no steps.</p>
        ) : (
          <ol className="steps">
            {steps.map((step, index) => {
              const mark = marks[step.position];
              return (
                <li key={step.position} className="step">
                  <p className="step-action">{step.action}</p>
                  {step.expectedResult && (
                    <p className="step-expected">
                      <span className="step-expected-label">Expected:</span> {step.expectedResult}
                    </p>
                  )}
                  <div className="result-buttons step-result-buttons" role="group" aria-label={`Result for step ${index + 1}`}>
                    {STEP_RESULT_CHOICES.map((choice) => {
                      const { label, icon: Icon } = STATUS_META[choice];
                      return (
                        <button
                          key={choice}
                          type="button"
                          className={`result-button result-button--${choice.toLowerCase()}`}
                          aria-pressed={mark?.status === choice}
                          onClick={() => markStep(step, index, choice)}
                          title={label}
                        >
                          <Icon size={16} aria-hidden="true" />
                          <span className="visually-hidden">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                  {mark && (
                    <div className="field step-actual">
                      <label htmlFor={`${ids.comment}-step-${step.position}`} className="field-label">
                        Actual result <span className="visually-hidden">for step {index + 1}</span>
                      </label>
                      <textarea
                        id={`${ids.comment}-step-${step.position}`}
                        rows={2}
                        maxLength={2000}
                        value={mark.comment}
                        onChange={(e) => setStepComment(step.position, e.target.value)}
                      />
                      <label htmlFor={`${ids.files}-step-${step.position}`} className="field-label">
                        Files <span className="visually-hidden">for step {index + 1}</span>
                      </label>
                      <input
                        id={`${ids.files}-step-${step.position}`}
                        type="file"
                        multiple
                        onChange={(e) => {
                          const chosen = Array.from(e.target.files ?? []);
                          setStepFiles((current) => ({ ...current, [step.position]: chosen }));
                        }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
      <section className="detail-section">
        <h3>Record a result</h3>
        <div className="record-result">
          <div className="field-grid">
            <div className="field">
              <label htmlFor={ids.status} className="field-label">Result</label>
              <Select id={ids.status} value={status} onChange={(e) => setStatus(e.target.value as ResultStatus)}>
                {RESULT_CHOICES.map((choice) => (
                  <option key={choice} value={choice}>{STATUS_META[choice].label}</option>
                ))}
              </Select>
            </div>
            <div className="field">
              <label htmlFor={ids.time} className="field-label">
                <Timer size={14} aria-hidden="true" /> Time spent
              </label>
              <input
                id={ids.time}
                className="num"
                inputMode="numeric"
                aria-describedby={ids.timeHint}
                value={typedTime ?? formatClock(elapsedMs)}
                onChange={(e) => setTypedTime(e.target.value)}
              />
            </div>
          </div>
          <p id={ids.timeHint} className="field-hint">
            {typedTime === null
              ? 'Counts while this case is open; type to correct it.'
              : 'Your time is used instead of the timer.'}
          </p>
          <p className="visually-hidden" role="status">{announcement}</p>
          <div className="field">
            <label htmlFor={ids.comment} className="field-label">Comment</label>
            <textarea id={ids.comment} rows={3} maxLength={10000} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={ids.files} className="field-label">Evidence</label>
            <input
              id={ids.files}
              ref={fileInput}
              type="file"
              multiple
              aria-describedby={ids.filesHint}
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            <p id={ids.filesHint} className="field-hint">Screenshots, logs or recordings; the server's size and type limits apply.</p>
          </div>
          <div className="checkbox-field">
            <input
              id={ids.defect}
              type="checkbox"
              checked={defectChecked}
              onChange={(e) => setWantsDefect(e.target.checked)}
            />
            <label htmlFor={ids.defect}>Create or link a defect after saving</label>
          </div>
          <FormError message={error} />
          <div className="form-buttons">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save result'}
            </button>
            {hasNext && (
              <button type="submit" className="btn btn-secondary" data-next="true" disabled={saving}>
                Save and next
              </button>
            )}
          </div>
        </div>
      </section>
    </form>
  );
}

/** A result as the run case panel lists it; the fields its edit form can change. */
export interface EditableResult {
  id: string;
  status: string;
  comment: string | null;
  durationMs: number | null;
}

/** Corrects the latest result of a case: its status, time spent and comment, and adds files. */
export function EditResultDialog({
  projectId,
  runId,
  result,
  onClose,
  onSaved,
}: {
  projectId: string;
  runId: string;
  /** The result to edit; the dialog is open while it is set. */
  result: EditableResult | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  return (
    <Dialog open={result !== null} onClose={onClose} title="Edit result">
      {result && (
        <EditResultForm projectId={projectId} runId={runId} result={result} onClose={onClose} onSaved={onSaved} />
      )}
    </Dialog>
  );
}

function EditResultForm({
  projectId,
  runId,
  result,
  onClose,
  onSaved,
}: {
  projectId: string;
  runId: string;
  result: EditableResult;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [status, setStatus] = useState(result.status);
  const [time, setTime] = useState(result.durationMs === null ? '' : formatClock(result.durationMs));
  const [comment, setComment] = useState(result.comment ?? '');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = { status: useId(), time: useId(), timeHint: useId(), comment: useId(), files: useId() };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    // An empty time removes it; anything else has to be a time.
    const durationMs = time.trim() === '' ? null : parseClock(time);
    if (time.trim() !== '' && durationMs === null) {
      setError(TIME_FORMAT_ERROR);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fields = changedFields(
        { status: result.status, comment: result.comment, durationMs: result.durationMs },
        { status, comment: comment.trim() || null, durationMs: durationMs === null ? null : Math.round(durationMs) },
      );
      if (hasChanges(fields)) await api.patch(`/projects/${projectId}/runs/${runId}/results/${result.id}`, fields);
      const failed = await uploadAll([
        { label: 'Files', path: `/projects/${projectId}/results/${result.id}/attachments`, files },
      ]);
      onSaved(failed.length === 0 ? 'Result updated.' : `Result updated, but the files weren't. ${failed.join(' ')}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the result");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="dialog-body" onSubmit={onSubmit}>
      <div className="field-grid">
        <div className="field">
          <label htmlFor={ids.status} className="field-label">Result</label>
          <Select id={ids.status} value={status} onChange={(e) => setStatus(e.target.value)}>
            {RESULT_CHOICES.map((choice) => (
              <option key={choice} value={choice}>{STATUS_META[choice].label}</option>
            ))}
          </Select>
        </div>
        <div className="field">
          <label htmlFor={ids.time} className="field-label">
            <Timer size={14} aria-hidden="true" /> Time spent
          </label>
          <input
            id={ids.time}
            className="num"
            inputMode="numeric"
            aria-describedby={ids.timeHint}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
      </div>
      <p id={ids.timeHint} className="field-hint">Like 1:05:09, 5:09 or 45; leave it empty for no time.</p>
      <div className="field">
        <label htmlFor={ids.comment} className="field-label">Comment</label>
        <textarea id={ids.comment} rows={4} maxLength={10000} value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={ids.files} className="field-label">Add files</label>
        <input id={ids.files} type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
      </div>
      <FormError message={error} />
      <div className="dialog-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>Save changes</button>
      </div>
    </form>
  );
}

interface DefectOption {
  id: string;
  title: string;
  status: string;
}

/**
 * Files a defect for a result: a new one prefilled from the case, or a link to a defect that is
 * already open, for when several cases fail for the same reason.
 */
export function DefectForResultDialog({
  open,
  projectId,
  resultId,
  caseTitle,
  summary,
  onClose,
  onDone,
}: {
  open: boolean;
  projectId: string;
  resultId: string;
  caseTitle: string;
  summary: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Defect for this result">
      {open && (
        <DefectForResultForm
          projectId={projectId}
          resultId={resultId}
          caseTitle={caseTitle}
          summary={summary}
          onClose={onClose}
          onDone={onDone}
        />
      )}
    </Dialog>
  );
}

function DefectForResultForm({
  projectId,
  resultId,
  caseTitle,
  summary,
  onClose,
  onDone,
}: {
  projectId: string;
  resultId: string;
  caseTitle: string;
  summary: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [title, setTitle] = useState(caseTitle);
  const [description, setDescription] = useState(summary);
  const [severity, setSeverity] = useState('MEDIUM');
  const [assigneeId, setAssigneeId] = useState('');
  const [defectId, setDefectId] = useState('');
  const [defects, setDefects] = useState<DefectOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const members = useProjectMembers(projectId);
  const ids = { title: useId(), description: useId(), severity: useId(), assignee: useId(), defect: useId() };

  useEffect(() => {
    if (mode !== 'existing' || defects) return;
    let cancelled = false;
    // Defects that are still being worked on; resolved and closed ones aren't offered.
    Promise.all(
      ['OPEN', 'IN_PROGRESS'].map((status) =>
        api.get<DefectOption[]>(`/projects/${projectId}/defects?status=${status}&limit=100`),
      ),
    )
      .then(([open, inProgress]) => {
        if (!cancelled) setDefects([...open, ...inProgress]);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load the defects");
      });
    return () => {
      cancelled = true;
    };
  }, [mode, defects, projectId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (mode === 'new') {
        await api.post(`/projects/${projectId}/defects`, {
          title: title.trim(),
          description: description.trim() || undefined,
          severity,
          assigneeId: assigneeId || undefined,
          resultIds: [resultId],
        });
        onDone(`Defect "${title.trim()}" created.`);
      } else {
        await api.post(`/projects/${projectId}/defects/${defectId}/results`, { resultIds: [resultId] });
        const linked = defects?.find((d) => d.id === defectId)?.title ?? 'the defect';
        onDone(`Result linked to "${linked}".`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the defect");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="dialog-body" onSubmit={onSubmit}>
      <div className="segmented" role="group" aria-label="New or existing defect">
        <button type="button" aria-pressed={mode === 'new'} onClick={() => setMode('new')}>New defect</button>
        <button type="button" aria-pressed={mode === 'existing'} onClick={() => setMode('existing')}>Existing defect</button>
      </div>
      {mode === 'new' ? (
        <>
          <div className="field">
            <label htmlFor={ids.title} className="field-label">Title</label>
            <input id={ids.title} value={title} required maxLength={300} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={ids.description} className="field-label">Actual result</label>
            <textarea id={ids.description} rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="field-grid">
            <div className="field">
              <label htmlFor={ids.severity} className="field-label">Severity</label>
              <Select id={ids.severity} value={severity} onChange={(e) => setSeverity(e.target.value)}>
                {Object.entries(DEFECT_SEVERITY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </div>
            <div className="field">
              <label htmlFor={ids.assignee} className="field-label">Assignee</label>
              <Select id={ids.assignee} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">Unassigned</option>
                {(members.data ?? []).map((m) => (
                  <option key={m.user.id} value={m.user.id}>{m.user.displayName}</option>
                ))}
              </Select>
            </div>
          </div>
        </>
      ) : defects === null && !error ? (
        <p className="muted" role="status">Loading defects…</p>
      ) : defects && defects.length === 0 ? (
        <p className="muted">There are no open defects in this project; create a new one instead.</p>
      ) : (
        <div className="field">
          <label htmlFor={ids.defect} className="field-label">Defect</label>
          <Select id={ids.defect} value={defectId} required onChange={(e) => setDefectId(e.target.value)}>
            <option value="">Choose a defect</option>
            {(defects ?? []).map((d) => (
              <option key={d.id} value={d.id}>{d.title}</option>
            ))}
          </Select>
        </div>
      )}
      <FormError message={error} />
      <div className="dialog-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Skip</button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={saving || (mode === 'existing' && !defects?.length)}
        >
          {mode === 'new' ? 'Create defect' : 'Link to defect'}
        </button>
      </div>
    </form>
  );
}
