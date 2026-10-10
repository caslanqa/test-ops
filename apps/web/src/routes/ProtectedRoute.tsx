import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function ProtectedRoute() {
  const { user, loading, sessionExpired } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <p className="boot-loading" role="status">
        Checking your session…
      </p>
    );
  }
  if (!user) {
    if (!sessionExpired) return <Navigate to="/login" replace />;
    // The session ended on its own: after signing in again, the user comes back to this page.
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?expired=1&next=${next}`} replace />;
  }
  return <Outlet />;
}
