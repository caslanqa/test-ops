import { useId, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Plus, Send, Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import { CopyButton } from '../../components/CopyButton';
import { ConfirmDialog } from '../../components/Members';
import { FormError, LoadError, Loading, PageHeader } from '../../components/Page';
import { Tag } from '../../components/StatusChip';
import { formatDateTime } from '../../lib/format';
import { useNotice } from '../../lib/notice';
import { useProjectPermissions } from '../../lib/permissions';
import { useProjectInfo } from '../../lib/projectInfo';
import { usePageTitle, useResource } from '../../lib/useResource';
import { describeDelivery, type WebhookDelivery } from '../../lib/webhooks';

interface WebhookSettings {
  url: string;
  headerNames: string[];
  enabled: boolean;
  deliveries: (WebhookDelivery & { run: { id: string; title: string } | null })[];
}

interface HeaderDraft {
  key: number;
  name: string;
  value: string;
}

const DELIVERY_LABEL = { PENDING: 'Retrying', SUCCEEDED: 'Delivered', FAILED: 'Failed' } as const;

/** The signing secret, shown once after it is made; it can't be read again later. */
function SecretOnce({ secret }: { secret: string }) {
  const id = useId();
  return (
    <div className="secret-once" role="status">
      <p>
        <strong>Signing secret.</strong> Copy it now; it isn't shown again. Your CI can use it to check
        the <code>X-TestOps-Signature-256</code> header.
      </p>
      <code id={id} className="secret-value">{secret}</code>
      <CopyButton text={secret} what="the signing secret" targetId={id} />
    </div>
  );
}

/**
 * The project's CI webhook: when a run starts with cases set to run by automation, TestOps calls
 * this URL, so CI can run them. Project admins set it up here.
 */
export function IntegrationsPage() {
  const { projectId = '' } = useParams();
  const { data: info } = useProjectInfo(projectId);
  const { manageMembers: isAdmin } = useProjectPermissions(projectId);
  usePageTitle(info ? `Integrations (${info.project.name})` : 'Integrations');
  const settings = useResource(
    () => api.get<{ webhook: WebhookSettings | null }>(`/projects/${projectId}/webhook`),
    [projectId],
  );
  const { notify } = useNotice();
  const webhook = settings.data?.webhook ?? null;

  const [url, setUrl] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  // Null keeps the saved headers; a list replaces them all.
  const [headers, setHeaders] = useState<HeaderDraft[] | null>(null);
  const [nextKey, setNextKey] = useState(1);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pingResult, setPingResult] = useState<WebhookDelivery | null>(null);
  const [confirming, setConfirming] = useState<'remove' | 'secret' | null>(null);
  const ids = { url: useId(), urlHint: useId(), enabled: useId() };

  const shownUrl = url ?? webhook?.url ?? '';
  const shownEnabled = enabled ?? webhook?.enabled ?? true;

  function addHeader(name = '', value = '') {
    setHeaders((current) => [...(current ?? []), { key: nextKey, name, value }]);
    setNextKey((k) => k + 1);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const saved = await api.put<{ webhook: WebhookSettings; secret: string | null }>(`/projects/${projectId}/webhook`, {
        url: shownUrl.trim(),
        enabled: shownEnabled,
        headers: headers?.filter((h) => h.name.trim()).map((h) => ({ name: h.name.trim(), value: h.value })),
      });
      if (saved.secret) setSecret(saved.secret);
      setUrl(null);
      setEnabled(null);
      setHeaders(null);
      notify(webhook ? 'Webhook saved.' : 'Webhook created.');
      settings.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the webhook");
    } finally {
      setSaving(false);
    }
  }

  async function ping() {
    setError(null);
    setPingResult(null);
    try {
      setPingResult(await api.post<WebhookDelivery>(`/projects/${projectId}/webhook/ping`));
      settings.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the test");
    }
  }

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Integrations" />
        <p className="muted">Only project admins can set up integrations.</p>
      </>
    );
  }
  if (settings.error) return <LoadError message={settings.error} onRetry={settings.reload} />;
  if (!settings.data) return <Loading />;

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Start CI when a run has cases set to run by automation."
      />
      {secret && <SecretOnce secret={secret} />}

      <section className="surface integrations-section" aria-labelledby="webhook-heading">
        <h2 id="webhook-heading" className="section-title">
          CI webhook {webhook && <Tag tone={webhook.enabled ? 'strong' : 'outline'}>{webhook.enabled ? 'On' : 'Off'}</Tag>}
        </h2>
        <p className="muted">
          When a run starts with cases set to <strong>Automation</strong>, TestOps POSTs it here as JSON
          ({'{'} event_type, client_payload {'}'}, the shape of a GitHub <code>repository_dispatch</code>), signed
          with HMAC-SHA256 in <code>X-TestOps-Signature-256</code>. Runs that CI starts itself never call it.
        </p>
        <form className="integrations-form" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor={ids.url} className="field-label">Webhook URL</label>
            <input
              id={ids.url}
              type="url"
              required
              value={shownUrl}
              aria-describedby={ids.urlHint}
              placeholder="https://api.github.com/repos/OWNER/REPO/dispatches"
              onChange={(e) => setUrl(e.target.value)}
            />
            <p id={ids.urlHint} className="field-hint">
              Addresses on private or local networks are refused, unless the server allows them.
            </p>
          </div>
          <fieldset className="header-editor">
            <legend className="field-label">Request headers</legend>
            {headers === null ? (
              <>
                {webhook && webhook.headerNames.length > 0 ? (
                  <ul className="header-names">
                    {webhook.headerNames.map((name) => (
                      <li key={name}><code>{name}</code> <span className="muted">value hidden</span></li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No extra headers.</p>
                )}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => addHeader()}>
                  <Plus size={14} aria-hidden="true" />
                  {webhook?.headerNames.length ? 'Replace the headers' : 'Add a header'}
                </button>
              </>
            ) : (
              <>
                <p className="field-hint">Values are stored encrypted and never shown again. Saving replaces all headers.</p>
                <ul className="header-rows">
                  {headers.map((h, index) => (
                    <li key={h.key}>
                      <input
                        aria-label={`Header ${index + 1} name`}
                        placeholder="Authorization"
                        value={h.name}
                        onChange={(e) => setHeaders((all) => all!.map((x) => (x.key === h.key ? { ...x, name: e.target.value } : x)))}
                      />
                      <input
                        aria-label={`Header ${index + 1} value`}
                        placeholder="Bearer …"
                        type="password"
                        autoComplete="off"
                        value={h.value}
                        onChange={(e) => setHeaders((all) => all!.map((x) => (x.key === h.key ? { ...x, value: e.target.value } : x)))}
                      />
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Remove header ${index + 1}`}
                        onClick={() => setHeaders((all) => all!.filter((x) => x.key !== h.key))}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="header-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => addHeader()}>
                    <Plus size={14} aria-hidden="true" />
                    Add a header
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      addHeader('Authorization', 'Bearer ');
                      addHeader('Accept', 'application/vnd.github+json');
                    }}
                  >
                    Headers for GitHub
                  </button>
                  {webhook && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHeaders(null)}>
                      Keep the saved headers
                    </button>
                  )}
                </div>
              </>
            )}
          </fieldset>
          <div className="checkbox-field">
            <input id={ids.enabled} type="checkbox" checked={shownEnabled} onChange={(e) => setEnabled(e.target.checked)} />
            <label htmlFor={ids.enabled}>Call it when a run starts</label>
          </div>
          <FormError message={error} />
          <div className="form-buttons">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {webhook ? 'Save changes' : 'Create webhook'}
            </button>
            {webhook && (
              <>
                <button type="button" className="btn btn-secondary" onClick={ping}>
                  <Send size={16} aria-hidden="true" />
                  Send a test
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirming('secret')}>
                  New signing secret
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirming('remove')}>
                  Remove webhook
                </button>
              </>
            )}
          </div>
          {pingResult && (
            <p className={pingResult.status === 'SUCCEEDED' ? 'note' : 'form-error'} role="status">
              Test {pingResult.status === 'SUCCEEDED' ? 'delivered' : 'not delivered'}: {describeDelivery(pingResult)}
            </p>
          )}
        </form>
      </section>

      {webhook && webhook.deliveries.length > 0 && (
        <section className="surface table-wrap integrations-section" aria-labelledby="deliveries-heading">
          <h2 id="deliveries-heading" className="section-title">Recent calls</h2>
          <table className="data-table">
            <caption className="visually-hidden">The latest calls of the webhook</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Event</th>
                <th scope="col">Run</th>
                <th scope="col" className="col-main">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {webhook.deliveries.map((d) => (
                <tr key={d.id}>
                  <td className="num muted">{formatDateTime(d.createdAt)}</td>
                  <td><code>{d.event}</code></td>
                  <td>{d.run ? <Link to={`/projects/${projectId}/runs/${d.run.id}`}>{d.run.title}</Link> : <span className="muted">—</span>}</td>
                  <td>
                    <Tag tone={d.status === 'SUCCEEDED' ? 'strong' : 'outline'}>{DELIVERY_LABEL[d.status]}</Tag>{' '}
                    <span className="muted">{describeDelivery(d)}{d.attempts > 1 ? ` · ${d.attempts} tries` : ''}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="surface integrations-section" aria-labelledby="github-heading">
        <h2 id="github-heading" className="section-title">GitHub Actions</h2>
        <ol className="prose-list">
          <li>
            URL: <code>https://api.github.com/repos/OWNER/REPO/dispatches</code>
          </li>
          <li>
            Headers: <code>Authorization: Bearer &lt;token&gt;</code> (a fine-grained token for that repository with
            Contents: read and write) and <code>Accept: application/vnd.github+json</code>.
          </li>
          <li>
            In the workflow, start on the event; the payload carries the run and the cases to run:
            <pre className="code-block">{`on:
  repository_dispatch:
    types: [testops.run.started]
# github.event.client_payload.run.id        the run to report to
# github.event.client_payload.api_url       the TestOps API
# github.event.client_payload.automation_keys  e2e:<key> tags of its automated cases`}</pre>
          </li>
        </ol>
      </section>

      <ConfirmDialog
        open={confirming === 'remove'}
        title="Remove the webhook?"
        message="Runs no longer start CI. Its recent calls are deleted too."
        confirmLabel="Remove webhook"
        onConfirm={async () => {
          await api.delete(`/projects/${projectId}/webhook`);
          setConfirming(null);
          setSecret(null);
          notify('Webhook removed.');
          settings.reload();
        }}
        onClose={() => setConfirming(null)}
      />
      <ConfirmDialog
        open={confirming === 'secret'}
        title="Make a new signing secret?"
        message="The current secret stops working at once; update your CI with the new one."
        confirmLabel="Make a new secret"
        onConfirm={async () => {
          const made = await api.post<{ secret: string }>(`/projects/${projectId}/webhook/secret`);
          setConfirming(null);
          setSecret(made.secret);
        }}
        onClose={() => setConfirming(null)}
      />
    </>
  );
}
