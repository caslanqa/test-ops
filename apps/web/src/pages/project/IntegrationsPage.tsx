import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { LoadError, Loading, PageHeader } from '../../components/Page';
import { Tag } from '../../components/StatusChip';
import { Tabs } from '../../components/Tabs';
import { useProjectInfo } from '../../lib/projectInfo';
import { usePageTitle, useResource } from '../../lib/useResource';
import { GithubActionsGuide } from './integrations/GithubActionsGuide';
import { PlaywrightGuide } from './integrations/PlaywrightGuide';
import { WebhookPanel, type WebhookSettings } from './integrations/WebhookPanel';

type TabId = 'reporter' | 'webhook' | 'github';

/**
 * How a project connects to CI, in two directions: the Playwright reporter sends results to TestOps, and the
 * CI webhook lets TestOps start CI. Each has its own tab; the selected tab is `?tab=` in the address, so a
 * link can point at one. Project admins and Automation users reach this page (see ProjectRoleRoute); the
 * webhook holds credentials, so its tab is for the admins only.
 */
export function IntegrationsPage() {
  const { projectId = '' } = useParams();
  const { data: info, error, reload } = useProjectInfo(projectId);
  usePageTitle(info ? `Integrations (${info.project.name})` : 'Integrations');
  if (error) return <LoadError message={error} onRetry={reload} />;
  if (!info) return <Loading />;
  // A workspace admin is ADMIN in every project of the workspace.
  return <IntegrationTabs projectId={projectId} canWebhook={info.project.currentUserRole === 'ADMIN'} />;
}

function IntegrationTabs({ projectId, canWebhook }: { projectId: string; canWebhook: boolean }) {
  const [params, setParams] = useSearchParams();
  // Only admins may read the webhook settings; for the others the server would answer 403.
  const settings = useResource(
    () =>
      canWebhook
        ? api.get<{ webhook: WebhookSettings | null }>(`/projects/${projectId}/webhook`)
        : Promise.resolve({ webhook: null }),
    [projectId, canWebhook],
  );
  const webhook = settings.data?.webhook ?? null;
  const available: TabId[] = canWebhook ? ['reporter', 'webhook', 'github'] : ['reporter', 'github'];
  // An unknown or unavailable value in the address falls back to the first tab.
  const active: TabId = available.find((id) => id === params.get('tab')) ?? 'reporter';

  if (settings.error) return <LoadError message={settings.error} onRetry={settings.reload} />;
  if (!settings.data) return <Loading />;

  const reporter = { id: 'reporter' as const, label: 'Playwright reporter', panel: <PlaywrightGuide projectId={projectId} webhookTab={canWebhook} /> };
  const github = { id: 'github' as const, label: 'GitHub Actions', panel: <GithubActionsGuide webhookTab={canWebhook} /> };
  const webhookTab = {
    id: 'webhook' as const,
    label: (
      <>
        CI webhook{' '}
        {webhook && <Tag tone={webhook.enabled ? 'strong' : 'outline'}>{webhook.enabled ? 'On' : 'Off'}</Tag>}
      </>
    ),
    panel: <WebhookPanel projectId={projectId} webhook={webhook} reload={settings.reload} />,
  };

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connect CI to TestOps and report automated test results."
      />
      <Tabs
        label="Integrations"
        active={active}
        // Replacing the entry keeps the back button for leaving the page, not for stepping through tabs.
        onChange={(id) => setParams({ tab: id }, { replace: true })}
        tabs={canWebhook ? [reporter, webhookTab, github] : [reporter, github]}
      />
    </>
  );
}
