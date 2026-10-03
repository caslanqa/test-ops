import { useId, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { foldForSearch } from '../lib/format';
import { buildSuiteTree, flattenTree, suitePath, type Suite } from '../lib/suites';

export interface ChecklistCase {
  id: string;
  title: string;
  suiteId: string | null;
}

interface CaseChecklistProps {
  cases: ChecklistCase[];
  suites: Suite[];
  selected: string[];
  onChange: (ids: string[]) => void;
  legend?: string;
}

/**
 * Shared case picker for the plan, run and requirement linking dialogs: checkboxes
 * grouped by suite, search, and selecting all visible cases.
 */
export function CaseChecklist({
  cases,
  suites,
  selected,
  onChange,
  legend = 'Test cases',
}: CaseChecklistProps) {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const selectedSet = new Set(selected);

  const groups = useMemo(() => {
    const needle = foldForSearch(query.trim());
    const visible = needle
      ? cases.filter((c) => foldForSearch(c.title).includes(needle))
      : cases;
    // Same order as the repository: suite tree order, then creation order within a suite
    // (the API returns the newest first); cases outside any suite come last.
    const order = new Map(flattenTree(buildSuiteTree(suites)).map((node, i) => [node.id, i]));
    const rank = (c: ChecklistCase) => (c.suiteId ? (order.get(c.suiteId) ?? Infinity) : Infinity);
    const bySuite = new Map<string | null, ChecklistCase[]>();
    for (const c of [...visible].reverse().sort((a, b) => rank(a) - rank(b))) {
      bySuite.set(c.suiteId, [...(bySuite.get(c.suiteId) ?? []), c]);
    }
    return [...bySuite.entries()].map(
      ([suiteId, list]) => [suitePath(suites, suiteId), list] as const,
    );
  }, [cases, suites, query]);

  const visibleIds = groups.flatMap(([, list]) => list.map((c) => c.id));
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id));

  function toggle(id: string) {
    onChange(selectedSet.has(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  function toggleVisible() {
    if (allVisibleSelected) {
      const visible = new Set(visibleIds);
      onChange(selected.filter((id) => !visible.has(id)));
    } else {
      onChange([...new Set([...selected, ...visibleIds])]);
    }
  }

  return (
    <fieldset className="checklist">
      <legend className="field-label">{legend}</legend>
      <div className="checklist-toolbar">
        <label htmlFor={searchId} className="search-field">
          <Search size={16} aria-hidden="true" />
          <span className="visually-hidden">Search cases</span>
          <input
            id={searchId}
            type="search"
            placeholder="Search titles"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={toggleVisible}
          disabled={visibleIds.length === 0}
        >
          {allVisibleSelected ? 'Deselect visible' : 'Select all visible'}
        </button>
        <span className="checklist-count num" aria-live="polite">
          {selected.length} selected
        </span>
      </div>
      <div className="checklist-body">
        {groups.length === 0 && (
          <p className="checklist-empty">
            {cases.length === 0
              ? 'This project has no test cases yet.'
              : 'No cases match your search.'}
          </p>
        )}
        {groups.map(([path, list]) => (
          <div key={path} className="checklist-group">
            <p className="checklist-group-name">{path}</p>
            {list.map((c) => (
              <label key={c.id} className="check-row">
                <input
                  type="checkbox"
                  checked={selectedSet.has(c.id)}
                  onChange={() => toggle(c.id)}
                />
                <span>{c.title}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </fieldset>
  );
}
