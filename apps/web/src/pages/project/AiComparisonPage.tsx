import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { AiDraftCard } from '../../components/AiDraftCard';
import { GuidanceUsed } from '../../components/GuidanceUsed';
import { FormError, LoadError, Loading, PageHeader } from '../../components/Page';
import { Tag } from '../../components/StatusChip';
import { aiRunStatusText, type AiComparison, type AiRun, type ComparisonVerdict } from '../../lib/ai';
import { useNotice } from '../../lib/notice';
import { useProjectPermissions } from '../../lib/permissions';
import { usePageTitle, useResource } from '../../lib/useResource';

const POLL_MS = 2000;
const WITH_DRAFTS = ['AWAITING_APPROVAL', 'COMPLETED'];
const GOING = ['QUEUED', 'RUNNING'];
const VERDICT_LABEL: Record<ComparisonVerdict, string> = { A: 'A is better', B: 'B is better', NEITHER: 'Neither is better' };
const noop = () => undefined;

/** One side of a comparison: what it was sent of the team's guidance, how its run went, and its drafts, read-only. */
function Side({ side, run, projectId }: { side: 'A' | 'B'; run: AiRun; projectId: string }) {
  const headingId = useId();
  const drafts = run.result?.drafts ?? [];
  return (
    <section className="surface integrations-section" aria-labelledby={headingId}>
      <h2 id={headingId} className="section-title">Side {side}</h2>
      <p className="ai-run-status">
        <Tag tone={run.status === 'FAILED' || run.status === 'CANCELLED' ? 'outline' : 'strong'}>{run.status.replace('_', ' ').toLowerCase()}</Tag>{' '}
        {aiRunStatusText(run)}
      </p>
      {run.guidance && <GuidanceUsed guidance={run.guidance} />}
      {run.error && <p className="form-error" role="alert">{run.error}</p>}
      {drafts.length > 0 && (
        <div role="group" aria-label={`Drafts of side ${side}`}>
          <ol className="ai-draft-list">
            {drafts.map((draft, i) => (
              <AiDraftCard key={i} index={i} draft={draft} readOnly onChange={noop} onDelete={noop} />
            ))}
          </ol>
        </div>
      )}
      <p><Link to={`/projects/${projectId}/ai/runs/${run.id}`}>Open the run of side {side}</Link></p>
    </section>
  );
}

/** The verdict: once both runs have drafts, a person says which drafted better, and can change it later. */
function Verdict({ comparison, canJudge, reload }: { comparison: AiComparison; canJudge: boolean; reload: () => void }) {
  const { notify } = useNotice();
  const [preferred, setPreferred] = useState<ComparisonVerdict | null>(comparison.preferred);
  const [note, setNote] = useState(comparison.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const name = useId();
  const noteId = useId();
  const { A, B } = comparison.runs;
  const ready = WITH_DRAFTS.includes(A.status) && WITH_DRAFTS.includes(B.status);
  const failed = [A, B].some((run) => run.status === 'FAILED' || run.status === 'CANCELLED');

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!preferred || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.put(`/projects/${comparison.projectId}/ai/comparisons/${comparison.id}/verdict`, { preferred, ...(note.trim() ? { note: note.trim() } : {}) });
      const message = `Verdict saved: ${VERDICT_LABEL[preferred]}.`;
      setAnnouncement(message);
      notify(message);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the verdict");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface integrations-section" aria-labelledby={`${name}-heading`}>
      <h2 id={`${name}-heading`} className="section-title">Verdict</h2>
      {/* On the page before there is a message: a region that appears with its text already in it is often not announced. */}
      <p role="status" className="visually-hidden">{announcement}</p>
      {comparison.preferred && (
        <p>
          <strong>{VERDICT_LABEL[comparison.preferred]}.</strong>
          {comparison.note ? <> {comparison.note}</> : null}
        </p>
      )}
      {!comparison.preferred && !canJudge && <p className="muted">No verdict yet.</p>}
      {!ready && !failed && <p className="muted">A verdict can be given once both runs have drafts.</p>}
      {failed && <p className="muted">A run did not end with drafts, so there is nothing to compare. Start the comparison again.</p>}
      {canJudge && ready && (
        <form onSubmit={save} className="integrations-form">
          <fieldset className="guidance-steps">
            <legend className="field-label">Which drafted better?</legend>
            {(Object.keys(VERDICT_LABEL) as ComparisonVerdict[]).map((value) => (
              <div className="checkbox-field" key={value}>
                <input id={`${name}-${value}`} type="radio" name={name} checked={preferred === value} onChange={() => setPreferred(value)} />
                <label htmlFor={`${name}-${value}`}>{VERDICT_LABEL[value]}</label>
              </div>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor={noteId} className="field-label">Why (optional)</label>
            <textarea id={noteId} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <FormError message={error} />
          <div className="form-buttons">
            {/* Not disabled while saving: a button that is disabled loses the focus and does not get it back. */}
            <button type="submit" className="btn btn-primary" disabled={!preferred} aria-busy={busy}>
              {comparison.preferred ? 'Change the verdict' : 'Save verdict'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/**
 * Two runs of one requirement under two selections of guidance, side by side. It polls while a run is working, and a
 * person leaving and coming back finds it where it was. The verdict feeds the counts shown with each guidance.
 */
export function AiComparisonPage() {
  const { projectId = '', comparisonId = '' } = useParams();
  const { editRepository } = useProjectPermissions(projectId);
  const resource = useResource(() => api.get<AiComparison>(`/projects/${projectId}/ai/comparisons/${comparisonId}`), [projectId, comparisonId]);
  const comparison = resource.data?.id === comparisonId ? resource.data : undefined;
  const requirementId = comparison?.requirementId;
  const requirement = useResource(
    () => (requirementId ? api.get<{ title: string }>(`/projects/${projectId}/requirements/${requirementId}`) : Promise.resolve(null)),
    [projectId, requirementId],
  );
  usePageTitle(requirement.data ? `Compare guidance for ${requirement.data.title}` : 'Compare guidance');
  const working = comparison ? [comparison.runs.A.status, comparison.runs.B.status].some((status) => GOING.includes(status)) : false;
  const { reload } = resource;
  // A steady interval, as on the run page: a refresh that fails must not stop the polling.
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [working, reload]);

  if (resource.error && !comparison) return <LoadError message={resource.error} onRetry={reload} />;
  if (!comparison) return <Loading />;
  return (
    <>
      <PageHeader
        title="Compare guidance"
        description={requirement.data ? <>Two drafts for the requirement <strong>{requirement.data.title}</strong>, each under its own guidance.</> : undefined}
        actions={<Link to={`/projects/${projectId}/requirements`} className="btn btn-secondary">Back to requirements</Link>}
      />
      <div className="comparison-sides">
        <Side side="A" run={comparison.runs.A} projectId={projectId} />
        <Side side="B" run={comparison.runs.B} projectId={projectId} />
      </div>
      {/* Keyed by the comparison only: saving a verdict reloads it, and a new key would drop the focus on the button that was pressed. */}
      <Verdict key={comparison.id} comparison={comparison} canJudge={editRepository} reload={reload} />
    </>
  );
}
