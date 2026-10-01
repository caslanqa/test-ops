import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { WorkspacesPage } from './pages/WorkspacesPage';
import { WorkspaceDetailPage } from './pages/WorkspaceDetailPage';
import { ProjectLayout } from './pages/project/ProjectLayout';
import { SuitesCasesPage } from './pages/project/SuitesCasesPage';
import { RequirementsPage } from './pages/project/RequirementsPage';
import { PlansPage } from './pages/project/PlansPage';
import { RunsPage } from './pages/project/RunsPage';
import { RunDetailPage } from './pages/project/RunDetailPage';
import { DefectsPage } from './pages/project/DefectsPage';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/workspaces" element={<WorkspacesPage />} />
          <Route path="/workspaces/:workspaceId" element={<WorkspaceDetailPage />} />
          <Route path="/projects/:projectId" element={<ProjectLayout />}>
            <Route path="cases" element={<SuitesCasesPage />} />
            <Route path="requirements" element={<RequirementsPage />} />
            <Route path="plans" element={<PlansPage />} />
            <Route path="runs" element={<RunsPage />} />
            <Route path="runs/:runId" element={<RunDetailPage />} />
            <Route path="defects" element={<DefectsPage />} />
            <Route index element={<Navigate to="cases" replace />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/workspaces" replace />} />
      </Routes>
    </AuthProvider>
  );
}
