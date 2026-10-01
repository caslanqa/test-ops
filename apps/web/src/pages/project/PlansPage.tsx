import { useId, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ClipboardList, Play, Plus } from 'lucide-react';
import { api } from '../../api/client';
import { CaseChecklist, type ChecklistCase } from '../../components/CaseChecklist';
import { Dialog } from '../../components/Dialog';
import { EmptyState, FormError, LoadError, Loading, PageHeader } from '../../components/Page';
import { formatDate, formatDateTime } from '../../lib/format';
import { useProjectPermissions } from '../../lib/permissions';
import { useProjectInfo } from '../../lib/projectInfo';
import type { Suite } from '../../lib/suites';
import { usePageTitle, useResource } from '../../lib/useResource';

/** Plandan başlatılan run'ın adı: plan adı + başlatılma zamanı (aynı plandan birden fazla run ayırt edilsin). */
function runTitleFor(planTitle: string): string {
  return `${planTitle} – ${formatDateTime(new Date())}`;
}

interface PlanRow {
  id: string;
  title: string;
  description: string | null;
  createdAt: string;
  _count: { items: number; runs: number };
}

// Form yalnızca dialog açıkken mount olur: her açılışta state temiz başlar ve
// form'un ihtiyaç duyduğu veriler sayfa açılırken değil, dialog açılınca istenir.
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
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
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
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const { data: plans, error, loading, reload } = useResource(
    () => api.get<PlanRow[]>(`/projects/${projectId}/plans`),
    [projectId],
  );

  async function startRun(plan: PlanRow) {
    setStarting(plan.id);
    setStartError(null);
    try {
      const run = await api.post<{ id: string }>(`/projects/${projectId}/runs`, {
        title: runTitleFor(plan.title),
        planId: plan.id,
        source: 'MANUAL',
      });
      navigate(`/projects/${projectId}/runs/${run.id}`);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Couldn't start the run");
      setStarting(null);
    }
  }

  const createButton = editRepository ? (
    <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
      <Plus size={16} aria-hidden="true" />
      New plan
    </button>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Plans"
        description="Reusable test scopes. Start as many runs from each plan as you need."
        actions={createButton}
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
                {execute && <th scope="col"><span className="visually-hidden">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id}>
                  <td>
                    <span className="cell-title">{plan.title}</span>
                    {plan.description && <p className="cell-sub">{plan.description}</p>}
                  </td>
                  <td className="num-col num">{plan._count.items}</td>
                  <td className="num-col num hide-sm">{plan._count.runs}</td>
                  <td className="muted num hide-sm">{formatDate(plan.createdAt)}</td>
                  {execute && (
                  <td className="cell-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => startRun(plan)}
                      disabled={starting === plan.id || plan._count.items === 0}
                      aria-label={`Start a run from ${plan.title}`}
                    >
                      <Play size={14} aria-hidden="true" />
                      Start run
                    </button>
                  </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CreatePlanDialog
        projectId={projectId}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          reload();
        }}
      />
    </>
  );
}
