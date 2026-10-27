import { useId, useRef, useState, type ChangeEvent } from 'react';
import { FileUp, History, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import {
  GUIDANCE_KIND_LABEL,
  statsText,
  stepsText,
  type BuiltinGuidanceView,
  type GuidanceStatsRow,
  type GuidanceList,
  type GuidanceView,
  type ImportPreview,
  type InheritedGuidanceView,
} from '../lib/guidance';
import { useFocusFallback } from '../lib/focus';
import { useNotice } from '../lib/notice';
import { useResource } from '../lib/useResource';
import { GuidanceDialog, type GuidanceDraftSource } from './GuidanceDialog';
import { GuidanceHistory } from './GuidanceHistory';
import { GuidancePreview } from './GuidancePreview';
import { ConfirmDialog } from './Members';
import { FormError, LoadError, Loading } from './Page';
import { Tag } from './StatusChip';

export type GuidanceScope = { kind: 'WORKSPACE' | 'PROJECT'; id: string };

const sourceText = (guidance: GuidanceView) =>
  guidance.sourceKind === 'UPLOADED' ? `${guidance.sourceName ?? 'A file'}${guidance.license ? ` · ${guidance.license}` : ''}` : 'Written here';

/**
 * The team's guidance for the assistant, for workspace admins (the workspace's, shared by all its projects) and
 * project admins (the project's own, with the workspace's shown and switchable for the project). It adds to what the
 * assistant is told: the answer format and the rules of the step always win, which the server enforces.
 */
export function GuidanceSection({ scope }: { scope: GuidanceScope }) {
  const base = scope.kind === 'WORKSPACE' ? `/workspaces/${scope.id}/ai/guidance` : `/projects/${scope.id}/ai/guidance`;
  const { notify } = useNotice();
  const headingId = useId();
  const list = useResource(() => api.get<GuidanceList>(base), [base]);
  // How each guidance did in the project's judged comparisons; only a project has comparisons.
  const counts = useResource(
    () => (scope.kind === 'PROJECT' ? api.get<GuidanceStatsRow[]>(`/projects/${scope.id}/ai/guidance/stats`).catch(() => []) : Promise.resolve([])),
    [scope.kind, scope.id],
  );
  const countsText = (ref: string) => statsText((counts.data ?? []).find((row) => row.ref === ref));
  const [editing, setEditing] = useState<GuidanceDraftSource | null>(null);
  const [history, setHistory] = useState<GuidanceView | null>(null);
  const [removing, setRemoving] = useState<GuidanceView | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState<string | null>(null);
  // A switch shows its new state at once and not after the list is read again: what was switched belongs to the list
  // it was switched in, so a fresh list drops it, and a failure puts it back.
  const [switchedIn, setSwitchedIn] = useState<{ list: unknown; values: Record<string, boolean> }>({ list: undefined, values: {} });
  const switched = switchedIn.list === list.data ? switchedIn.values : {};
  const setSwitch = (id: string, on: boolean) => setSwitchedIn({ list: list.data, values: { ...switched, [id]: on } });
  const fileInput = useRef<HTMLInputElement>(null);
  // A deleted row takes its button with it: focus goes to the section's heading, not to the top of the page.
  const requestFocus = useFocusFallback(list.data, () => document.getElementById(headingId));
  const own = list.data?.own ?? [];
  const inherited = list.data?.inherited ?? [];
  const where = scope.kind === 'WORKSPACE' ? 'workspace' : 'project';

  const run = async (action: () => Promise<unknown>, done: string) => {
    setError(null);
    try {
      await action();
      setAnnouncement(done);
      list.reload();
    } catch (err) {
      setSwitchedIn({ list: undefined, values: {} });
      setError(err instanceof Error ? err.message : "Couldn't make the change");
    }
  };

  const setEnabled = (guidance: GuidanceView, enabled: boolean) => {
    setSwitch(guidance.id, enabled);
    return run(() => api.patch(`${base}/${guidance.id}`, { enabled }), `${guidance.title} switched ${enabled ? 'on' : 'off'}.`);
  };
  /** A pack on or off for the owner; `null` clears a project's own switch, so it follows the workspace again. */
  const setPack = (pack: BuiltinGuidanceView, enabled: boolean | null) => {
    if (enabled !== null) setSwitch(`builtin:${pack.key}`, enabled);
    const words = enabled === null ? 'follows the workspace again' : `switched ${enabled ? 'on' : 'off'}${scope.kind === 'PROJECT' ? ' for this project' : ''}`;
    return run(() => api.put(`${base}/toggles`, { builtinKey: pack.key, enabled }), `${pack.title} ${words}.`);
  };
  const setHere = (guidance: InheritedGuidanceView, enabled: boolean) => {
    setSwitch(guidance.id, enabled);
    return run(() => api.put(`${base}/toggles`, { guidanceId: guidance.id, enabled }), `${guidance.title} switched ${enabled ? 'on' : 'off'} for this project.`);
  };

  /** Reads a markdown file in the browser and asks the server what it would make; nothing is saved yet. */
  async function chooseFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const preview = await api.post<ImportPreview>(`${base}/import/preview`, { fileName: file.name, content: await file.text() });
      setEditing({ preview });
    } catch (err) {
      setError(`${file.name}: ${err instanceof Error ? err.message : "couldn't read the file"}`);
    }
  }

  return (
    <>
      <section className="surface integrations-section" aria-labelledby={headingId}>
        <h2 id={headingId} className="section-title" tabIndex={-1}>Guidance</h2>
        <p className="muted">
          {scope.kind === 'WORKSPACE'
            ? 'Advice for the assistant that every project of this workspace is given: how your team names and designs test cases, what a good case looks like. '
            : 'Advice for the assistant that applies to this project, added to the workspace’s guidance. '}
          It is added to the prompt of each step you choose; the answer format and the rules of the step always win. It is sent to the AI provider along with the requirement.
        </p>
        <p role="status" className="visually-hidden">{announcement}</p>
        <FormError message={error} />
        {list.error && <LoadError message={list.error} onRetry={list.reload} />}
        {list.loading && <Loading />}
        {list.data && (
          <>
            <div className="form-buttons">
              <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>
                <Plus size={16} aria-hidden="true" />
                New guidance
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => fileInput.current?.click()}>
                <FileUp size={16} aria-hidden="true" />
                Add from a markdown file
              </button>
              <input ref={fileInput} type="file" hidden accept=".md,.markdown,text/markdown,text/plain" onChange={chooseFile} aria-label="Markdown file with guidance" />
            </div>
            {own.length === 0 && <p className="muted">No guidance written for this {where} yet.</p>}
            {own.length > 0 && (
              <div className="table-wrap">
                <table className="data-table">
                  <caption className="visually-hidden">Guidance of this {where}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="col-main">Guidance</th>
                      <th scope="col">Kind</th>
                      <th scope="col">Steps</th>
                      <th scope="col">Source</th>
                      <th scope="col">Size</th>
                      <th scope="col">On</th>
                      <th scope="col"><span className="visually-hidden">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {own.map((guidance) => (
                      <tr key={guidance.id}>
                        <td>
                          {guidance.title}
                          {guidance.summary && <p className="cell-sub">{guidance.summary}</p>}
                          {countsText(guidance.id) && <p className="cell-sub">{countsText(guidance.id)}</p>}
                        </td>
                        <td>{GUIDANCE_KIND_LABEL[guidance.kind]}</td>
                        <td>{stepsText(guidance.steps)}</td>
                        <td>{sourceText(guidance)}</td>
                        <td>about {guidance.estimatedTokens} tokens · v{guidance.version}</td>
                        <td>
                          <input type="checkbox" checked={switched[guidance.id] ?? guidance.enabled} aria-label={`Use ${guidance.title}`} onChange={(e) => setEnabled(guidance, e.target.checked)} />
                        </td>
                        <td className="cell-actions">
                          <button type="button" className="icon-button" onClick={() => setEditing({ guidance })} aria-label={`Edit ${guidance.title}`} title="Edit">
                            <Pencil size={16} aria-hidden="true" />
                          </button>
                          <button type="button" className="icon-button" onClick={() => setHistory(guidance)} aria-label={`History of ${guidance.title}`} title="History">
                            <History size={16} aria-hidden="true" />
                          </button>
                          <button type="button" className="icon-button" onClick={() => setRemoving(guidance)} aria-label={`Delete ${guidance.title}`} title="Delete">
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {scope.kind === 'PROJECT' && inherited.length > 0 && (
              <>
                <h3 className="section-title">From the workspace</h3>
                <p className="muted">Written by the workspace admins. You can switch one off for this project alone; the workspace keeps it.</p>
                <div className="table-wrap">
                  <table className="data-table">
                    <caption className="visually-hidden">Guidance of the workspace, for this project</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="col-main">Guidance</th>
                        <th scope="col">Steps</th>
                        <th scope="col">Size</th>
                        <th scope="col">On for this project</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inherited.map((guidance) => (
                        <tr key={guidance.id}>
                          <td>
                            {guidance.title} {!guidance.enabled && <Tag tone="outline">Off in the workspace</Tag>}
                            {guidance.summary && <p className="cell-sub">{guidance.summary}</p>}
                            {countsText(guidance.id) && <p className="cell-sub">{countsText(guidance.id)}</p>}
                          </td>
                          <td>{stepsText(guidance.steps)}</td>
                          <td>about {guidance.estimatedTokens} tokens</td>
                          <td>
                            <input
                              type="checkbox"
                              checked={switched[guidance.id] ?? guidance.enabledHere}
                              disabled={!guidance.enabled}
                              aria-label={`Use ${guidance.title} in this project`}
                              onChange={(e) => setHere(guidance, e.target.checked)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <h3 className="section-title">Built-in packs</h3>
            <p className="muted">
              Short guidance that ships with TestOps, off until you switch it on
              {scope.kind === 'PROJECT' ? ' (here, or for the whole workspace)' : ' for every project of this workspace'}. Where one is adapted from
              elsewhere, its source and licence are shown.
            </p>
            <div className="table-wrap">
              <table className="data-table">
                <caption className="visually-hidden">Built-in guidance packs</caption>
                <thead>
                  <tr>
                    <th scope="col" className="col-main">Pack</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Steps</th>
                    <th scope="col">Source</th>
                    <th scope="col">Size</th>
                    <th scope="col">On</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.builtin.map((pack) => (
                    <tr key={pack.key}>
                      <td>
                        {pack.title}
                        <p className="cell-sub">{pack.summary}</p>
                        {countsText(`builtin:${pack.key}`) && <p className="cell-sub">{countsText(`builtin:${pack.key}`)}</p>}
                        <details>
                          <summary>Read the text of {pack.title}</summary>
                          {/* Plain text, shown as text. */}
                          <pre className="guidance-text">{pack.body}</pre>
                        </details>
                      </td>
                      <td>{GUIDANCE_KIND_LABEL[pack.kind]}</td>
                      <td>{stepsText(pack.steps)}</td>
                      <td>{pack.origin} · {pack.license}</td>
                      <td>about {pack.estimatedTokens} tokens</td>
                      <td>
                        <input
                          type="checkbox"
                          checked={switched[`builtin:${pack.key}`] ?? pack.enabled}
                          aria-label={scope.kind === 'PROJECT' ? `Use ${pack.title} in this project` : `Use ${pack.title}`}
                          onChange={(e) => setPack(pack, e.target.checked)}
                        />
                        {scope.kind === 'PROJECT' && (
                          <p className="cell-sub">
                            {pack.setByProject ? (
                              <>
                                Set for this project.{' '}
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPack(pack, null)}>
                                  Follow the workspace
                                  <span className="visually-hidden"> for {pack.title}</span>
                                </button>
                              </>
                            ) : (
                              'Follows the workspace.'
                            )}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      {scope.kind === 'PROJECT' && list.data && <GuidancePreview projectId={scope.id} list={list.data} />}
      <GuidanceDialog
        base={base}
        source={editing}
        onClose={() => setEditing(null)}
        onSaved={(message) => {
          setEditing(null);
          setAnnouncement(message);
          notify(message);
          list.reload();
        }}
      />
      <GuidanceHistory base={base} guidance={history} onClose={() => setHistory(null)} />
      <ConfirmDialog
        open={removing !== null}
        title="Delete this guidance?"
        message={`“${removing?.title ?? ''}” and its versions are deleted. Runs that already used it keep what they were sent.`}
        confirmLabel="Delete guidance"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          requestFocus();
          await api.delete(`${base}/${removing.id}`);
          setAnnouncement(`${removing.title} deleted.`);
          setRemoving(null);
          list.reload();
        }}
      />
    </>
  );
}
