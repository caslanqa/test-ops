import { Navigate, Outlet, useParams } from 'react-router-dom';
import { useProjectInfo } from '../lib/projectInfo';
import type { ProjectRole } from '../lib/labels';
import { LoadError, Loading } from './Page';

/**
 * The pages nested in this route are for the given project roles (a workspace admin counts as ADMIN):
 * members for project admins, integrations also for Automation users. Anyone else is sent to the project's
 * Test cases: they have nothing to do there, and the menu doesn't show these pages to them either. The
 * server checks the role as well; this only keeps the pages out of sight.
 */
export function ProjectRoleRoute({ roles }: { roles: readonly ProjectRole[] }) {
  const { projectId = '' } = useParams();
  const { data: info, error, reload } = useProjectInfo(projectId);
  if (error) return <LoadError message={error} onRetry={reload} />;
  if (!info) return <Loading />;
  const role = info.project.currentUserRole;
  if (!role || !roles.includes(role)) return <Navigate to={`/projects/${projectId}/cases`} replace />;
  return <Outlet />;
}
