import { useId, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Archive, ArchiveRestore, Link2, ListChecks, Pencil, Plus } from 'lucide-react';
import { api } from '../../api/client';
import { ArchivedToggle } from '../../components/ArchivedToggle';
import { CaseChecklist, type ChecklistCase } from '../../components/CaseChecklist';
import { Dialog } from '../../components/Dialog';
import { ConfirmDialog } from '../../components/Members';
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
  archivedAt: string | null;
  cases: { testCase: { id: string; title: string } }[];
}

interface CoverageRow {
  requirementId: string;
  caseCount: number;
  hasCoverage: boolean;
  lastResultStatusBreakdown: Record<string, number>;
}

/** Linked cases that were never run count as "untested"; the ribbon shows the full coverage. */
function coverageCounts(row: CoverageRow | undefined) {
  const counts = normalizeCounts(row?.lastResultStatusBreakdown);
  const executed = Object.values(counts).reduce((a, b) => a + b, 0);
  counts.UNTESTED += Math.max(0, (row?.caseCount ?? 0) - executed);
  return counts;
}

// The form mounts only while the dialog is open: state starts clean on every open, and
// the data the form needs is requested when the dialog opens, not when the page loads.
function RequirementDialog({ open, ...props }: Parameters<typeof RequirementForm>[0] & { open: boolean }) {
  return (
    <Dialog open={open} onClose={props.onClose} title={props.requirement ? 'Edit requirement' : 'New requirement'}>
      <RequirementForm {...props} />
    </Dialog>
  );
}

/** Creates a requirement, or saves changes to `requirement` when given. */
function RequirementForm({
  projectId,
  requirement,
  onClose,
  onSaved,
}: {
  projectId: string;
  requirement?: Requirement;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(requirement?.title ?? '');
  const [description, setDescription] = useState(requirement?.description ?? '');
  const [externalRef, setExternalRef] = useState(requirement?.externalRef ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = { title: useId(), description: useId(), ref: useId(), refHint: useId() };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (requirement) {
        // Emptied fields are cleared.
        await api.patch(`/projects/${projectId}/requirements/${requirement.id}`, {
          title,
          description: description.trim() || null,
          externalRef: externalRef.trim() || null,
        });
      } else {
        await api.post(`/projects/${projectId}/requirements`, {
          title,
          description: description.trim() || undefined,
          externalRef: externalRef.trim() || undefined,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the requirement");
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
        <button type="submit" className="btn btn-primary" disabled={saving}>{requirement ? 'Save changes' : 'Create requirement'}</button>
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
      title="Linked cases"
      description={requirement ? `Choose the cases that cover "${requirement.title}"; clear a case to unlink it.` : undefined}
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
  const linked = requirement.cases.map((c) => c.testCase.id);
  const [caseIds, setCaseIds] = useState<string[]>(linked);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const cases = useResource(() => api.get<ChecklistCase[]>(`/projects/${projectId}/cases`), [projectId]);
  const suites = useResource(() => api.get<Suite[]>(`/projects/${projectId}/suites`), [projectId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const added = caseIds.filter((id) => !linked.includes(id));
    const removed = linked.filter((id) => !caseIds.includes(id));
    setSaving(true);
    setError(null);
    try {
      const base = `/projects/${projectId}/requirements/${requirement.id}/cases`;
      if (added.length > 0) await api.post(base, { testCaseIds: added });
      for (const id of removed) await api.delete(`${base}/${id}`);
      onLinked();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the links");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="dialog-body" onSubmit={onSubmit}>
      {cases.data && suites.data ? (
        <CaseChecklist
          cases={cases.data}
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
        <button type="submit" className="btn btn-primary" disabled={saving}>Save links</button>
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
  const [editing, setEditing] = useState<Requirement | null>(null);
  const [archiving, setArchiving] = useState<Requirement | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const reqRes = useResource(
    () => api.get<Requirement[]>(`/projects/${projectId}/requirements${showArchived ? '?includeArchived=true' : ''}`),
    [projectId, showArchived],
  );
  const coverageRes = useResource(
    () => api.get<CoverageRow[]>(`/projects/${projectId}/requirements/coverage`),
    [projectId],
  );
  const coverageById = new Map((coverageRes.data ?? []).map((row) => [row.requirementId, row]));
  const requirements = reqRes.data;
  const untested = requirements?.filter((r) => !r.archivedAt && r.cases.length === 0).length ?? 0;
  const active = requirements?.filter((r) => !r.archivedAt).length ?? 0;

  function reload() {
    reqRes.reload();
    coverageRes.reload();
  }

  async function restore(r: Requirement) {
    setActionError(null);
    try {
      await api.post(`/projects/${projectId}/requirements/${r.id}/restore`);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't restore the requirement");
    }
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
          active > 0
            ? untested > 0
              ? `${plural(active, 'requirement')}; ${untested} not linked to any case yet.`
              : `${plural(active, 'requirement')}; all covered by at least one case.`
            : 'Link requirements to cases to see coverage and latest results here.'
        }
        actions={
          <>
            <ArchivedToggle checked={showArchived} onChange={setShowArchived} />
            {createButton}
          </>
        }
      />
      {reqRes.error && <LoadError message={reqRes.error} onRetry={reload} />}
      {actionError && <p className="form-error" role="alert">{actionError}</p>}
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
                      {r.archivedAt && <> <Tag tone="outline">Archived</Tag></>}
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
                        aria-label={`Linked cases of ${r.title}`}
                      >
                        <Link2 size={14} aria-hidden="true" />
                        Cases
                      </button>
                      <button type="button" className="icon-button" onClick={() => setEditing(r)} aria-label={`Edit ${r.title}`} title="Edit">
                        <Pencil size={16} aria-hidden="true" />
                      </button>
                      {r.archivedAt ? (
                        <button type="button" className="icon-button" onClick={() => restore(r)} aria-label={`Restore ${r.title}`} title="Restore">
                          <ArchiveRestore size={16} aria-hidden="true" />
                        </button>
                      ) : (
                        <button type="button" className="icon-button" onClick={() => setArchiving(r)} aria-label={`Archive ${r.title}`} title="Archive">
                          <Archive size={16} aria-hidden="true" />
                        </button>
                      )}
                    </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <RequirementDialog
        projectId={projectId}
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          reload();
        }}
      />
      <RequirementDialog
        key={editing?.id ?? 'none'}
        projectId={projectId}
        requirement={editing ?? undefined}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reload();
        }}
      />
      <ConfirmDialog
        open={archiving !== null}
        title="Archive this requirement?"
        message={`"${archiving?.title ?? ''}" leaves the requirement list and coverage; its case links are kept. You can restore it with "Show archived".`}
        confirmLabel="Archive requirement"
        onConfirm={async () => {
          await api.delete(`/projects/${projectId}/requirements/${archiving!.id}`);
          setArchiving(null);
          reload();
        }}
        onClose={() => setArchiving(null)}
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
