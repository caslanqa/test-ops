import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Info } from 'lucide-react';
import { api } from '../../api/client';
import { AiDraftCard } from '../../components/AiDraftCard';
import { FormError, LoadError, Loading, PageHeader } from '../../components/Page';
import { Select } from '../../components/Select';
import { useFocusFallback } from '../../lib/focus';
import { Tag } from '../../components/StatusChip';
import { AI_STEP_LABEL, aiRunStatusText, type AiRun, type CaseDraft } from '../../lib/ai';
import { useNotice } from '../../lib/notice';
import { useProjectPermissions } from '../../lib/permissions';
import { suitePath, type Suite } from '../../lib/suites';
import { usePageTitle, useResource } from '../../lib/useResource';

const POLL_MS = 2000;

/** What a person sees of one run and, once the drafts are ready, what they can do with them. */
function RunView({
  run,
  requirementTitle,
  canEdit,
  refreshError,
  reload,
}: {
  run: AiRun;
  requirementTitle: string | undefined;
  canEdit: boolean;
  /** Why the last refresh of a run that is still going failed; the page keeps trying. */
  refreshError: string | null;
  reload: () => void;
}) {
  const { projectId } = run;
  const navigate = useNavigate();
  const { notify } = useNotice();
  // Null shows the drafts as the model wrote them; an edit or a delete makes this the list that is approved.
  const [edited, setEdited] = useState<CaseDraft[] | null>(null);
  const [suiteId, setSuiteId] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suiteFieldId = useId();
  const suites = useResource(() => api.get<Suite[]>(`/projects/${projectId}/suites`), [projectId]);
  const drafts = edited ?? run.result?.drafts ?? [];
  // Said, out of sight, when a draft is deleted: the button that was pressed is gone with it.
  const [announcement, setAnnouncement] = useState('');
  // Deleting a draft, approving and cancelling remove the control that was used; focus goes to the drafts, or else
  // to the status, rather than to the top of the page.
  const requestFocus = useFocusFallback(`${run.status}:${drafts.length}`, () =>
    document.getElementById('ai-drafts-heading') ?? document.getElementById('ai-run-status-heading'),
  );
  const waiting = run.status === 'AWAITING_APPROVAL';
  const snapshot = run.providerSnapshot;

  async function act(action: () => Promise<unknown>, fallback: string) {
    requestFocus();
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  /** A new run for the same requirement, with the given notes; it opens in place of this one. */
  const startAgain = (extraContext?: string) =>
    act(async () => {
      const started = await api.post<{ runId: string }>(`/projects/${projectId}/ai/runs`, {
        type: run.type,
        requirementId: run.input.requirementId,
        ...(extraContext ? { extraContext } : {}),
      });
      navigate(`/projects/${projectId}/ai/runs/${started.runId}`);
    }, "Couldn't start a new run");

  function approve(e: FormEvent) {
    e.preventDefault();
    return act(async () => {
      const done = await api.post<{ createdCaseIds: string[] }>(`/projects/${projectId}/ai/runs/${run.id}/approve`, {
        ...(suiteId ? { suiteId } : {}),
        cases: drafts.map((draft) => ({
          title: draft.title.trim(),
          preconditions: draft.preconditions?.trim() || undefined,
          steps: draft.steps?.filter((step) => step.action.trim()).map((step) => ({ action: step.action.trim(), expectedResult: step.expectedResult?.trim() || undefined })),
          priority: draft.priority,
          type: draft.type,
          kind: draft.kind,
        })),
      });
      notify(`${done.createdCaseIds.length} test ${done.createdCaseIds.length === 1 ? 'case' : 'cases'} created from the AI drafts.`);
      reload();
    }, "Couldn't create the test cases");
  }

  const cancel = () =>
    act(async () => {
      await api.post(`/projects/${projectId}/ai/runs/${run.id}/cancel`);
      reload();
    }, "Couldn't cancel the run");

  return (
    <>
      <p role="status" className="visually-hidden">{announcement}</p>
      <PageHeader
        title="Draft test cases"
        description={requirementTitle ? <>For the requirement <strong>{requirementTitle}</strong>.</> : undefined}
        actions={<Link to={`/projects/${projectId}/requirements`} className="btn btn-secondary">Back to requirements</Link>}
      />
      <section className="surface integrations-section" aria-labelledby="ai-run-status-heading">
        <h2 id="ai-run-status-heading" className="section-title" tabIndex={-1}>Status</h2>
        <p role="status" className="ai-run-status">
          <Tag tone={run.status === 'FAILED' || run.status === 'CANCELLED' ? 'outline' : 'strong'}>{run.status.replace('_', ' ').toLowerCase()}</Tag>{' '}
          {aiRunStatusText(run)}
        </p>
        {run.steps.length > 0 && (
          <ol className="ai-steps" aria-label="Steps of this run">
            {run.steps.map((step) => (
              <li key={`${step.name}-${step.attempt}`}>
                {AI_STEP_LABEL[step.name] ?? step.name}
                {step.attempt > 1 ? ` (try ${step.attempt})` : ''}: {step.status === 'COMPLETED' ? 'done' : step.status === 'RUNNING' ? 'running' : 'failed'}
                {step.error && <span className="muted"> — {step.error}</span>}
              </li>
            ))}
          </ol>
        )}
        {run.error && <p className="form-error" role="alert">{run.error}</p>}
        {refreshError && <p className="form-error" role="alert">Couldn't refresh this run ({refreshError}). Trying again…</p>}
        <p className="info-note">
          <Info size={16} aria-hidden="true" />
          Sent to {snapshot.endpointHost} ({snapshot.model}), using {snapshot.source === 'PROJECT' ? 'this project’s AI setting' : 'the workspace default'}:
          the requirement’s title and description, any notes added, the cases already linked to it (title and steps), and
          the id and title of up to 200 other cases of the project. Nothing else, and nothing from other projects.
        </p>
        {run.input.extraContext && <p className="muted">Notes for the model: {run.input.extraContext}</p>}
        <FormError message={error} />
        {canEdit && (run.status === 'FAILED' || run.status === 'CANCELLED') && (
          <div className="form-buttons">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => startAgain(run.input.extraContext ?? undefined)}>Start again</button>
          </div>
        )}
        {run.status === 'COMPLETED' && (
          <p><Link to={`/projects/${projectId}/cases`}>View the test cases</Link></p>
        )}
      </section>

      {run.result && (waiting || run.status === 'COMPLETED') && (
        <section className="surface integrations-section" aria-labelledby="ai-review-heading">
          <h2 id="ai-review-heading" className="section-title">Review of the requirement</h2>
          <p>{run.result.review.summary}</p>
          {run.result.review.acceptanceCriteria.length > 0 && (
            <>
              <h3 className="section-title">Acceptance criteria</h3>
              <ol>
                {run.result.review.acceptanceCriteria.map((criterion, i) => <li key={i}>{criterion}</li>)}
              </ol>
            </>
          )}
          {run.result.review.findings.length > 0 && (
            <>
              <h3 className="section-title">Findings</h3>
              <ul>
                {run.result.review.findings.map((finding, i) => (
                  <li key={i}><Tag tone={finding.severity === 'high' ? 'strong' : 'outline'}>{finding.severity} {finding.kind}</Tag> {finding.text}</li>
                ))}
              </ul>
            </>
          )}
          <h3 className="section-title">Coverage check</h3>
          <p>{run.result.audit.notes}</p>
          {run.result.audit.uncovered.length > 0 && (
            <p>Not covered by any draft: {run.result.audit.uncovered.map((i) => `criterion ${i + 1}`).join(', ')}.</p>
          )}
          {run.result.audit.duplicates.length > 0 && (
            <ul>
              {run.result.audit.duplicates.map((d, i) => (
                <li key={i}>Draft {d.caseIndex + 1} may repeat the existing case <code>{d.existingCaseId}</code>: {d.reason}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {waiting && run.result && (
        <form className="surface integrations-section" aria-labelledby="ai-drafts-heading" onSubmit={approve}>
          <h2 id="ai-drafts-heading" className="section-title" tabIndex={-1}>Drafts</h2>
          {!canEdit && <p className="muted">Only testers and project admins can change and approve drafts.</p>}
          <fieldset disabled={!canEdit} className="ai-drafts">
            <legend className="visually-hidden">Draft test cases</legend>
            {drafts.length === 0 ? (
              <p className="muted">No drafts are left to approve.</p>
            ) : (
              <ol className="ai-draft-list">
                {drafts.map((draft, i) => (
                  <AiDraftCard
                    key={i}
                    index={i}
                    draft={draft}
                    onChange={(next) => setEdited(drafts.map((d, at) => (at === i ? next : d)))}
                    onDelete={() => {
                      requestFocus();
                      setEdited(drafts.filter((_, at) => at !== i));
                      setAnnouncement(`Draft ${i + 1} deleted.`);
                    }}
                  />
                ))}
              </ol>
            )}
            <div className="field">
              <label htmlFor={suiteFieldId} className="field-label">Suite</label>
              <Select id={suiteFieldId} value={suiteId} onChange={(e) => setSuiteId(e.target.value)}>
                <option value="">No suite</option>
                {(suites.data ?? []).map((suite) => <option key={suite.id} value={suite.id}>{suitePath(suites.data ?? [], suite.id)}</option>)}
              </Select>
            </div>
          </fieldset>
          {canEdit && (
            <div className="form-buttons">
              <button type="submit" className="btn btn-primary" disabled={busy || drafts.length === 0}>
                Approve {drafts.length} {drafts.length === 1 ? 'draft' : 'drafts'}
              </button>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={cancel}>Cancel run</button>
            </div>
          )}
          {canEdit && (
            <div className="field">
              <label htmlFor="ai-notes" className="field-label">Notes for the model</label>
              <textarea id="ai-notes" rows={2} maxLength={8000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Something the drafts missed, such as “mention the mobile app”" />
              <div className="form-buttons">
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => startAgain(notes.trim() || undefined)}>Draft again with notes</button>
              </div>
            </div>
          )}
        </form>
      )}
    </>
  );
}

/**
 * One AI run on a requirement. It polls while the run is waiting or working, and a person leaving and coming back
 * finds it where it was. Nothing is written to the test cases until someone approves the drafts here.
 */
export function AiRunPage() {
  const { projectId = '', runId = '' } = useParams();
  const { editRepository } = useProjectPermissions(projectId);
  const runRes = useResource(() => api.get<AiRun>(`/projects/${projectId}/ai/runs/${runId}`), [projectId, runId]);
  // A reload keeps the old data until the new arrives; another run's data must not show under this run's address.
  const run = runRes.data?.id === runId ? runRes.data : undefined;
  const requirementId = run?.input.requirementId;
  const requirement = useResource(
    () => (requirementId ? api.get<{ title: string }>(`/projects/${projectId}/requirements/${requirementId}`) : Promise.resolve(null)),
    [projectId, requirementId],
  );
  usePageTitle(requirement.data ? `AI drafts for ${requirement.data.title}` : 'AI drafts');
  const working = run?.status === 'QUEUED' || run?.status === 'RUNNING';
  const { reload } = runRes;
  // A steady interval, not one timeout per answer: when a refresh fails the data does not change, so a timeout
  // that is re-armed by new data would never be set again and the page would stay at "Working" for good.
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [working, reload]);

  if (runRes.error && !run) return <LoadError message={runRes.error} onRetry={reload} />;
  if (!run) return <Loading />;
  return (
    <RunView
      key={run.id}
      run={run}
      requirementTitle={requirement.data?.title}
      canEdit={editRepository}
      refreshError={runRes.error}
      reload={reload}
    />
  );
}
