import { useId, useState, type FormEvent } from 'react';
import { Check, Copy, KeyRound, Plus } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useAuth, type CurrentUser } from '../auth/AuthContext';
import { ConfirmDialog } from '../components/Members';
import { EmptyState, FormError, LoadError, Loading, PageHeader } from '../components/Page';
import { Tag } from '../components/StatusChip';
import { formatDate } from '../lib/format';
import { usePageTitle, useResource } from '../lib/useResource';

interface ApiToken {
  id: string;
  name: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

function ProfileSection({ user }: { user: CurrentUser }) {
  const { updateUser } = useAuth();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const nameId = useId();
  const emailId = useId();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      updateUser(await api.patch<CurrentUser>('/auth/me', { displayName }));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="surface settings-section" aria-labelledby="profile-title">
      <h2 id="profile-title" className="section-title">Profile</h2>
      <form className="settings-form" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor={nameId} className="field-label">Full name</label>
          <input id={nameId} autoComplete="name" value={displayName} minLength={2} maxLength={100} required onChange={(e) => { setDisplayName(e.target.value); setSaved(false); }} />
        </div>
        <div className="field">
          <label htmlFor={emailId} className="field-label">Email</label>
          <input id={emailId} type="email" value={user.email} readOnly aria-readonly="true" />
        </div>
        <FormError message={error} />
        <div className="settings-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>Save profile</button>
          <span className="save-status" role="status">{saved && 'Profile saved.'}</span>
        </div>
      </form>
    </section>
  );
}

function PasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const ids = { current: useId(), next: useId(), nextHint: useId(), confirm: useId() };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (next !== confirm) {
      setError("The new passwords don't match. Enter the same password in both fields.");
      return;
    }
    setSaving(true);
    try {
      await api.patch('/auth/me/password', { currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'The current password is incorrect.'
          : err instanceof Error
            ? err.message
            : "Couldn't change the password",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="surface settings-section" aria-labelledby="password-title">
      <h2 id="password-title" className="section-title">Password</h2>
      <form className="settings-form" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor={ids.current} className="field-label">Current password</label>
          <input id={ids.current} type="password" autoComplete="current-password" value={current} required onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="field-grid">
          <div className="field">
            <label htmlFor={ids.next} className="field-label">New password</label>
            <input id={ids.next} type="password" autoComplete="new-password" minLength={8} maxLength={72} value={next} required aria-describedby={ids.nextHint} onChange={(e) => setNext(e.target.value)} />
            <p id={ids.nextHint} className="field-hint">At least 8 characters.</p>
          </div>
          <div className="field">
            <label htmlFor={ids.confirm} className="field-label">Confirm new password</label>
            <input id={ids.confirm} type="password" autoComplete="new-password" value={confirm} required onChange={(e) => setConfirm(e.target.value)} />
          </div>
        </div>
        <FormError message={error} />
        <div className="settings-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>Change password</button>
          <span className="save-status" role="status">{saved && 'Password changed.'}</span>
        </div>
      </form>
    </section>
  );
}

/** Oluşturulan token yalnızca bir kez gösterilir; sunucu yalnızca hash'ini saklar (FR-073). */
function NewTokenReveal({ token, onDone }: { token: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const tokenId = useId();

  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      // Pano izni yoksa metin seçili bırakılır; kullanıcı elle kopyalar.
      (document.getElementById(tokenId) as HTMLInputElement | null)?.select();
    }
  }

  return (
    <div className="token-reveal" role="status">
      <p className="token-reveal-title">Token created. Copy it now; it won't be shown again after you leave this page.</p>
      <div className="token-reveal-row">
        <label htmlFor={tokenId} className="visually-hidden">New API token</label>
        <input id={tokenId} className="token-value" value={token} readOnly onFocus={(e) => e.target.select()} />
        <button type="button" className="btn btn-secondary" onClick={copy}>
          {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>Done</button>
      </div>
      <p className="field-hint">
        Send it from CI as <code>Authorization: Bearer &lt;token&gt;</code>. Don't commit it; store it as a CI secret.
      </p>
    </div>
  );
}

function ApiTokensSection() {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const nameId = useId();
  const { data: tokens, error: loadError, loading, reload } = useResource(
    () => api.get<ApiToken[]>('/api-tokens'),
    [],
  );

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await api.post<{ token: string }>('/api-tokens', { name });
      setNewToken(created.token);
      setName('');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the token");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="surface settings-section" aria-labelledby="tokens-title">
      <h2 id="tokens-title" className="section-title">API tokens</h2>
      <p className="muted settings-intro">
        CI jobs and test frameworks use these tokens to submit results on your behalf, with the same permissions
        as your project roles. For automation, use a separate user with the Automation role and that user's token.
      </p>
      {newToken && <NewTokenReveal token={newToken} onDone={() => setNewToken(null)} />}
      <form className="token-create" onSubmit={onCreate}>
        <div className="field">
          <label htmlFor={nameId} className="field-label">Token name</label>
          <input id={nameId} placeholder="e.g. GitHub Actions – web" value={name} minLength={2} maxLength={100} required onChange={(e) => setName(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          <Plus size={16} aria-hidden="true" />
          Create token
        </button>
      </form>
      <FormError message={error} />
      {loadError && <LoadError message={loadError} onRetry={reload} />}
      {loading && <Loading />}
      {tokens && tokens.length === 0 && (
        <EmptyState icon={KeyRound} title="No tokens yet">
          Create a token to submit automation results through the API.
        </EmptyState>
      )}
      {tokens && tokens.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <caption className="visually-hidden">API tokens</caption>
            <thead>
              <tr>
                <th scope="col" className="col-main">Name</th>
                <th scope="col">Status</th>
                <th scope="col" className="hide-sm">Created</th>
                <th scope="col" className="hide-sm">Last used</th>
                <th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td><span className="cell-title">{t.name}</span></td>
                  <td>{t.revokedAt ? <Tag tone="outline">Revoked</Tag> : <Tag tone="strong">Active</Tag>}</td>
                  <td className="muted num hide-sm">{formatDate(t.createdAt)}</td>
                  <td className="muted num hide-sm">{t.lastUsedAt ? formatDate(t.lastUsedAt) : 'Never'}</td>
                  <td className="cell-actions">
                    {!t.revokedAt && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRevoking(t)} aria-label={`Revoke ${t.name}`}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={revoking !== null}
        title="Revoke token"
        message={revoking ? `CI jobs using "${revoking.name}" stop working immediately. This can't be undone.` : ''}
        confirmLabel="Revoke token"
        onClose={() => setRevoking(null)}
        onConfirm={async () => {
          if (!revoking) return;
          await api.delete(`/api-tokens/${revoking.id}`);
          setRevoking(null);
          reload();
        }}
      />
    </section>
  );
}

export function AccountPage() {
  usePageTitle('Account');
  const { user } = useAuth();
  if (!user) return null;
  return (
    <>
      <PageHeader title="Account" description="Your profile, password and API tokens for automation." />
      <div className="settings-stack">
        <ProfileSection user={user} />
        <PasswordSection />
        <ApiTokensSection />
      </div>
    </>
  );
}
