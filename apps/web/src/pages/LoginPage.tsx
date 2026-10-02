import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { AuthLayout } from '../components/AuthLayout';
import { useAuthConfig } from '../lib/authConfig';
import { FormError } from '../components/Page';
import { usePageTitle } from '../lib/useResource';

export function LoginPage() {
  usePageTitle('Sign in');
  const { login } = useAuth();
  const navigate = useNavigate();
  const { data: config } = useAuthConfig();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailId = useId();
  const passwordId = useId();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/workspaces');
    } catch (err) {
      setError(
        !(err instanceof ApiError)
          ? "Couldn't reach the server. Check your connection and try again."
          : err.status === 401
            ? 'Incorrect email or password. Check your details and try again.'
            : // 429 dahil diğer durumlarda sunucu mesajı (ör. "Try again in 42 seconds.") yeterince açık.
              err.message,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <form className="login-form" onSubmit={onSubmit}>
        <h1>Sign in</h1>
        <p className="login-hint">
          {config?.selfRegistration
            ? 'Sign in with your TestOps account.'
            : 'Sign in with the account your workspace admin created for you.'}
        </p>
        <div className="field">
          <label htmlFor={emailId} className="field-label">Email</label>
          <input
            id={emailId}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor={passwordId} className="field-label">Password</label>
          <input
            id={passwordId}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <FormError message={error} />
        <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        {config?.selfRegistration && (
          <p className="auth-switch">
            Don't have an account? <Link to="/register">Create one</Link>
          </p>
        )}
      </form>
    </AuthLayout>
  );
}
