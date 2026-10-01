import { useId, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Link2, ListChecks, Plus } from 'lucide-react';
import { api } from '../../api/client';
import { CaseChecklist, type ChecklistCase } from '../../components/CaseChecklist';
import { Dialog } from '../../components/Dialog';
import { EmptyState, FormError, LoadError, Loading, PageHeader } from '../../components/Page';
import { ResultRibbon } from '../../components/ResultRibbon';
import { Tag } from '../../components/StatusChip';
import { useProjectPermissions } from '../../lib/permissions';
import { useProjectInfo } from '../../lib/projectInfo';
import { normalizeCounts } from '../../lib/status';
import type { Suite } from '../../lib/suites';
import { plural } from '../../lib/format';
import { usePageTitle, useResource } from '../../lib/useResource';

interface Requirement {
  id: string;
  title: string;
  description: string | null;
  externalRef: string | null;
  cases: { testCase: { id: string; title: string } }[];
}

interface CoverageRow {
  requirementId: string;
  caseCount: number;
  hasCoverage: boolean;
  lastResultStatusBreakdown: Record<string, number>;
}

/** Hiç koşulmamış bağlı case'ler "test edilmedi" sayılır; şerit kapsamın tamamını gösterir. */
function coverageCounts(row: CoverageRow | undefined) {
  const counts = normalizeCounts(row?.lastResultStatusBreakdown);
  const executed = Object.values(counts).reduce((a, b) => a + b, 0);
  counts.UNTESTED += Math.max(0, (row?.caseCount ?? 0) - executed);
  return counts;
}

// Form yalnızca dialog açıkken mount olur: her açılışta state temiz başlar ve
// form'un ihtiyaç duyduğu veriler sayfa açılırken değil, dialog açılınca istenir.
function CreateRequirementDialog({ open, ...props }: Parameters<typeof CreateRequirementForm>[0] & { open: boolean }) {
  return (
    <Dialog open={open} onClose={props.onClose} title="New requirement">
      <CreateRequirementForm {...props} />
    </Dialog>
  );
}

function CreateRequirementForm({
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
  const [externalRef, setExternalRef] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = { title: useId(), description: useId(), ref: useId(), refHint: useId() };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post(`/projects/${projectId}/requirements`, {
        title,
        description: description.trim() || undefined,
        externalRef: externalRef.trim() || undefined,
      });
      setTitle('');
      setDescription('');
      setExternalRef('');
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the requirement");
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
        <button type="submit" className="btn btn-primary" disabled={saving}>Create requirement</button>
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
      title="Link cases"
      description={requirement ? `Choose the cases that cover "${requirement.title}".` : undefined}
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
}: {
  projectId: string;
  requirement: Requirement;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [caseIds, setCaseIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const cases = useResource(() => api.get<ChecklistCase[]>(`/projects/${projectId}/cases`), [projectId]);
  const suites = useResource(() => api.get<Suite[]>(`/projects/${projectId}/suites`), [projectId]);
  const linked = new Set(requirement.cases.map((c) => c.testCase.id));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (caseIds.length === 0) {
      setError('Select at least one case to link.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post(`/projects/${projectId}/requirements/${requirement.id}/cases`, { testCaseIds: caseIds });
      setCaseIds([]);
      onLinked();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't link the cases");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="dialog-body" onSubmit={onSubmit}>
      {cases.data && suites.data ? (
        <CaseChecklist
          cases={cases.data.filter((c) => !linked.has(c.id))}
          suites={suites.data}
          selected={caseIds}
          onChange={setCaseIds}
        />
      ) : (
        <Loading label="Loading cases…" />
      )}
      <FormError message={error} />
      <div className="dialog-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>Link selected cases</button>
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
  const reqRes = useResource(() => api.get<Requirement[]>(`/projects/${projectId}/requirements`), [projectId]);
  const coverageRes = useResource(
    () => api.get<CoverageRow[]>(`/projects/${projectId}/requirements/coverage`),
    [projectId],
  );
  const coverageById = new Map((coverageRes.data ?? []).map((row) => [row.requirementId, row]));
  const requirements = reqRes.data;
  const untested = requirements?.filter((r) => r.cases.length === 0).length ?? 0;

  function reload() {
    reqRes.reload();
    coverageRes.reload();
  }

  const createButton = editRepository ? (
    <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
      <Plus size={16} aria-hidden="true" />
      New requirement
    </button>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Requirements"
        description={
          requirements && requirements.length > 0
            ? untested > 0
              ? `${plural(requirements.length, 'requirement')}; ${untested} not linked to any case yet.`
              : `${plural(requirements.length, 'requirement')}; all covered by at least one case.`
            : 'Link requirements to cases to see coverage and latest results here.'
        }
        actions={createButton}
      />
      {reqRes.error && <LoadError message={reqRes.error} onRetry={reload} />}
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
                return (
                  <tr key={r.id}>
                    <td>
                      <span className="cell-title">{r.title}</span>
                      {r.externalRef && <span className="ref"> {r.externalRef}</span>}
                      {r.cases.length > 0 ? (
                        <p className="cell-sub">
                          {shown.map((c) => c.testCase.title).join(', ')}
                          {r.cases.length > shown.length && ` and ${r.cases.length - shown.length} more`}
                        </p>
                      ) : (
                        <p className="cell-sub">No linked cases.</p>
                      )}
                    </td>
                    <td className="col-ribbon">
                      {r.cases.length === 0 ? (
                        <Tag tone="outline">No coverage</Tag>
                      ) : (
                        <div className="ribbon-cell-wrap">
                          <ResultRibbon counts={coverageCounts(coverage)} size="sm" label={r.title} />
                          <span className="ribbon-fraction num">{plural(r.cases.length, 'case')}</span>
                        </div>
                      )}
                    </td>
                    {editRepository && (
                    <td className="cell-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setLinking(r)}
                        aria-label={`Link cases to ${r.title}`}
                      >
                        <Link2 size={14} aria-hidden="true" />
                        Link cases
                      </button>
                    </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <CreateRequirementDialog
        projectId={projectId}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          reload();
        }}
      />
      <LinkCasesDialog
        projectId={projectId}
        requirement={linking}
        onClose={() => setLinking(null)}
        onLinked={() => {
          setLinking(null);
          reload();
        }}
      />
    </>
  );
}
