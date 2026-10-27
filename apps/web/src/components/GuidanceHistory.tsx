import { api } from '../api/client';
import { GUIDANCE_KIND_LABEL, stepsText, type GuidanceVersion, type GuidanceView } from '../lib/guidance';
import { formatDate } from '../lib/format';
import { useResource } from '../lib/useResource';
import { Dialog } from './Dialog';
import { LoadError, Loading } from './Page';

/** Every version of a guidance, newest first: what a run was sent can be told apart from what it says today. */
export function GuidanceHistory({ base, guidance, onClose }: { base: string; guidance: GuidanceView | null; onClose: () => void }) {
  return (
    <Dialog open={guidance !== null} onClose={onClose} wide title={guidance ? `History of “${guidance.title}”` : 'History'}>
      {guidance && <Versions base={base} guidance={guidance} />}
    </Dialog>
  );
}

function Versions({ base, guidance }: { base: string; guidance: GuidanceView }) {
  const versions = useResource(() => api.get<GuidanceVersion[]>(`${base}/${guidance.id}/versions`), [base, guidance.id, guidance.version]);
  return (
    <div className="dialog-body">
      {versions.error && <LoadError message={versions.error} onRetry={versions.reload} />}
      {!versions.data && !versions.error && <Loading />}
      {versions.data && (
        <ol className="guidance-list" aria-label="Versions, newest first">
          {versions.data.map((version) => (
            <li key={version.version}>
              <p>
                <strong>Version {version.version}</strong>
                {version.version === guidance.version ? ' (current)' : ''} · {formatDate(version.createdAt)} · {GUIDANCE_KIND_LABEL[version.kind]} · {stepsText(version.steps)} · priority {version.priority}
              </p>
              <p>{version.title}</p>
              <details>
                <summary>Show the text</summary>
                {/* Plain text, shown as text: a guidance is never rendered as HTML or markdown. */}
                <pre className="guidance-text" tabIndex={0} role="region" aria-label="Guidance text">{version.body}</pre>
              </details>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
