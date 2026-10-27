import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Info, PlugZap } from 'lucide-react';
import { FormError } from './Page';
import { Select } from './Select';
import {
  AI_PROVIDER_LABEL,
  aiEndpointHost,
  type AiProviderKind,
  type AiSettingsView,
  type AiTestResult,
  type SaveAiSettings,
} from '../lib/ai';
import { useNotice } from '../lib/notice';

const trimSlashes = (value: string) => value.trim().replace(/\/+$/, '');

/**
 * The form of one AI setting, a workspace's default or a project's own. The provider key is write-only: the
 * field is never filled in, and the page only says whether one is saved. AI can be switched on only while the
 * saved settings have passed a connection test, and the test runs on the saved settings, so a change has to be
 * saved and tested again first (the server enforces both; this only says so up front).
 */
export function AiSettingsForm({
  view,
  onSave,
  onTest,
  onChanged,
  extra,
}: {
  view: AiSettingsView | null;
  onSave: (body: SaveAiSettings) => Promise<unknown>;
  onTest: () => Promise<AiTestResult>;
  onChanged: () => void;
  /** More buttons next to the form's own, such as removing the setting. */
  extra?: ReactNode;
}) {
  const { notify } = useNotice();
  const [provider, setProvider] = useState<AiProviderKind>(view?.provider ?? 'OPENAI_COMPATIBLE');
  const [model, setModel] = useState(view?.model ?? '');
  const [endpoint, setEndpoint] = useState(view?.endpoint ?? '');
  const [credential, setCredential] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  // Null follows the saved setting.
  const [enabledDraft, setEnabledDraft] = useState<boolean | null>(null);
  const [maxOutputTokens, setMaxOutputTokens] = useState(String(view?.maxOutputTokens ?? 8192));
  const [requestTimeoutSeconds, setRequestTimeoutSeconds] = useState(String((view?.requestTimeoutMs ?? 120000) / 1000));
  const [maxRunsPerUserPerDay, setMaxRunsPerUserPerDay] = useState(String(view?.maxRunsPerUserPerDay ?? 20));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestResult | null>(null);
  const ids = {
    provider: useId(), model: useId(), endpoint: useId(), endpointHint: useId(), key: useId(), keyHint: useId(),
    remove: useId(), enabled: useId(), enabledHint: useId(), tokens: useId(), timeout: useId(), runs: useId(), testHint: useId(),
  };

  const endpointValue = trimSlashes(endpoint);
  const connectionDirty =
    !view ||
    provider !== view.provider ||
    model.trim() !== view.model ||
    endpointValue !== (view.endpoint ?? '') ||
    credential !== '' ||
    removeKey;
  // What the server would accept: the saved settings passed a test and nothing that was tested has changed.
  const tested = Boolean(view?.testedAt) && !connectionDirty;
  const enabled = tested && (enabledDraft ?? view?.enabled ?? false);
  const dropsKey = Boolean(view?.hasCredential) && !credential && endpointValue !== (view?.endpoint ?? '');
  const host = aiEndpointHost(provider, endpointValue);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setTestResult(null);
    try {
      await onSave({
        provider,
        model: model.trim(),
        endpoint: endpointValue || undefined,
        ...(credential ? { credential } : removeKey ? { clearCredential: true } : {}),
        enabled,
        maxOutputTokens: Number(maxOutputTokens),
        requestTimeoutMs: Math.round(Number(requestTimeoutSeconds) * 1000),
        maxRunsPerUserPerDay: Number(maxRunsPerUserPerDay),
      });
      setCredential('');
      setRemoveKey(false);
      setEnabledDraft(null);
      notify('AI settings saved.');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the AI settings");
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      setTestResult(await onTest());
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't run the connection test");
    } finally {
      setTesting(false);
    }
  }

  return (
    <form className="integrations-form" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor={ids.provider} className="field-label">Provider</label>
        <Select id={ids.provider} value={provider} onChange={(e) => setProvider(e.target.value as AiProviderKind)}>
          {(Object.keys(AI_PROVIDER_LABEL) as AiProviderKind[]).map((kind) => (
            <option key={kind} value={kind}>{AI_PROVIDER_LABEL[kind]}</option>
          ))}
        </Select>
      </div>
      <div className="field">
        <label htmlFor={ids.model} className="field-label">Model</label>
        <input id={ids.model} required maxLength={200} value={model} placeholder="e.g. gpt-4o-mini, llama3.1, claude-sonnet-5-5" onChange={(e) => setModel(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={ids.endpoint} className="field-label">Endpoint</label>
        <input
          id={ids.endpoint}
          type="url"
          required={provider === 'OPENAI_COMPATIBLE'}
          value={endpoint}
          aria-describedby={ids.endpointHint}
          placeholder={provider === 'ANTHROPIC' ? 'Leave empty for the public API' : 'http://host.docker.internal:11434/v1'}
          onChange={(e) => setEndpoint(e.target.value)}
        />
        <p id={ids.endpointHint} className="field-hint">
          {provider === 'ANTHROPIC'
            ? 'The base address; leave it empty to use Anthropic’s public API.'
            : 'The base address of the server, including /v1. Local and private network addresses work; with the Docker install, reach a model on the same machine as host.docker.internal, since localhost is the app’s own container.'}
          {' '}Link-local addresses such as 169.254.169.254 are refused.
        </p>
      </div>
      <div className="field">
        <label htmlFor={ids.key} className="field-label">Provider key</label>
        <input
          id={ids.key}
          type="password"
          autoComplete="new-password"
          value={credential}
          aria-describedby={ids.keyHint}
          placeholder={view?.hasCredential ? 'A key is saved' : provider === 'ANTHROPIC' ? 'Required for Anthropic' : 'Often not needed for a local server'}
          onChange={(e) => setCredential(e.target.value)}
        />
        <p id={ids.keyHint} className="field-hint">
          Stored encrypted and never shown again.
          {view?.hasCredential ? ' A key is saved; leave this empty to keep it.' : ''}
          {dropsKey ? ' Because the endpoint changed, the saved key will be removed unless you enter a new one.' : ''}
        </p>
      </div>
      {view?.hasCredential && !credential && (
        <div className="checkbox-field">
          <input id={ids.remove} type="checkbox" checked={removeKey} onChange={(e) => setRemoveKey(e.target.checked)} />
          <label htmlFor={ids.remove}>Remove the saved key</label>
        </div>
      )}
      <div className="field">
        <label htmlFor={ids.tokens} className="field-label">Longest answer (tokens)</label>
        <input id={ids.tokens} type="number" required min={256} max={32000} value={maxOutputTokens} onChange={(e) => setMaxOutputTokens(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={ids.timeout} className="field-label">Wait for an answer (seconds)</label>
        <input id={ids.timeout} type="number" required min={5} max={600} value={requestTimeoutSeconds} onChange={(e) => setRequestTimeoutSeconds(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={ids.runs} className="field-label">Runs per person per day</label>
        <input id={ids.runs} type="number" required min={1} max={1000} value={maxRunsPerUserPerDay} onChange={(e) => setMaxRunsPerUserPerDay(e.target.value)} />
      </div>
      <div className="checkbox-field">
        <input
          id={ids.enabled}
          type="checkbox"
          checked={enabled}
          disabled={!tested}
          aria-describedby={ids.enabledHint}
          onChange={(e) => setEnabledDraft(e.target.checked)}
        />
        <label htmlFor={ids.enabled}>Let people draft test cases with AI</label>
      </div>
      <p id={ids.enabledHint} className="field-hint">
        {tested
          ? 'The connection test passed. Save to apply the switch.'
          : view?.testedAt
            ? 'You changed the connection. Save, then run the connection test again, to switch AI on.'
            : 'First save the settings, then run the connection test; AI can be switched on after it passes.'}
      </p>
      <p className="info-note">
        <Info size={16} aria-hidden="true" />
        When someone drafts test cases from a requirement, TestOps sends {host} the requirement&rsquo;s title and
        description, any notes they add, the cases already linked to it (title and steps), and the id and title of up
        to 200 other cases of the project. Nothing else, and nothing from other projects.
      </p>
      <FormError message={error} />
      <div className="form-buttons">
        <button type="submit" className="btn btn-primary" disabled={saving}>Save settings</button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!view || connectionDirty || testing}
          aria-describedby={ids.testHint}
          onClick={test}
        >
          <PlugZap size={16} aria-hidden="true" />
          Test connection
        </button>
        {extra}
      </div>
      <p id={ids.testHint} className="field-hint">
        {!view
          ? 'Save the settings to test them.'
          : connectionDirty
            ? 'Save your changes first: the test uses the saved settings. It sends one small request with no project data.'
            : 'Sends one small request with no project data.'}
      </p>
      {testResult && (
        <p className={testResult.ok ? 'note' : 'form-error'} role="status">
          {testResult.ok ? `Connection works (${testResult.latencyMs} ms).` : `Connection test failed: ${testResult.error ?? 'no reason given'}`}
        </p>
      )}
    </form>
  );
}
