import { useId, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import {
  estimateGuidanceTokens,
  GUIDANCE_KIND_LABEL,
  GUIDANCE_LIMITS,
  GUIDANCE_STEP_LABEL,
  GUIDANCE_STEPS,
  type GuidanceKind,
  type GuidanceStep,
  type GuidanceView,
  type ImportPreview,
} from '../lib/guidance';
import { Dialog } from './Dialog';
import { FormError } from './Page';
import { Select } from './Select';

/** What the dialog edits: a guidance, or a file read for a new one. Neither: a blank one. */
export interface GuidanceDraftSource {
  guidance?: GuidanceView;
  preview?: ImportPreview;
}

/** The dialog that writes a guidance, edits one, or finishes one read from a markdown file. */
export function GuidanceDialog({
  base,
  source,
  onClose,
  onSaved,
}: {
  /** The guidance route of the workspace or project the guidance belongs to. */
  base: string;
  source: GuidanceDraftSource | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  return (
    <Dialog
      open={source !== null}
      onClose={onClose}
      wide
      title={source?.guidance ? 'Edit guidance' : source?.preview ? 'Add the guidance from this file' : 'New guidance'}
      description="Advice the assistant is given with every run it is asked for. Plain text: it is shown and sent as written."
    >
      {source && <GuidanceForm base={base} source={source} onClose={onClose} onSaved={onSaved} />}
    </Dialog>
  );
}

function GuidanceForm({
  base,
  source,
  onClose,
  onSaved,
}: {
  base: string;
  source: GuidanceDraftSource;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { guidance, preview } = source;
  const [title, setTitle] = useState(guidance?.title ?? preview?.title ?? '');
  const [summary, setSummary] = useState(guidance?.summary ?? preview?.summary ?? '');
  const [body, setBody] = useState(guidance?.body ?? preview?.body ?? '');
  const [kind, setKind] = useState<GuidanceKind>(guidance?.kind ?? preview?.suggestedKind ?? 'TEAM_RULE');
  const [steps, setSteps] = useState<GuidanceStep[]>(guidance?.steps ?? ['DESIGN']);
  const [priority, setPriority] = useState(String(guidance?.priority ?? GUIDANCE_LIMITS.priority.default));
  const [enabled, setEnabled] = useState(guidance?.enabled ?? true);
  const [license, setLicense] = useState(guidance?.license ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { title: useId(), summary: useId(), kind: useId(), body: useId(), bodyHint: useId(), priority: useId(), priorityHint: useId(), steps: useId(), license: useId() };
  const uploaded = guidance ? guidance.sourceKind === 'UPLOADED' : Boolean(preview);
  const sourceName = guidance?.sourceName ?? preview?.sourceName ?? null;

  const toggleStep = (step: GuidanceStep, on: boolean) => setSteps((current) => (on ? [...current, step] : current.filter((s) => s !== step)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (steps.length === 0) {
      setError('Choose at least one step the guidance is for.');
      return;
    }
    setBusy(true);
    setError(null);
    const fields = {
      title: title.trim(),
      summary: summary.trim(),
      body,
      kind,
      steps,
      priority: Number(priority),
      ...(uploaded ? { license: license.trim() } : {}),
    };
    try {
      if (guidance) {
        await api.patch(`${base}/${guidance.id}`, fields);
        onSaved(`“${fields.title}” saved.`);
      } else {
        await api.post(base, {
          ...fields,
          summary: fields.summary || undefined,
          license: fields.license || undefined,
          enabled,
          ...(preview ? { sourceKind: 'UPLOADED', sourceName: preview.sourceName } : {}),
        });
        onSaved(`“${fields.title}” added.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the guidance");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="dialog-body" onSubmit={submit}>
      <div className="field">
        <label htmlFor={ids.title} className="field-label">Title</label>
        <input id={ids.title} required maxLength={GUIDANCE_LIMITS.title} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={ids.summary} className="field-label">Summary</label>
        <input id={ids.summary} maxLength={GUIDANCE_LIMITS.summary} value={summary} placeholder="Optional: what it is for. Shown in the list, never sent to the model." onChange={(e) => setSummary(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={ids.kind} className="field-label">Kind</label>
        <Select id={ids.kind} value={kind} onChange={(e) => setKind(e.target.value as GuidanceKind)}>
          {(Object.keys(GUIDANCE_KIND_LABEL) as GuidanceKind[]).map((value) => (
            <option key={value} value={value}>{GUIDANCE_KIND_LABEL[value]}</option>
          ))}
        </Select>
      </div>
      <fieldset className="guidance-steps" aria-describedby={ids.steps}>
        <legend className="field-label">Used in these steps</legend>
        {GUIDANCE_STEPS.map((step) => (
          <div className="checkbox-field" key={step}>
            <input
              id={`${ids.steps}-${step}`}
              type="checkbox"
              checked={steps.includes(step)}
              onChange={(e) => toggleStep(step, e.target.checked)}
            />
            <label htmlFor={`${ids.steps}-${step}`}>{GUIDANCE_STEP_LABEL[step]}</label>
          </div>
        ))}
        <p id={ids.steps} className="field-hint">Code generation is not part of a run yet; guidance for it is kept for a coding agent that reads it from the API.</p>
      </fieldset>
      <div className="field">
        <label htmlFor={ids.body} className="field-label">Text</label>
        <textarea id={ids.body} required rows={10} maxLength={GUIDANCE_LIMITS.body} value={body} aria-describedby={ids.bodyHint} onChange={(e) => setBody(e.target.value)} />
        <p id={ids.bodyHint} className="field-hint">
          {body.length.toLocaleString('en')} of {GUIDANCE_LIMITS.body.toLocaleString('en')} characters, about {estimateGuidanceTokens(body.trim())} tokens in a prompt.
        </p>
      </div>
      <div className="field">
        <label htmlFor={ids.priority} className="field-label">Priority</label>
        <input
          id={ids.priority}
          type="number"
          required
          min={GUIDANCE_LIMITS.priority.min}
          max={GUIDANCE_LIMITS.priority.max}
          value={priority}
          aria-describedby={ids.priorityHint}
          onChange={(e) => setPriority(e.target.value)}
        />
        <p id={ids.priorityHint} className="field-hint">0 to 1000. A higher one comes first in the prompt and is kept longest when the token budget is short.</p>
      </div>
      {uploaded && (
        <div className="field">
          <label htmlFor={ids.license} className="field-label">Licence</label>
          <input id={ids.license} maxLength={200} value={license} placeholder={`Optional, such as MIT. The text came from ${sourceName ?? 'a file'}.`} onChange={(e) => setLicense(e.target.value)} />
        </div>
      )}
      {!guidance && (
        <div className="checkbox-field">
          <input id={`${ids.title}-on`} type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <label htmlFor={`${ids.title}-on`}>Use it right away</label>
        </div>
      )}
      <FormError message={error} />
      <div className="dialog-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{guidance ? 'Save changes' : 'Add guidance'}</button>
      </div>
    </form>
  );
}
