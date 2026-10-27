import { useId, useState } from 'react';
import { Eye } from 'lucide-react';
import { api } from '../api/client';
import { GUIDANCE_STEP_LABEL, type GuidanceAnswer, type GuidanceList, type GuidanceStep } from '../lib/guidance';
import { FormError } from './Page';
import { Select } from './Select';

type Selection = 'EFFECTIVE' | 'NONE' | 'LIST';

/**
 * "What the model will see": the guidance one step of the project would be sent, within the token budget, and the
 * exact block added to its prompt. Project admins only: it can also show guidance that is switched off.
 */
export function GuidancePreview({ projectId, list }: { projectId: string; list: GuidanceList }) {
  const ids = { step: useId(), selection: useId(), legend: useId() };
  const [step, setStep] = useState<GuidanceStep>('DESIGN');
  const [selection, setSelection] = useState<Selection>('EFFECTIVE');
  const [chosen, setChosen] = useState<string[]>([]);
  const [answer, setAnswer] = useState<{ json: GuidanceAnswer; prompt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices = [...list.own, ...(list.inherited ?? [])];

  async function show() {
    setBusy(true);
    setError(null);
    const query = `step=${step}&selection=${selection}${selection === 'LIST' ? `&ids=${chosen.join(',')}` : ''}`;
    const base = `/projects/${projectId}/ai/guidance/preview?${query}`;
    try {
      const [json, prompt] = await Promise.all([api.get<GuidanceAnswer>(base), api.getText(`${base}&format=prompt`)]);
      setAnswer({ json, prompt });
    } catch (err) {
      setAnswer(null);
      setError(err instanceof Error ? err.message : "Couldn't show what the model would see");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface integrations-section" aria-labelledby={ids.legend}>
      <h2 id={ids.legend} className="section-title">What the model will see</h2>
      <p className="muted">
        The guidance one step of a run would be sent for this project, within the token budget of its AI setting, and the exact text added to
        the step&rsquo;s prompt.
      </p>
      <div className="integrations-form">
        <div className="field">
          <label htmlFor={ids.step} className="field-label">Step</label>
          <Select id={ids.step} value={step} onChange={(e) => setStep(e.target.value as GuidanceStep)}>
            {(Object.keys(GUIDANCE_STEP_LABEL) as GuidanceStep[]).map((value) => (
              <option key={value} value={value}>{GUIDANCE_STEP_LABEL[value]}</option>
            ))}
          </Select>
        </div>
        <div className="field">
          <label htmlFor={ids.selection} className="field-label">Guidance</label>
          <Select id={ids.selection} value={selection} onChange={(e) => setSelection(e.target.value as Selection)}>
            <option value="EFFECTIVE">What applies to the project</option>
            <option value="NONE">None</option>
            <option value="LIST">Guidance I choose…</option>
          </Select>
        </div>
        {selection === 'LIST' && (
          <div role="group" aria-label="Guidance to preview" className="guidance-choose">
            {choices.length === 0 && <p className="muted">There is no guidance to choose from yet.</p>}
            {choices.map((item) => (
              <div className="checkbox-field" key={item.id}>
                <input
                  id={`${ids.selection}-${item.id}`}
                  type="checkbox"
                  checked={chosen.includes(item.id)}
                  onChange={(e) => setChosen((current) => (e.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id)))}
                />
                <label htmlFor={`${ids.selection}-${item.id}`}>
                  {item.title} {item.enabled ? '' : '(off)'}
                </label>
              </div>
            ))}
          </div>
        )}
        <FormError message={error} />
        <div className="form-buttons">
          <button type="button" className="btn btn-secondary" disabled={busy || (selection === 'LIST' && chosen.length === 0)} onClick={show}>
            <Eye size={16} aria-hidden="true" />
            Show
          </button>
        </div>
      </div>
      {/* Always on the page, so a result that arrives is announced. */}
      <div role="status">
        {answer && (
          <>
            <p>
              <strong>{answer.json.usedTokens.toLocaleString('en')} tokens</strong> of guidance, {answer.json.budgetTokens === 0 ? 'with no limit' : `of a budget of ${answer.json.budgetTokens.toLocaleString('en')}`}.
            </p>
            {answer.json.used.length === 0 && <p className="muted">No guidance would be added to this step.</p>}
            {answer.json.used.length > 0 && (
              <ul className="guidance-list">
                {answer.json.used.map((item) => (
                  <li key={item.ref}>{item.title} <span className="muted">(version {item.version}, about {item.tokens} tokens)</span></li>
                ))}
              </ul>
            )}
            {answer.json.dropped.length > 0 && (
              <p className="muted">Left out for want of budget: {answer.json.dropped.map((item) => `${item.title} (${item.tokens} tokens)`).join(', ')}.</p>
            )}
          </>
        )}
      </div>
      {answer && answer.prompt !== '' && (
        <>
          <h3 className="section-title">The text added to the prompt</h3>
          <pre className="guidance-text">{answer.prompt}</pre>
        </>
      )}
    </section>
  );
}
