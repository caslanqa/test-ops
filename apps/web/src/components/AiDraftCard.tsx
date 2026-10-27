import { useId } from 'react';
import { Trash2, X } from 'lucide-react';
import { Select } from './Select';
import { Tag } from './StatusChip';
import { CASE_TYPE_LABEL, PRIORITY_LABEL } from '../lib/labels';
import type { CaseDraft, DraftStep } from '../lib/ai';

/**
 * One draft test case, to edit before it is approved. Every field's label starts, out of sight, with the
 * draft's number, so a screen reader hears "Draft 2 Title" and not just "Title" twenty times over.
 */
export function AiDraftCard({
  index,
  draft,
  readOnly = false,
  onChange,
  onDelete,
}: {
  index: number;
  draft: CaseDraft;
  /** For people who may read a draft but not change it: read-only fields (still reachable and scrollable by keyboard), nothing to delete. */
  readOnly?: boolean;
  onChange: (draft: CaseDraft) => void;
  onDelete: () => void;
}) {
  const n = index + 1;
  const ids = { title: useId(), pre: useId(), priority: useId(), type: useId() };
  const steps = draft.steps ?? [];
  const setStep = (at: number, step: DraftStep) => onChange({ ...draft, steps: steps.map((s, i) => (i === at ? step : s)) });
  const prefix = <span className="visually-hidden">Draft {n} </span>;

  return (
    <li className="surface ai-draft">
      <div className="ai-draft-head">
        <h3 className="section-title">Draft {n}</h3>
        <Tag tone="outline">{draft.kind}</Tag>
        {!readOnly && (
          <button type="button" className="icon-button" aria-label={`Delete draft ${n}`} title="Delete this draft" onClick={onDelete}>
            <Trash2 size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="field">
        <label htmlFor={ids.title} className="field-label">{prefix}Title</label>
        <input id={ids.title} required readOnly={readOnly} maxLength={300} value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor={ids.pre} className="field-label">{prefix}Preconditions</label>
        <textarea id={ids.pre} rows={2} readOnly={readOnly} maxLength={2000} value={draft.preconditions ?? ''} onChange={(e) => onChange({ ...draft, preconditions: e.target.value })} />
      </div>
      <div className="ai-draft-selects">
        <div className="field">
          <label htmlFor={ids.priority} className="field-label">{prefix}Priority</label>
          {readOnly ? (
            <input id={ids.priority} readOnly value={PRIORITY_LABEL[(draft.priority ?? 'MEDIUM') as keyof typeof PRIORITY_LABEL] ?? draft.priority} />
          ) : (
            <Select id={ids.priority} value={draft.priority ?? 'MEDIUM'} onChange={(e) => onChange({ ...draft, priority: e.target.value })}>
              {Object.entries(PRIORITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          )}
        </div>
        <div className="field">
          <label htmlFor={ids.type} className="field-label">{prefix}Type</label>
          {readOnly ? (
            <input id={ids.type} readOnly value={CASE_TYPE_LABEL[(draft.type ?? 'FUNCTIONAL') as keyof typeof CASE_TYPE_LABEL] ?? draft.type} />
          ) : (
            <Select id={ids.type} value={draft.type ?? 'FUNCTIONAL'} onChange={(e) => onChange({ ...draft, type: e.target.value })}>
              {Object.entries(CASE_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          )}
        </div>
      </div>
      <ol className="ai-draft-steps" aria-label={`Steps of draft ${n}`}>
        {steps.map((step, s) => (
          <li key={s}>
            <div className="field">
              <label className="field-label">
                {prefix}Step {s + 1} action
                <textarea required readOnly={readOnly} rows={2} maxLength={1000} value={step.action} onChange={(e) => setStep(s, { ...step, action: e.target.value })} />
              </label>
            </div>
            <div className="field">
              <label className="field-label">
                {prefix}Step {s + 1} expected result
                <input readOnly={readOnly} maxLength={1000} value={step.expectedResult ?? ''} onChange={(e) => setStep(s, { ...step, expectedResult: e.target.value })} />
              </label>
            </div>
            {!readOnly && steps.length > 1 && (
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove step ${s + 1} of draft ${n}`}
                title="Remove this step"
                onClick={() => onChange({ ...draft, steps: steps.filter((_, i) => i !== s) })}
              >
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ol>
    </li>
  );
}
