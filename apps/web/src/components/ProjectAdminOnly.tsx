import { Navigate, Outlet, useParams } from 'react-router-dom';
import { useProjectInfo } from '../lib/projectInfo';
import { LoadError, Loading } from './Page';

/**
 * The pages nested in this route are for project admins (members, integrations). Anyone else is sent to
 * the project's Test cases: they have nothing to do there, and the menu doesn't show these pages to them
 * either. The server checks the role as well; this only keeps the pages out of sight.
 */
export function ProjectAdminOnly() {
  const { projectId = '' } = useParams();
  const { data: info, error, reload } = useProjectInfo(projectId);
  if (error) return <LoadError message={error} onRetry={reload} />;
  if (!info) return <Loading />;
  if (info.project.currentUserRole !== 'ADMIN') return <Navigate to={`/projects/${projectId}/cases`} replace />;
  return <Outlet />;
}
