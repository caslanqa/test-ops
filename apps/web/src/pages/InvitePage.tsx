import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AuthLayout } from '../components/AuthLayout';
import { FormError, Loading } from '../components/Page';
import { formatDate } from '../lib/format';
import { WORKSPACE_ROLE_LABEL, labelOf } from '../lib/labels';
import { usePageTitle, useResource } from '../lib/useResource';

interface InvitationPreview {
  workspace: { id: string; name: string };
  email: string;
  role: string;
  expiresAt: string;
}

const MIN_PASSWORD = 8;

function InvitationIntro({ invitation }: { invitation: InvitationPreview }) {
  return (
    <>
      <h1>Join {invitation.workspace.name}</h1>
      <p className="login-hint">
        You're invited as {labelOf(WORKSPACE_ROLE_LABEL, invitation.role).toLowerCase()} with{' '}
        <strong>{invitation.email}</strong>. The link works once, until {formatDate(invitation.expiresAt)}.
      </p>
    </>
  );
}

/** Creates the invited account; the email comes from the invitation and can't be changed. */
function CreateInvitedAccount({ token, invitation }: { token: string; invitation: InvitationPreview }) {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const ids = { name: useId(), email: useId(), password: useId(), passwordHint: useId(), confirm: useId() };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("The passwords don't match. Enter the same password in both fields.");
      return;
    }
    setSubmitting(true);
    try {
      await register(invitation.email, displayName, password, token);
      navigate(`/workspaces/${invitation.workspace.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn't reach the server. Check your connection and try again.",
      );
      setSubmitting(false);
    }
  }

  return (
    <form className="login-form" onSubmit={onSubmit}>
      <InvitationIntro invitation={invitation} />
      <div className="field">
        <label htmlFor={ids.name} className="field-label">Full name</label>
        <input id={ids.name} autoComplete="name" value={displayName} minLength={2} maxLength={100} required onChange={(e) => setDisplayName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={ids.email} className="field-label">Email</label>
        <input id={ids.email} type="email" value={invitation.email} readOnly aria-readonly="true" />
      </div>
      <div className="field">
        <label htmlFor={ids.password} className="field-label">Password</label>
        <input
          id={ids.password}
          type="password"
          autoComplete="new-password"
          value={password}
          minLength={MIN_PASSWORD}
          maxLength={72}
          required
          aria-describedby={ids.passwordHint}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p id={ids.passwordHint} className="field-hint">At least {MIN_PASSWORD} characters.</p>
      </div>
      <div className="field">
        <label htmlFor={ids.confirm} className="field-label">Confirm password</label>
        <input id={ids.confirm} type="password" autoComplete="new-password" value={confirm} required onChange={(e) => setConfirm(e.target.value)} />
      </div>
      <FormError message={error} />
      <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
        {submitting ? 'Creating account…' : 'Create account and join'}
      </button>
      <p className="auth-switch">
        Already have an account with this email?{' '}
        <Link to={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>Sign in to join</Link>
      </p>
    </form>
  );
}

/**
 * Where an invitation link leads. The account with the invited email joins with one click; a
 * signed-out visitor signs in or creates that account. Nobody becomes a member without this step.
 */
export function InvitePage() {
  const { token = '' } = useParams();
  const { user, loading: sessionLoading, logout } = useAuth();
  const navigate = useNavigate();
  const { data: invitation, error } = useResource(
    () => api.get<InvitationPreview>(`/invitations/${encodeURIComponent(token)}`),
    [token],
  );
  usePageTitle(invitation ? `Join ${invitation.workspace.name}` : 'Invitation');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  async function join(workspaceId: string) {
    setJoining(true);
    setJoinError(null);
    try {
      await api.post(`/invitations/${encodeURIComponent(token)}/accept`);
      navigate(`/workspaces/${workspaceId}`);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Couldn't join the workspace");
      setJoining(false);
    }
  }

  if (error && !invitation) {
    return (
      <AuthLayout>
        <div className="login-form">
          <h1>Invitation not available</h1>
          <p className="login-hint">{error}</p>
          {user ? (
            <Link to="/workspaces" className="btn btn-secondary btn-block">Go to your workspaces</Link>
          ) : (
            <Link to="/login" className="btn btn-secondary btn-block">Go to sign in</Link>
          )}
        </div>
      </AuthLayout>
    );
  }
  if (!invitation || sessionLoading) {
    return (
      <AuthLayout>
        <Loading />
      </AuthLayout>
    );
  }

  if (!user) {
    return (
      <AuthLayout>
        <CreateInvitedAccount token={token} invitation={invitation} />
      </AuthLayout>
    );
  }

  const isInvitedAccount = user.email.toLowerCase() === invitation.email;
  return (
    <AuthLayout>
      <div className="login-form">
        <InvitationIntro invitation={invitation} />
        {isInvitedAccount ? (
          <>
            <FormError message={joinError} />
            <button type="button" className="btn btn-primary btn-block" onClick={() => join(invitation.workspace.id)} disabled={joining}>
              {joining ? 'Joining…' : `Join ${invitation.workspace.name}`}
            </button>
          </>
        ) : (
          <>
            <p className="login-hint">
              You're signed in as {user.email}. Sign out, then sign in with {invitation.email} or create that account.
            </p>
            <button type="button" className="btn btn-secondary btn-block" onClick={logout}>Sign out</button>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
