import { useEffect, useId, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Bug, CheckCheck, X } from 'lucide-react';
import { api } from '../../api/client';
import { LoadError, Loading, PageHeader } from '../../components/Page';
import { ResultRibbon, StatusLegend } from '../../components/ResultRibbon';
import { StatusChip, Tag } from '../../components/StatusChip';
import { formatDate } from '../../lib/format';
import { RUN_SOURCE_LABEL, RUN_STATUS_LABEL, labelOf } from '../../lib/labels';
import {
  RESULT_CHOICES,
  STATUS_META,
  isResultStatus,
  normalizeCounts,
  type ResultStatus,
} from '../../lib/status';
import { useProjectPermissions } from '../../lib/permissions';
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
  createdAt: string;
  completedAt: string | null;
  runCases: RunCase[];
  progress: Record<string, number>;
}

interface ResultRow {
  id: string;
  runCase: { testCaseId: string };
}

/** Run başlatıldığındaki case kopyası (snapshot): tester'ın uygulayacağı adımlar. */
function RunCasePanel({ runCase, onClose }: { runCase: RunCase; onClose: () => void }) {
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
      <p className="detail-path">As it was when the run started</p>
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
    </aside>
  );
}

/**
 * Bir case için sonuç butonları (aria-pressed ile mevcut durum) ve kaldıysa defect açma.
 * Masaüstünde ayrı sütunda, dar ekranda case başlığının altında gösterilir; görünmeyen
 * kopya display:none ile erişilebilirlik ağacından da çıkar.
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
  const { execute } = useProjectPermissions(projectId);
  usePageTitle(run?.title);

  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; defectLink?: boolean } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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

  async function completeRun() {
    setActionError(null);
    try {
      await api.post(`/projects/${projectId}/runs/${runId}/complete`);
      setNotice({ text: "Run completed. Completed runs don't accept new results." });
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't complete the run");
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
  // Sonuç girişi yalnızca açık run'da ve yürütme yetkisi olan rollere (Admin, Tester, Otomasyon).
  const canRecord = isOpen && execute;
  const runCases = [...run.runCases].sort((a, b) => a.position - b.position);
  const statuses = runCases.map((rc) => (isResultStatus(rc.status) ? rc.status : 'UNTESTED'));
  const counts = normalizeCounts(run.progress);
  const total = runCases.length;
  const done = total - counts.UNTESTED;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const openCase = runCases.find((rc) => rc.id === openCaseId) ?? null;

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
          canRecord && (
            <button type="button" className="btn btn-primary" onClick={completeRun}>
              <CheckCheck size={16} aria-hidden="true" />
              Complete run
            </button>
          )
        }
      />

      {/* Sonuç listenin neresinde girilirse girilsin onay görünür kalsın diye ekranın altında
          sabit; role=status ile odak taşınmadan ekran okuyuculara da duyurulur (WCAG 4.1.3). */}
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
              {runCases.map((rc, index) => (
                <tr key={rc.id} className={rc.id === openCaseId ? 'is-selected' : undefined}>
                  <td className="col-index muted num hide-sm">{index + 1}</td>
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
        </div>
        {openCase && <RunCasePanel runCase={openCase} onClose={closePanel} />}
      </div>
    </>
  );
}
