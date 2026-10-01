import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function AppHeader() {
  const { user, logout } = useAuth();
  return (
    <header className="app-header">
      <Link to="/workspaces" className="brand">
        TestOps
      </Link>
      {user && (
        <div className="app-header-user">
          <span>{user.displayName}</span>
          <button onClick={logout}>Çıkış</button>
        </div>
      )}
    </header>
  );
}
