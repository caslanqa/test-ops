import { useId } from 'react';
import type { AppliedGuidance, RunGuidanceChoice } from '../lib/guidance';

/**
 * Which of the team's guidance a run is sent: what applies to the project (the default), none, or named
 * guidance among what applies. The choice is made before the run starts and the run keeps it.
 */
export function GuidanceChoice({
  items,
  value,
  onChange,
  legend = 'Guidance for this draft',
}: {
  items: AppliedGuidance[];
  value: RunGuidanceChoice;
  onChange: (next: RunGuidanceChoice) => void;
  /** Names the group; a comparison has two of them, so each says which side it is. */
  legend?: string;
}) {
  const name = useId();
  const chosen = value.mode === 'LIST' ? value.ids : [];
  const toggle = (ref: string, on: boolean) => onChange({ mode: 'LIST', ids: on ? [...chosen, ref] : chosen.filter((id) => id !== ref) });
  return (
    <fieldset className="guidance-steps">
      <legend className="field-label">{legend}</legend>
      <div className="checkbox-field">
        <input id={`${name}-effective`} type="radio" name={name} checked={value.mode === 'EFFECTIVE'} onChange={() => onChange({ mode: 'EFFECTIVE' })} />
        <label htmlFor={`${name}-effective`}>Use the project’s guidance ({items.length})</label>
      </div>
      <div className="checkbox-field">
        <input id={`${name}-none`} type="radio" name={name} checked={value.mode === 'NONE'} onChange={() => onChange({ mode: 'NONE' })} />
        <label htmlFor={`${name}-none`}>Without guidance</label>
      </div>
      <div className="checkbox-field">
        <input id={`${name}-list`} type="radio" name={name} checked={value.mode === 'LIST'} onChange={() => onChange({ mode: 'LIST', ids: items.map((item) => item.ref) })} />
        <label htmlFor={`${name}-list`}>Choose…</label>
      </div>
      {value.mode === 'LIST' && (
        <div role="group" aria-label="Guidance to use" className="guidance-choose">
          {items.map((item) => (
            <div className="checkbox-field" key={item.ref}>
              <input id={`${name}-${item.ref}`} type="checkbox" checked={chosen.includes(item.ref)} onChange={(e) => toggle(item.ref, e.target.checked)} />
              <label htmlFor={`${name}-${item.ref}`}>{item.title}</label>
            </div>
          ))}
          {chosen.length === 0 && <p className="field-hint">Nothing chosen: the draft is made without guidance.</p>}
        </div>
      )}
    </fieldset>
  );
}
