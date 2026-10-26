import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { api } from '../api/client';
import { AiSettingsForm } from '../components/AiSettingsForm';
import { ConfirmDialog } from '../components/Members';
import { EmptyState, LoadError, Loading, PageHeader } from '../components/Page';
import type { AiSettingsView, AiTestResult, SaveAiSettings } from '../lib/ai';
import { useNotice } from '../lib/notice';
import { useWorkspace } from '../lib/projectInfo';
import { usePageTitle, useResource } from '../lib/useResource';
import { WorkspaceTabs } from './WorkspaceMembersPage';

/**
 * The AI provider the projects of a workspace use unless a project sets its own, for workspace admins. It says
 * where project data may be sent and holds a provider key, so the server allows it to workspace admins only.
 */
export function WorkspaceAiPage() {
  const { workspaceId = '' } = useParams();
  const { notify } = useNotice();
  const { data: workspace, loading } = useWorkspace(workspaceId);
  usePageTitle(workspace ? `AI (${workspace.name})` : 'AI');
  const isAdmin = workspace?.currentUserRole === 'ADMIN';
  const [removing, setRemoving] = useState(false);
  const settings = useResource(
    () => (isAdmin ? api.get<{ settings: AiSettingsView | null }>(`/workspaces/${workspaceId}/ai`) : Promise.resolve(undefined)),
    [workspaceId, isAdmin],
  );
  const view = settings.data?.settings ?? null;

  return (
    <>
      <PageHeader
        title={workspace?.name ?? 'Workspace'}
        description="The AI provider the projects of this workspace use, unless a project defines its own."
      />
      <WorkspaceTabs workspaceId={workspaceId} />
      {loading && <Loading />}
      {workspace && !isAdmin && (
        <div className="surface">
          <EmptyState icon={Sparkles} title="Only workspace admins can set up AI">
            Ask a workspace admin to define the AI provider for this workspace.
          </EmptyState>
        </div>
      )}
      {isAdmin && settings.error && <LoadError message={settings.error} onRetry={settings.reload} />}
      {isAdmin && settings.data && (
        <section className="surface integrations-section" aria-labelledby="ai-heading">
          <h2 id="ai-heading" className="section-title">Workspace default</h2>
          <p className="muted">
            Projects use this unless a project admin defines the project&rsquo;s own setting, which then replaces this one
            completely. The key is stored encrypted and is only ever sent to the endpoint saved with it.
          </p>
          <AiSettingsForm
            key={view?.id ?? 'new'}
            view={view}
            onSave={(body: SaveAiSettings) => api.put(`/workspaces/${workspaceId}/ai`, body)}
            onTest={() => api.post<AiTestResult>(`/workspaces/${workspaceId}/ai/test`)}
            onChanged={settings.reload}
            extra={
              view && (
                <button type="button" className="btn btn-ghost" onClick={() => setRemoving(true)}>
                  Remove the default
                </button>
              )
            }
          />
        </section>
      )}
      <ConfirmDialog
        open={removing}
        title="Remove the workspace default?"
        message="Projects without a setting of their own can no longer use AI. Their runs in progress fail."
        confirmLabel="Remove the default"
        onClose={() => setRemoving(false)}
        onConfirm={async () => {
          await api.delete(`/workspaces/${workspaceId}/ai`);
          setRemoving(false);
          notify('Workspace AI settings removed.');
          settings.reload();
        }}
      />
    </>
  );
}
