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

const TABS = ['reporter', 'webhook', 'github'] as const;
type TabId = (typeof TABS)[number];

/**
 * How a project connects to CI, in two directions: the Playwright reporter sends results to TestOps, and the
 * CI webhook lets TestOps start CI. Each has its own tab; the selected tab is `?tab=` in the address, so a
 * link can point at one. Only project admins reach this page (see ProjectAdminOnly).
 */
export function IntegrationsPage() {
  const { projectId = '' } = useParams();
  const { data: info } = useProjectInfo(projectId);
  usePageTitle(info ? `Integrations (${info.project.name})` : 'Integrations');
  const [params, setParams] = useSearchParams();
  const settings = useResource(
    () => api.get<{ webhook: WebhookSettings | null }>(`/projects/${projectId}/webhook`),
    [projectId],
  );
  const webhook = settings.data?.webhook ?? null;
  // An unknown value in the address falls back to the first tab.
  const active: TabId = TABS.find((id) => id === params.get('tab')) ?? 'reporter';

  if (settings.error) return <LoadError message={settings.error} onRetry={settings.reload} />;
  if (!settings.data) return <Loading />;

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
        tabs={[
          { id: 'reporter', label: 'Playwright reporter', panel: <PlaywrightGuide projectId={projectId} /> },
          {
            id: 'webhook',
            label: (
              <>
                CI webhook{' '}
                {webhook && <Tag tone={webhook.enabled ? 'strong' : 'outline'}>{webhook.enabled ? 'On' : 'Off'}</Tag>}
              </>
            ),
            panel: <WebhookPanel projectId={projectId} webhook={webhook} reload={settings.reload} />,
          },
          { id: 'github', label: 'GitHub Actions', panel: <GithubActionsGuide /> },
        ]}
      />
    </>
  );
}
