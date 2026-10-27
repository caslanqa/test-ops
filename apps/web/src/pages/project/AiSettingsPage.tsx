import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { AiSettingsForm } from '../../components/AiSettingsForm';
import { ConfirmDialog } from '../../components/Members';
import { LoadError, Loading, PageHeader } from '../../components/Page';
import { Tag } from '../../components/StatusChip';
import {
  AI_PROVIDER_LABEL,
  type AiSource,
  type AiTestResult,
  type ProjectAiSettings,
  type SaveAiSettings,
} from '../../lib/ai';
import { useNotice } from '../../lib/notice';
import { useProjectInfo } from '../../lib/projectInfo';
import { usePageTitle, useResource } from '../../lib/useResource';

const SOURCE_LABEL: Record<AiSource, string> = {
  PROJECT: 'This project’s own setting',
  WORKSPACE: 'The workspace default',
  NONE: 'None: AI is off for this project',
};

/**
 * Which AI provider this project drafts with, for project admins (a workspace admin counts as one). The project
 * can use the workspace default or define its own setting, which replaces the default completely.
 */
export function AiSettingsPage() {
  const { projectId = '' } = useParams();
  const { notify } = useNotice();
  const { data: info } = useProjectInfo(projectId);
  usePageTitle(info ? `AI (${info.project.name})` : 'AI');
  const [removing, setRemoving] = useState(false);
  const { data, error, reload } = useResource(
    () => api.get<ProjectAiSettings>(`/projects/${projectId}/ai/settings`),
    [projectId],
  );

  return (
    <>
      <PageHeader title="AI" description="Which AI provider drafts test cases for this project." />
      {error && <LoadError message={error} onRetry={reload} />}
      {!data && !error && <Loading />}
      {data && (
        <>
          <section className="surface integrations-section" aria-labelledby="ai-applies-heading">
            <h2 id="ai-applies-heading" className="section-title">Applies now</h2>
            <p>
              <Tag tone={data.source === 'NONE' ? 'outline' : 'strong'}>{SOURCE_LABEL[data.source]}</Tag>
            </p>
            {data.inherited && (
              <dl className="detail-list" aria-label="The workspace default">
                <div><dt>Workspace default</dt><dd>{AI_PROVIDER_LABEL[data.inherited.provider]}, model <code>{data.inherited.model}</code></dd></div>
                <div><dt>Endpoint</dt><dd>{data.inherited.endpoint ?? 'Public API'}</dd></div>
                <div><dt>Provider key</dt><dd>{data.inherited.hasCredential ? 'Saved (not shown)' : 'None'}</dd></div>
                <div><dt>Status</dt><dd>{data.inherited.enabled ? 'On' : 'Off'}</dd></div>
              </dl>
            )}
            {!data.inherited && <p className="muted">The workspace has no default; this project uses AI only if it defines its own setting below.</p>}
          </section>
          <section className="surface integrations-section" aria-labelledby="ai-own-heading">
            <h2 id="ai-own-heading" className="section-title">This project&rsquo;s setting</h2>
            <p className="muted">
              A project setting replaces the workspace default completely: its own provider, model, endpoint and key,
              with nothing taken from the default. The workspace&rsquo;s key is never used with another endpoint.
            </p>
            <AiSettingsForm
              key={data.own?.id ?? 'new'}
              view={data.own}
              onSave={(body: SaveAiSettings) => api.put(`/projects/${projectId}/ai/settings`, body)}
              onTest={() => api.post<AiTestResult>(`/projects/${projectId}/ai/settings/test`)}
              onChanged={reload}
              extra={
                data.own && (
                  <button type="button" className="btn btn-ghost" onClick={() => setRemoving(true)}>
                    Use the workspace default
                  </button>
                )
              }
            />
          </section>
        </>
      )}
      <ConfirmDialog
        open={removing}
        title="Use the workspace default?"
        message="This project's own setting, with its key, is deleted. Runs that are waiting or in progress fail and have to be started again."
        confirmLabel="Use the workspace default"
        onClose={() => setRemoving(false)}
        onConfirm={async () => {
          await api.delete(`/projects/${projectId}/ai/settings`);
          setRemoving(false);
          notify('This project now uses the workspace default.');
          reload();
        }}
      />
    </>
  );
}
