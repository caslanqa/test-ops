import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Inbox,
  Layers,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../../api/client';
import { Dialog } from '../../components/Dialog';
import { EmptyState, FormError, LoadError, Loading, PageHeader } from '../../components/Page';
import { PriorityMark } from '../../components/StatusChip';
import {
  AUTOMATION_LABEL,
  CASE_SEVERITY_LABEL,
  CASE_TYPE_LABEL,
  PRIORITY_LABEL,
  labelOf,
} from '../../lib/labels';
import { useProjectPermissions } from '../../lib/permissions';
import { useProjectInfo } from '../../lib/projectInfo';
import {
  buildSuiteTree,
  descendantIds,
  flattenTree,
  suitePath,
  type Suite,
  type SuiteNode,
} from '../../lib/suites';
import { foldForSearch, plural } from '../../lib/format';
import { usePageTitle, useResource } from '../../lib/useResource';

interface TestCaseStep {
  id: string;
  position: number;
  action: string;
  expectedResult: string | null;
}

interface TestCase {
  id: string;
  title: string;
  suiteId: string | null;
  priority: string;
  severity: string;
  type: string;
  automationStatus: string;
  preconditions: string | null;
  description: string | null;
  tags: string[];
  steps: TestCaseStep[];
}

/** Ağaçta seçili düğüm: tüm case'ler, suite dışı case'ler veya bir suite. */
type Selection = { kind: 'all' } | { kind: 'unsorted' } | { kind: 'suite'; id: string };

// ---------------------------------------------------------------------------
// Suite ağacı
// ---------------------------------------------------------------------------

