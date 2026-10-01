import { NavLink, Outlet, useParams } from 'react-router-dom';
import { AppHeader } from '../../components/AppHeader';

export function ProjectLayout() {
  const { projectId = '' } = useParams();
  const base = `/projects/${projectId}`;

  return (
    <>
      <AppHeader />
      <nav className="project-nav">
        <NavLink to={`${base}/cases`}>Test Repository</NavLink>
        <NavLink to={`${base}/requirements`}>Requirements</NavLink>
        <NavLink to={`${base}/plans`}>Plans</NavLink>
        <NavLink to={`${base}/runs`}>Runs</NavLink>
        <NavLink to={`${base}/defects`}>Defects</NavLink>
      </nav>
      <main className="page">
        <Outlet />
      </main>
    </>
  );
}
