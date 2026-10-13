import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Play, PlayCircle } from 'lucide-react';
import { api } from '../../api/client';
import { CaseChecklist, type ChecklistCase } from '../../components/CaseChecklist';
import { Dialog } from '../../components/Dialog';
import { EmptyState, FormError, LoadError, Loading, PageHeader } from '../../components/Page';
import { ResultRibbon } from '../../components/ResultRibbon';
import { Tag } from '../../components/StatusChip';
import { formatDate, formatDateTime } from '../../lib/format';
import { RUN_SOURCE_LABEL, RUN_STATUS_LABEL, labelOf } from '../../lib/labels';
import { useProjectPermissions } from '../../lib/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useProjectInfo } from '../../lib/projectInfo';
import { normalizeCounts } from '../../lib/status';
import type { Suite } from '../../lib/suites';
import { usePageTitle, useResource } from '../../lib/useResource';

interface RunRow {
  id: string;
  title: string;
  status: string;
  source: string;
  environment: string | null;
  build: string | null;
  createdAt: string;
  progress: Record<string, number>;
}

interface PlanOption {
  id: string;
  title: string;
}

type StatusFilter = 'ALL' | 'OPEN' | 'COMPLETED';

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'OPEN', label: 'Open' },
  { value: 'COMPLETED', label: 'Completed' },
];

/** Creating a run: from a plan or with an ad hoc case selection (FR-032). */
// The form mounts only while the dialog is open: state starts clean on every open, and
// the data the form needs is requested when the dialog opens, not when the page loads.
function CreateRunDialog({ open, ...props }: Parameters<typeof CreateRunForm>[0] & { open: boolean }) {
  return (
    <Dialog
      open={open}
      onClose={props.onClose}
      title="New run"
      description="A run starts from a snapshot of the selected cases, so results stay accurate even if the repository changes later."
      wide
    >
      <CreateRunForm {...props} />
    </Dialog>
  );
}

