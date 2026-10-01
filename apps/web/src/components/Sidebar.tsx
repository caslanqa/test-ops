import { Link, NavLink, useLocation, useMatch } from 'react-router-dom';
import {
  ChevronLeft,
  LayoutGrid,
  LogOut,
  Boxes,
} from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useResource } from '../lib/useResource';
import { PROJECT_ROLE_LABEL, labelOf } from '../lib/labels';
import { useProjectInfo, type Workspace } from '../lib/projectInfo';
import { PROJECT_SECTIONS } from '../lib/sections';
import { BrandMark } from './BrandMark';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase())
    .join('');
}

/**
 * Sol navigasyon: proje içindeyken proje bölümlerini, dışındayken
 * workspace listesini gösterir. Masaüstünde sabit, mobilde çekmece içinde
 * aynı bileşen kullanılır; `onNavigate` çekmeceyi kapatmak içindir.
 */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const projectId = useMatch('/projects/:projectId/*')?.params.projectId;
  const { data: info } = useProjectInfo(projectId);
  // Yeni workspace oluşturulunca sayfa ona yönlendiği için rota değişiminde yenilemek yeterli.
  const { data: workspaces } = useResource(
    () => (projectId ? Promise.resolve([]) : api.get<Workspace[]>('/workspaces')),
    [projectId, pathname],
  );

  // Tüm sidebar içeriği (marka, proje bağlamı, kullanıcı) tek bir landmark içinde.
  return (
    <aside className="sidebar-inner" aria-label="App menu">
      <div className="sidebar-brand">
        <BrandMark to="/workspaces" />
      </div>

      {projectId ? (
        <>
          <div className="sidebar-context">
            {info && (
              <>
                <Link
                  to={`/workspaces/${info.workspace.id}`}
                  className="context-back"
                  onClick={onNavigate}
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                  {info.workspace.name}
                </Link>
                <p className="context-project">
                  <span className="project-key">{info.project.key}</span>
                  <span className="project-name">{info.project.name}</span>
                </p>
                {/* Kullanıcı neden bazı eylemleri göremediğini anlasın diye rolü görünür. */}
                <p className="context-role">
                  Your role: {labelOf(PROJECT_ROLE_LABEL, info.project.currentUserRole)}
                </p>
              </>
            )}
          </div>
          <nav aria-label="Project sections">
            <ul className="side-nav">
              {PROJECT_SECTIONS.map(({ path, label, icon: Icon }) => (
                <li key={path}>
                  <NavLink to={`/projects/${projectId}/${path}`} onClick={onNavigate}>
                    <Icon size={18} aria-hidden="true" />
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </>
      ) : (
        <nav aria-label="Workspaces">
          <ul className="side-nav">
            <li>
              <NavLink to="/workspaces" end onClick={onNavigate}>
                <LayoutGrid size={18} aria-hidden="true" />
                All workspaces
              </NavLink>
            </li>
            {workspaces?.map((w) => (
              <li key={w.id}>
                <NavLink to={`/workspaces/${w.id}`} onClick={onNavigate}>
                  <Boxes size={18} aria-hidden="true" />
                  <span className="truncate">{w.name}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {user && (
        <div className="sidebar-footer">
          <span className="avatar" aria-hidden="true">
            {initials(user.displayName)}
          </span>
          <Link to="/account" className="user-meta" onClick={onNavigate} title="Account">
            <span className="user-name truncate">{user.displayName}</span>
            <span className="user-email truncate">{user.email}</span>
          </Link>
          <button
            type="button"
            className="icon-button icon-button--on-dark"
            onClick={logout}
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut size={18} aria-hidden="true" />
          </button>
        </div>
      )}
    </aside>
  );
}
