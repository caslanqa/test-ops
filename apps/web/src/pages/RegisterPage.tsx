import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { AuthLayout } from '../components/AuthLayout';
import { useAuthConfig } from '../lib/authConfig';
import { FormError, Loading } from '../components/Page';
import { usePageTitle } from '../lib/useResource';

const MIN_PASSWORD = 8;

export function RegisterPage() {
  usePageTitle('Create account');
  const { register } = useAuth();
  const navigate = useNavigate();
  const { data: config, error: configError } = useAuthConfig();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
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
      await register(email, displayName, password);
      navigate('/workspaces');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't reach the server. Check your connection and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!config && !configError) {
    return (
      <AuthLayout>
        <Loading />
      </AuthLayout>
    );
  }

  if (!config?.selfRegistration) {
    return (
      <AuthLayout>
        <div className="login-form">
          <h1>Sign-up is disabled</h1>
          <p className="login-hint">
            On this server, accounts are created by workspace admins. Ask your admin for an account.
          </p>
          <Link to="/login" className="btn btn-secondary btn-block">Back to sign in</Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form className="login-form" onSubmit={onSubmit}>
        <h1>Create your account</h1>
        <p className="login-hint">
          After signing up you can create your own workspace, or wait for an admin to add you to one.
        </p>
        <div className="field">
          <label htmlFor={ids.name} className="field-label">Full name</label>
          <input id={ids.name} autoComplete="name" value={displayName} minLength={2} maxLength={100} required onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={ids.email} className="field-label">Email</label>
          <input id={ids.email} type="email" autoComplete="email" value={email} required onChange={(e) => setEmail(e.target.value)} />
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
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
        <p className="auth-switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
