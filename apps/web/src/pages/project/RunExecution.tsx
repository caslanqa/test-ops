import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Timer } from 'lucide-react';
import { api } from '../../api/client';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/Page';
import { DEFECT_SEVERITY_LABEL } from '../../lib/labels';
import { formatClock, parseClock } from '../../lib/format';
import { useProjectMembers } from '../../lib/members';
import {
  DEFECT_STATUSES,
  RESULT_CHOICES,
  STATUS_META,
  STEP_RESULT_CHOICES,
  type ResultStatus,
} from '../../lib/status';

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
 * Executes a case: a result per step with what actually happened, a timer for the time spent,
 * and the case result with a comment and evidence. A failed or blocked step sets the case result
 * accordingly; the tester can still change it before saving.
 */
export function CaseExecution({
  projectId,
  runId,
  runCaseId,
  testCaseId,
  title,
  steps,
  onSaved,
}: {
  projectId: string;
  runId: string;
  runCaseId: string;
  testCaseId: string;
  title: string;
  steps: CaseStep[];
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
      // Pressing the selected result again clears it.
      const { [step.position]: _removed, ...rest } = marks;
      setMarks(rest);
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const durationMs = typedTime === null ? elapsedMs : parseClock(typedTime);
    if (durationMs === null) {
      setError('Time spent must look like 1:05:09, 5:09 or 45.');
      return;
    }
    setSaving(true);
    setError(null);
    const label = STATUS_META[status].label.toLowerCase();
    const summary = describeOutcome(steps, marks, comment);
    try {
      const result = await api.post<{ id: string }>(`/projects/${projectId}/runs/${runId}/results`, {
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
      let message = `${title} marked as ${label}.`;
      if (files.length > 0) {
        const form = new FormData();
        for (const file of files) form.append('files', file);
        try {
          await api.upload(`/projects/${projectId}/results/${result.id}/attachments`, form);
        } catch (err) {
          // The result stays; only the files are missing, so say exactly that.
          setError(`The result was saved, but the files weren't: ${err instanceof Error ? err.message : 'upload failed'}`);
          message = `${title} marked as ${label}, without the files.`;
        }
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
      setAnnouncement('');
      if (fileInput.current) fileInput.current.value = '';
      onSaved(message, { resultId: result.id, status, wantsDefect: defectChecked, summary });
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
              <select id={ids.status} value={status} onChange={(e) => setStatus(e.target.value as ResultStatus)}>
                {RESULT_CHOICES.map((choice) => (
                  <option key={choice} value={choice}>{STATUS_META[choice].label}</option>
                ))}
              </select>
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
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save result'}
          </button>
        </div>
      </section>
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
              <select id={ids.severity} value={severity} onChange={(e) => setSeverity(e.target.value)}>
                {Object.entries(DEFECT_SEVERITY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={ids.assignee} className="field-label">Assignee</label>
              <select id={ids.assignee} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">Unassigned</option>
                {(members.data ?? []).map((m) => (
                  <option key={m.user.id} value={m.user.id}>{m.user.displayName}</option>
                ))}
              </select>
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
          <select id={ids.defect} value={defectId} required onChange={(e) => setDefectId(e.target.value)}>
            <option value="">Choose a defect</option>
            {(defects ?? []).map((d) => (
              <option key={d.id} value={d.id}>{d.title}</option>
            ))}
          </select>
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
