import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function ProtectedRoute() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <p className="boot-loading" role="status">
        Checking your session…
      </p>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}