function CreateRunForm({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [title, setTitle] = useState(() => `Run – ${formatDateTime(new Date())}`);
  const [planId, setPlanId] = useState('');
  const [caseIds, setCaseIds] = useState<string[]>([]);
  const [environment, setEnvironment] = useState('');
  const [build, setBuild] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = { title: useId(), plan: useId(), env: useId(), build: useId() };

  const plans = useResource(() => api.get<PlanOption[]>(`/projects/${projectId}/plans`), [projectId]);
  const cases = useResource(() => api.get<ChecklistCase[]>(`/projects/${projectId}/cases`), [projectId]);
  const suites = useResource(() => api.get<Suite[]>(`/projects/${projectId}/suites`), [projectId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!planId && caseIds.length === 0) {
      setError('Choose a plan or select at least one case.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const run = await api.post<{ id: string }>(`/projects/${projectId}/runs`, {
        title,
        planId: planId || undefined,
        testCaseIds: planId ? undefined : caseIds,
        environment: environment.trim() || undefined,
        build: build.trim() || undefined,
        source: 'MANUAL',
      });
      onClose();
      navigate(`/projects/${projectId}/runs/${run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the run");
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
      <div className="field-grid">
        <div className="field">
          <label htmlFor={ids.plan} className="field-label">Plan</label>
          <select id={ids.plan} value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">No plan, I'll pick cases</option>
            {plans.data?.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.env} className="field-label">Environment</label>
          <input id={ids.env} placeholder="e.g. staging" value={environment} onChange={(e) => setEnvironment(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={ids.build} className="field-label">Build / version</label>
          <input id={ids.build} placeholder="e.g. 2.4.0-rc1" value={build} onChange={(e) => setBuild(e.target.value)} />
        </div>
      </div>
      {!planId &&
        (cases.data && suites.data ? (
          <CaseChecklist cases={cases.data} suites={suites.data} selected={caseIds} onChange={setCaseIds} />
        ) : (
          <Loading label="Loading cases…" />
        ))}
      <FormError message={error} />
      <div className="dialog-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          <Play size={16} aria-hidden="true" />
          Start run
        </button>
      </div>
    </form>
  );
}

export function RunsPage() {
  const { projectId = '' } = useParams();
  const { data: info } = useProjectInfo(projectId);
  const { execute } = useProjectPermissions(projectId);
  usePageTitle(info ? `Runs (${info.project.name})` : 'Runs');
  const { user } = useAuth();
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [onlyMine, setOnlyMine] = useState(false);
  const [creating, setCreating] = useState(false);
  const { data: runs, error, loading, reload } = useResource(() => {
    const params = new URLSearchParams();
    if (filter !== 'ALL') params.set('status', filter);
    if (onlyMine && user) params.set('assigneeId', user.id);
    const query = params.toString();
    return api.get<RunRow[]>(`/projects/${projectId}/runs${query ? `?${query}` : ''}`);
  }, [projectId, filter, onlyMine, user?.id]);

  const createButton = execute ? (
    <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
      <Play size={16} aria-hidden="true" />
      New run
    </button>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Runs"
        description="Manual and automated results are collected in the same run."
        actions={createButton}
      />
      <div className="segmented" role="group" aria-label="Filter by run status">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="segmented" role="group" aria-label="Filter runs by assignee">
        <button type="button" aria-pressed={!onlyMine} onClick={() => setOnlyMine(false)}>All runs</button>
        <button type="button" aria-pressed={onlyMine} onClick={() => setOnlyMine(true)}>Assigned to me</button>
      </div>
      {error && <LoadError message={error} onRetry={reload} />}
      {loading && <Loading />}
      {runs && runs.length === 0 && (
        <div className="surface">
          <EmptyState icon={PlayCircle} title={filter === 'ALL' && !onlyMine ? 'No runs yet' : 'No runs match this filter'} action={filter === 'ALL' && !onlyMine ? createButton : undefined}>
            {filter === 'ALL' && !onlyMine
              ? 'Start a run from a plan or from cases you pick; results appear here.'
              : 'Try another filter.'}
          </EmptyState>
        </div>
      )}
      {runs && runs.length > 0 && (
        <div className="surface table-wrap">
          <table className="data-table">
            <caption className="visually-hidden">Runs</caption>
            <thead>
              <tr>
                <th scope="col" className="col-main">Run</th>
                <th scope="col" className="col-ribbon">Results</th>
                <th scope="col">Status</th>
                <th scope="col" className="hide-sm">Source</th>
                <th scope="col" className="hide-sm">Started</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const counts = normalizeCounts(run.progress);
                const total = Object.values(counts).reduce((a, b) => a + b, 0);
                const done = total - counts.UNTESTED;
                return (
                  <tr key={run.id}>
                    <td>
                      <Link to={`/projects/${projectId}/runs/${run.id}`} className="row-link">{run.title}</Link>
                      {(run.environment || run.build) && (
                        <p className="cell-sub">
                          {[run.environment && `Environment: ${run.environment}`, run.build && `Build: ${run.build}`]
                            .filter(Boolean)
                            .join(', ')}
                        </p>
                      )}
                    </td>
                    <td className="col-ribbon">
                      <div className="ribbon-cell-wrap">
                        <ResultRibbon counts={run.progress} size="sm" label={run.title} />
                        <span className="ribbon-fraction num">{done}/{total}</span>
                      </div>
                    </td>
                    <td>
                      <Tag tone={run.status === 'OPEN' ? 'strong' : 'neutral'}>{labelOf(RUN_STATUS_LABEL, run.status)}</Tag>
                    </td>
                    <td className="hide-sm">{labelOf(RUN_SOURCE_LABEL, run.source)}</td>
                    <td className="hide-sm muted num">{formatDate(run.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <CreateRunDialog projectId={projectId} open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
