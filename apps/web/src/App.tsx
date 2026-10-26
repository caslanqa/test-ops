import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { AppShell } from './components/AppShell';
import { ProjectRoleRoute } from './components/ProjectRoleRoute';
import { AI_ROLES, INTEGRATIONS_ROLES, MEMBERS_ROLES } from './lib/sections';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { InvitePage } from './pages/InvitePage';
import { AccountPage } from './pages/AccountPage';
import { SupportPage } from './pages/SupportPage';
import { WorkspaceMembersPage } from './pages/WorkspaceMembersPage';
import { WorkspaceSettingsPage } from './pages/WorkspaceSettingsPage';
import { WorkspaceAiPage } from './pages/WorkspaceAiPage';
import { AiSettingsPage } from './pages/project/AiSettingsPage';
import { ProjectMembersPage } from './pages/project/ProjectMembersPage';
import { IntegrationsPage } from './pages/project/IntegrationsPage';
import { WorkspacesPage } from './pages/WorkspacesPage';
import { WorkspaceDetailPage } from './pages/WorkspaceDetailPage';
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
        <Route path="/register" element={<RegisterPage />} />
        {/* Open without signing in: the invited person may not have an account yet. */}
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route element={<ProtectedRoute />}>
          {/* Sidebar and top bar are shared by all signed-in pages; project navigation is in the sidebar. */}
          <Route element={<AppShell />}>
            <Route path="/workspaces" element={<WorkspacesPage />} />
            <Route path="/workspaces/:workspaceId" element={<WorkspaceDetailPage />} />
            <Route path="/workspaces/:workspaceId/members" element={<WorkspaceMembersPage />} />
            <Route path="/workspaces/:workspaceId/settings" element={<WorkspaceSettingsPage />} />
            <Route path="/workspaces/:workspaceId/ai" element={<WorkspaceAiPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/support" element={<SupportPage />} />
            <Route path="/projects/:projectId">
              <Route index element={<Navigate to="cases" replace />} />
              <Route path="cases" element={<SuitesCasesPage />} />
              <Route path="requirements" element={<RequirementsPage />} />
              <Route path="plans" element={<PlansPage />} />
              <Route path="runs" element={<RunsPage />} />
              <Route path="runs/:runId" element={<RunDetailPage />} />
              <Route path="defects" element={<DefectsPage />} />
              <Route element={<ProjectRoleRoute roles={MEMBERS_ROLES} />}>
                <Route path="members" element={<ProjectMembersPage />} />
              </Route>
              <Route element={<ProjectRoleRoute roles={INTEGRATIONS_ROLES} />}>
                <Route path="integrations" element={<IntegrationsPage />} />
              </Route>
              <Route element={<ProjectRoleRoute roles={AI_ROLES} />}>
                <Route path="ai" element={<AiSettingsPage />} />
              </Route>
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/workspaces" replace />} />
      </Routes>
    </AuthProvider>
  );
}