function SuiteTreeItem({
  node,
  selection,
  onSelect,
  collapsed,
  onToggle,
  counts,
}: {
  node: SuiteNode;
  selection: Selection;
  onSelect: (s: Selection) => void;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  counts: Map<string, number>;
}) {
  const isSelected = selection.kind === 'suite' && selection.id === node.id;
  const hasChildren = node.children.length > 0;
  const isOpen = hasChildren && !collapsed.has(node.id);
  const FolderIcon = isOpen ? FolderOpen : Folder;

  return (
    <li>
      <div
        className={`tree-row${isSelected ? ' is-selected' : ''}`}
        style={{ paddingInlineStart: `${0.5 + node.depth * 1}rem` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="tree-toggle"
            aria-expanded={isOpen}
            aria-label={`${node.name} child suites`}
            onClick={() => onToggle(node.id)}
          >
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        ) : (
          <span className="tree-toggle-spacer" aria-hidden="true" />
        )}
        <button
          type="button"
          className="tree-label"
          aria-current={isSelected ? 'true' : undefined}
          onClick={() => onSelect({ kind: 'suite', id: node.id })}
        >
          <FolderIcon size={16} aria-hidden="true" />
          <span className="truncate">{node.name}</span>
          <span className="tree-count num">{counts.get(node.id) ?? 0}</span>
        </button>
      </div>
      {isOpen && (
        <ul>
          {node.children.map((child) => (
            <SuiteTreeItem
              key={child.id}
              node={child}
              selection={selection}
              onSelect={onSelect}
              collapsed={collapsed}
              onToggle={onToggle}
              counts={counts}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Case detay paneli
// ---------------------------------------------------------------------------

function CaseDetail({
  testCase,
  suites,
  onClose,
}: {
  testCase: TestCase;
  suites: Suite[];
  onClose: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  // Panel açılınca klavye kullanıcısı içeriğe taşınır.
  useEffect(() => {
    headingRef.current?.focus();
  }, [testCase.id]);

  const steps = [...testCase.steps].sort((a, b) => a.position - b.position);

  return (
    <aside className="repo-detail" aria-labelledby={headingId}>
      <div className="detail-header">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="detail-title">
          {testCase.title}
        </h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close details">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <p className="detail-path">{suitePath(suites, testCase.suiteId)}</p>

      <dl className="props">
        <div>
          <dt>Priority</dt>
          <dd><PriorityMark priority={testCase.priority} /></dd>
        </div>
        <div>
          <dt>Severity</dt>
          <dd>{labelOf(CASE_SEVERITY_LABEL, testCase.severity)}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{labelOf(CASE_TYPE_LABEL, testCase.type)}</dd>
        </div>
        <div>
          <dt>Automation</dt>
          <dd>{labelOf(AUTOMATION_LABEL, testCase.automationStatus)}</dd>
        </div>
      </dl>

      {testCase.tags.length > 0 && (
        <ul className="tag-list" aria-label="Tags">
          {testCase.tags.map((t) => (
            <li key={t} className="tag tag--outline">{t}</li>
          ))}
        </ul>
      )}

      {testCase.description && (
        <section className="detail-section">
          <h3>Description</h3>
          <p className="prose">{testCase.description}</p>
        </section>
      )}
      <section className="detail-section">
        <h3>Preconditions</h3>
        <p className={testCase.preconditions ? 'prose' : 'muted'}>
          {testCase.preconditions ?? 'No preconditions.'}
        </p>
      </section>
      <section className="detail-section">
        <h3>Steps</h3>
        {steps.length === 0 ? (
          <p className="muted">This case has no steps.</p>
        ) : (
          <ol className="steps">
            {steps.map((step) => (
              <li key={step.id} className="step">
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

// ---------------------------------------------------------------------------
// Dialoglar
// ---------------------------------------------------------------------------

function SuiteSelect({
  id,
  suites,
  value,
  onChange,
  emptyLabel,
}: {
  id: string;
  suites: Suite[];
  value: string;
  onChange: (value: string) => void;
  emptyLabel: string;
}) {
  const options = flattenTree(buildSuiteTree(suites));
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel}</option>
      {options.map((s) => (
        <option key={s.id} value={s.id}>
          {' '.repeat(s.depth)}
          {s.name}
        </option>
      ))}
    </select>
  );
}

// Form yalnızca dialog açıkken mount olur: her açılışta state temiz başlar ve
// form'un ihtiyaç duyduğu veriler sayfa açılırken değil, dialog açılınca istenir.
function CreateSuiteDialog({ open, ...props }: Parameters<typeof CreateSuiteForm>[0] & { open: boolean }) {
  return (
    <Dialog open={open} onClose={props.onClose} title="New suite">
      <CreateSuiteForm {...props} />
    </Dialog>
  );
}

function CreateSuiteForm({
  projectId,
  suites,
  defaultParentId,
  onClose,
  onCreated,
}: {
  projectId: string;
  suites: Suite[];
  defaultParentId: string;
  onClose: () => void;
  onCreated: (suite: Suite) => void;
}) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState(defaultParentId);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameId = useId();
  const parentFieldId = useId();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const suite = await api.post<Suite>(`/projects/${projectId}/suites`, {
        name,
        parentId: parentId || undefined,
      });
      onCreated(suite);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the suite");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="dialog-body" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor={nameId} className="field-label">Name</label>
        <input id={nameId} value={name} maxLength={150} required onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={parentFieldId} className="field-label">Parent suite</label>
        <SuiteSelect id={parentFieldId} suites={suites} value={parentId} onChange={setParentId} emptyLabel="None (top level)" />
      </div>
      <FormError message={error} />
      <div className="dialog-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>Create suite</button>
      </div>
    </form>
  );
}

interface StepDraft {
  key: number;
  action: string;
  expectedResult: string;
}

// Form yalnızca dialog açıkken mount olur: her açılışta state temiz başlar ve
// form'un ihtiyaç duyduğu veriler sayfa açılırken değil, dialog açılınca istenir.
function CreateCaseDialog({ open, ...props }: Parameters<typeof CreateCaseForm>[0] & { open: boolean }) {
  return (
    <Dialog open={open} onClose={props.onClose} title="New test case" wide>
      <CreateCaseForm {...props} />
    </Dialog>
  );
}

function CreateCaseForm({
  projectId,
  suites,
  defaultSuiteId,
  onClose,
  onCreated,
}: {
  projectId: string;
  suites: Suite[];
  defaultSuiteId: string;
  onClose: () => void;
  onCreated: (testCase: TestCase) => void;
}) {
  const [title, setTitle] = useState('');
  const [suiteId, setSuiteId] = useState(defaultSuiteId);
  const [priority, setPriority] = useState('MEDIUM');
  const [severity, setSeverity] = useState('NORMAL');
  const [type, setType] = useState('FUNCTIONAL');
  const [automationStatus, setAutomationStatus] = useState('MANUAL');
  const [preconditions, setPreconditions] = useState('');
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nextKey = useRef(0);
  const ids = {
    title: useId(),
    suite: useId(),
    priority: useId(),
    severity: useId(),
    type: useId(),
    automation: useId(),
    preconditions: useId(),
  };

  function addStep() {
    nextKey.current += 1;
    setSteps((prev) => [...prev, { key: nextKey.current, action: '', expectedResult: '' }]);
  }

  function updateStep(key: number, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await api.post<TestCase>(`/projects/${projectId}/cases`, {
        title,
        suiteId: suiteId || undefined,
        priority,
        severity,
        type,
        automationStatus,
        preconditions: preconditions.trim() || undefined,
        steps: steps
          .filter((s) => s.action.trim())
          .map((s) => ({
            action: s.action.trim(),
            expectedResult: s.expectedResult.trim() || undefined,
          })),
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the test case");
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
          <label htmlFor={ids.suite} className="field-label">Suite</label>
          <SuiteSelect id={ids.suite} suites={suites} value={suiteId} onChange={setSuiteId} emptyLabel="No suite" />
        </div>
        <div className="field">
          <label htmlFor={ids.priority} className="field-label">Priority</label>
          <select id={ids.priority} value={priority} onChange={(e) => setPriority(e.target.value)}>
            {Object.entries(PRIORITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.severity} className="field-label">Severity</label>
          <select id={ids.severity} value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {Object.entries(CASE_SEVERITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.type} className="field-label">Type</label>
          <select id={ids.type} value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(CASE_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.automation} className="field-label">Automation</label>
          <select id={ids.automation} value={automationStatus} onChange={(e) => setAutomationStatus(e.target.value)}>
            {Object.entries(AUTOMATION_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor={ids.preconditions} className="field-label">Preconditions</label>
        <textarea id={ids.preconditions} rows={2} value={preconditions} onChange={(e) => setPreconditions(e.target.value)} />
      </div>

      <fieldset className="steps-editor">
        <legend className="field-label">Steps</legend>
        {steps.length === 0 && <p className="muted">You can save without adding steps.</p>}
        <ol>
          {steps.map((step, index) => (
            <li key={step.key} className="step-draft">
              <span className="step-draft-number num" aria-hidden="true">{index + 1}</span>
              <label className="visually-hidden" htmlFor={`step-${step.key}-action`}>
                Step {index + 1} action
              </label>
              <input
                id={`step-${step.key}-action`}
                placeholder="Action"
                value={step.action}
                onChange={(e) => updateStep(step.key, { action: e.target.value })}
              />
              <label className="visually-hidden" htmlFor={`step-${step.key}-expected`}>
                Step {index + 1} expected result
              </label>
              <input
                id={`step-${step.key}-expected`}
                placeholder="Expected result"
                value={step.expectedResult}
                onChange={(e) => updateStep(step.key, { expectedResult: e.target.value })}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove step ${index + 1}`}
                onClick={() => setSteps((prev) => prev.filter((s) => s.key !== step.key))}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
        <button type="button" className="btn btn-ghost btn-sm" onClick={addStep}>
          <Plus size={16} aria-hidden="true" />
          Add step
        </button>
      </fieldset>

      <FormError message={error} />
      <div className="dialog-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>Create test case</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Sayfa
// ---------------------------------------------------------------------------

export function SuitesCasesPage() {
  const { projectId = '' } = useParams();
  const { data: info } = useProjectInfo(projectId);
  const { editRepository } = useProjectPermissions(projectId);
  usePageTitle(info ? `Test cases (${info.project.name})` : 'Test cases');

  const suitesRes = useResource(() => api.get<Suite[]>(`/projects/${projectId}/suites`), [projectId]);
  const casesRes = useResource(() => api.get<TestCase[]>(`/projects/${projectId}/cases`), [projectId]);
  const suites = useMemo(() => suitesRes.data ?? [], [suitesRes.data]);
  const cases = useMemo(() => casesRes.data ?? [], [casesRes.data]);

  const [selection, setSelection] = useState<Selection>({ kind: 'all' });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'suite' | 'case' | null>(null);
  const searchId = useId();
  const listHeadingId = useId();

  const tree = useMemo(() => buildSuiteTree(suites), [suites]);
  const nodesById = useMemo(
    () => new Map(flattenTree(tree).map((n) => [n.id, n])),
    [tree],
  );

  // Suite başına (alt suite'ler dahil) case sayısı.
  const counts = useMemo(() => {
    const direct = new Map<string, number>();
    for (const c of cases) if (c.suiteId) direct.set(c.suiteId, (direct.get(c.suiteId) ?? 0) + 1);
    const total = new Map<string, number>();
    const sum = (node: SuiteNode): number => {
      const value = (direct.get(node.id) ?? 0) + node.children.reduce((acc, ch) => acc + sum(ch), 0);
      total.set(node.id, value);
      return value;
    };
    tree.forEach(sum);
    return total;
  }, [cases, tree]);
  const unsortedCount = cases.filter((c) => !c.suiteId).length;

  const visibleCases = useMemo(() => {
    let list = cases;
    if (selection.kind === 'unsorted') list = list.filter((c) => !c.suiteId);
    if (selection.kind === 'suite') {
      const node = nodesById.get(selection.id);
      const ids = node ? descendantIds(node) : new Set<string>();
      list = list.filter((c) => c.suiteId && ids.has(c.suiteId));
    }
    const needle = foldForSearch(query.trim());
    if (needle) list = list.filter((c) => foldForSearch(c.title).includes(needle));
    return list;
  }, [cases, selection, nodesById, query]);

  // Qase'teki gibi case'ler suite ağacı sırasıyla, suite başlıkları altında listelenir;
  // aynı suite içinde oluşturulma sırası korunur (API en yeniyi önce döndürür).
  const groups = useMemo(() => {
    const order = new Map(flattenTree(tree).map((node, i) => [node.id, i]));
    const rank = (c: TestCase) => (c.suiteId ? (order.get(c.suiteId) ?? Infinity) : Infinity);
    const sorted = [...visibleCases].reverse().sort((a, b) => rank(a) - rank(b));
    const result: { suiteId: string | null; cases: TestCase[] }[] = [];
    for (const c of sorted) {
      const last = result[result.length - 1];
      if (last && last.suiteId === c.suiteId) last.cases.push(c);
      else result.push({ suiteId: c.suiteId, cases: [c] });
    }
    return result;
  }, [visibleCases, tree]);
  const showGroupHeaders =
    groups.length > 1 || (groups.length === 1 && selection.kind === 'all');

  const openCase = cases.find((c) => c.id === openCaseId) ?? null;
  const selectedSuiteId = selection.kind === 'suite' ? selection.id : '';
  const listTitle =
    selection.kind === 'all'
      ? "All cases"
      : selection.kind === 'unsorted'
        ? 'No suite'
        : suitePath(suites, selection.id);

  function closeDetail() {
    const id = openCaseId;
    setOpenCaseId(null);
    // Odağı paneli açan satıra geri ver (a11y K7).
    if (id) requestAnimationFrame(() => document.getElementById(`case-${id}`)?.focus());
  }

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const loadError = suitesRes.error ?? casesRes.error;

  return (
    <>
      <PageHeader
        title="Test cases"
        description={
          casesRes.data && suitesRes.data
            ? `${plural(cases.length, 'case')}, ${plural(suites.length, 'suite')}`
            : undefined
        }
        actions={
          editRepository && (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setDialog('suite')}>
              <FolderPlus size={16} aria-hidden="true" />
              New suite
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setDialog('case')}>
              <Plus size={16} aria-hidden="true" />
              New test case
            </button>
          </>
          )
        }
      />
      {loadError && (
        <LoadError
          message={loadError}
          onRetry={() => {
            suitesRes.reload();
            casesRes.reload();
          }}
        />
      )}
      {(suitesRes.loading || casesRes.loading) && <Loading />}

      {suitesRes.data && casesRes.data && (
        <div className={`repo surface${openCase ? ' repo--with-detail' : ''}`}>
          <nav className="repo-tree" aria-label="Suites">
            <ul className="tree">
              <li>
                <div className={`tree-row${selection.kind === 'all' ? ' is-selected' : ''}`}>
                  <span className="tree-toggle-spacer" aria-hidden="true" />
                  <button
                    type="button"
                    className="tree-label"
                    aria-current={selection.kind === 'all' ? 'true' : undefined}
                    onClick={() => setSelection({ kind: 'all' })}
                  >
                    <Layers size={16} aria-hidden="true" />
                    <span className="truncate">All cases</span>
                    <span className="tree-count num">{cases.length}</span>
                  </button>
                </div>
              </li>
              {tree.map((node) => (
                <SuiteTreeItem
                  key={node.id}
                  node={node}
                  selection={selection}
                  onSelect={setSelection}
                  collapsed={collapsed}
                  onToggle={toggle}
                  counts={counts}
                />
              ))}
              {unsortedCount > 0 && (
                <li>
                  <div className={`tree-row${selection.kind === 'unsorted' ? ' is-selected' : ''}`}>
                    <span className="tree-toggle-spacer" aria-hidden="true" />
                    <button
                      type="button"
                      className="tree-label"
                      aria-current={selection.kind === 'unsorted' ? 'true' : undefined}
                      onClick={() => setSelection({ kind: 'unsorted' })}
                    >
                      <Inbox size={16} aria-hidden="true" />
                      <span className="truncate">No suite</span>
                      <span className="tree-count num">{unsortedCount}</span>
                    </button>
                  </div>
                </li>
              )}
            </ul>
          </nav>

          <section className="repo-list" aria-labelledby={listHeadingId}>
            <div className="list-toolbar">
              <h2 id={listHeadingId} className="list-title truncate">{listTitle}</h2>
              <label htmlFor={searchId} className="search-field">
                <Search size={16} aria-hidden="true" />
                <span className="visually-hidden">Search this list</span>
                <input
                  id={searchId}
                  type="search"
                  placeholder="Search titles"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            </div>
            {visibleCases.length === 0 ? (
              cases.length === 0 ? (
                <EmptyState
                  icon={FolderPlus}
                  title="No test cases yet"
                  action={
                    editRepository && (
                      <button type="button" className="btn btn-primary" onClick={() => setDialog('case')}>
                        <Plus size={16} aria-hidden="true" />
                        New test case
                      </button>
                    )
                  }
                >
                  Organize cases into suites; plans and runs are built from these cases.
                </EmptyState>
              ) : (
                <EmptyState icon={Search} title="No cases in this view">
                  {query ? 'Change or clear your search.' : 'Pick another suite or add a case to this one.'}
                </EmptyState>
              )
            ) : (
              <div className="table-wrap">
                <table className="data-table data-table--interactive">
                  <caption className="visually-hidden">{listTitle}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="col-main">Title</th>
                      <th scope="col">Priority</th>
                      <th scope="col" className="hide-sm col-optional">Type</th>
                      <th scope="col" className="hide-sm col-optional">Automation</th>
                    </tr>
                  </thead>
                  {groups.map((group) => (
                    <tbody key={group.suiteId ?? 'unsorted'}>
                      {showGroupHeaders && (
                        <tr className="group-row">
                          <th scope="colgroup" colSpan={4}>{suitePath(suites, group.suiteId)}</th>
                        </tr>
                      )}
                      {group.cases.map((c) => (
                        <tr key={c.id} className={c.id === openCaseId ? 'is-selected' : undefined}>
                          <td>
                            <button
                              type="button"
                              id={`case-${c.id}`}
                              className="row-button"
                              aria-expanded={c.id === openCaseId}
                              onClick={() => setOpenCaseId(c.id === openCaseId ? null : c.id)}
                            >
                              {c.title}
                            </button>
                          </td>
                          <td><PriorityMark priority={c.priority} /></td>
                          <td className="hide-sm col-optional">{labelOf(CASE_TYPE_LABEL, c.type)}</td>
                          <td className="hide-sm col-optional">{labelOf(AUTOMATION_LABEL, c.automationStatus)}</td>
                        </tr>
                      ))}
                    </tbody>
                  ))}
                </table>
              </div>
            )}
          </section>

          {openCase && <CaseDetail testCase={openCase} suites={suites} onClose={closeDetail} />}
        </div>
      )}

      <CreateSuiteDialog
        projectId={projectId}
        suites={suites}
        defaultParentId=""
        open={dialog === 'suite'}
        onClose={() => setDialog(null)}
        onCreated={(suite) => {
          setDialog(null);
          suitesRes.reload();
          setSelection({ kind: 'suite', id: suite.id });
        }}
      />
      <CreateCaseDialog
        projectId={projectId}
        suites={suites}
        defaultSuiteId={selectedSuiteId}
        open={dialog === 'case'}
        onClose={() => setDialog(null)}
        onCreated={(created) => {
          setDialog(null);
          casesRes.reload();
          setOpenCaseId(created.id);
        }}
      />
    </>
  );
}
