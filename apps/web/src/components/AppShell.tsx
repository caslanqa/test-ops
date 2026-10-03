import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useMatch } from 'react-router-dom';
import { ChevronRight, Menu, X } from 'lucide-react';
import { useProjectInfo, useWorkspace } from '../lib/projectInfo';
import { PROJECT_SECTIONS } from '../lib/sections';
import { Sidebar } from './Sidebar';
import { ThemeSwitcher } from './ThemeSwitcher';

interface Crumb {
  label: string;
  to?: string;
}

/** Location shown in the top bar: Workspaces › workspace › project › section. */
function Breadcrumbs() {
  const workspaceMatch = useMatch('/workspaces/:workspaceId/*');
  const workspaceId = workspaceMatch?.params.workspaceId;
  const onWorkspaceMembers = workspaceMatch?.params['*'] === 'members';
  const onAccount = useMatch('/account') !== null;
  const projectMatch = useMatch('/projects/:projectId/:section/*');
  const projectId = projectMatch?.params.projectId;
  const section = PROJECT_SECTIONS.find((s) => s.path === projectMatch?.params.section);
  const isSectionRoot = !projectMatch?.params['*'];

  const { data: workspace } = useWorkspace(workspaceId);
  const { data: info } = useProjectInfo(projectId);

  const crumbs: Crumb[] = [
    { label: 'Workspaces', to: workspaceId || projectId || onAccount ? '/workspaces' : undefined },
  ];
  if (onAccount) crumbs.push({ label: 'Account' });
  if (workspace) {
    crumbs.push({
      label: workspace.name,
      to: onWorkspaceMembers ? `/workspaces/${workspace.id}` : undefined,
    });
    if (onWorkspaceMembers) crumbs.push({ label: 'Members' });
  }
  if (info) {
    crumbs.push({ label: info.workspace.name, to: `/workspaces/${info.workspace.id}` });
    crumbs.push({ label: info.project.name, to: `/projects/${info.project.id}/cases` });
    if (section) {
      crumbs.push({
        label: section.label,
        to: isSectionRoot ? undefined : `/projects/${info.project.id}/${section.path}`,
      });
    }
  }
  // The last item without a link is the current page (aria-current). On subpages such as
  // run detail the section also stays a link; the page name is already in the h1.
  const last = crumbs.length - 1;

  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      <ol>
        {crumbs.map((crumb, i) => (
          <li key={`${crumb.label}-${i}`}>
            {i > 0 && <ChevronRight size={14} aria-hidden="true" className="crumb-sep" />}
            {crumb.to ? (
              <Link to={crumb.to}>{crumb.label}</Link>
            ) : (
              <span aria-current={i === last ? 'page' : undefined}>{crumb.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Sidebar on mobile: as a native <dialog>, the focus trap and Esc come from the browser. */
function NavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="nav-drawer" aria-label="Menu" onClose={onClose}>
      <button
        type="button"
        className="icon-button icon-button--on-dark drawer-close"
        onClick={onClose}
        aria-label="Close menu"
      >
        <X size={20} aria-hidden="true" />
      </button>
      {open && <Sidebar onNavigate={onClose} />}
    </dialog>
  );
}

/** Skeleton of all signed-in pages: skip link, sidebar, top bar and content. */
export function AppShell() {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const isFirstRender = useRef(true);
  const [navOpen, setNavOpen] = useState(false);

  // In an SPA, page changes aren't announced to screen readers; move focus to the content (a11y RX2).
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [pathname]);

  return (
    <div className="shell">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <div className="sidebar">
        <Sidebar />
      </div>
      <div className="workspace">
        <header className="topbar">
          <button
            type="button"
            className="icon-button menu-button"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
            aria-expanded={navOpen}
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <Breadcrumbs />
          <ThemeSwitcher />
        </header>
        <main id="main-content" ref={mainRef} tabIndex={-1} className="main">
          <Outlet />
        </main>
      </div>
      <NavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
    </div>
  );
}
