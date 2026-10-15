import { Bot, UserRound, UserX } from 'lucide-react';
import { api } from '../../api/client';
import { LoadError, Loading } from '../../components/Page';
import { ResultRibbon } from '../../components/ResultRibbon';
import { formatDuration, plural } from '../../lib/format';
import { STATUS_META, STATUS_ORDER, normalizeCounts } from '../../lib/status';
import { useResource } from '../../lib/useResource';

/** One row of GET …/runs/{runId}/team-stats. */
interface TeamRow {
  kind: 'PERSON' | 'AUTOMATION' | 'UNASSIGNED';
  userId: string | null;
  name: string;
  /** Cases whose latest status is this row's, by status. */
  counts: Record<string, number>;
  caseCount: number;
  /** Results recorded, all attempts included, and their time together. */
  resultCount: number;
  durationMs: number;
}

const KIND_ICON = { PERSON: UserRound, AUTOMATION: Bot, UNASSIGNED: UserX } as const;

/**
 * Team stats of a run: for every person, automation and the unassigned cases, how many cases ended
 * in each status and how long the attempts took. Every case counts once, for the person who
 * recorded its latest result, or for its assignee while it waits for one; time counts every
 * attempt (see RunsService.teamStats).
 */
export function RunTeamStats({ projectId, runId }: { projectId: string; runId: string }) {
  const stats = useResource(
    () => api.get<TeamRow[]>(`/projects/${projectId}/runs/${runId}/team-stats`),
    [projectId, runId],
  );

  if (stats.error) return <LoadError message={stats.error} onRetry={stats.reload} />;
  if (!stats.data) return <Loading label="Loading team stats…" />;
  if (stats.data.length === 0) return <p className="muted">This run has no cases yet.</p>;

  const totalTime = stats.data.reduce((sum, row) => sum + row.durationMs, 0);
  return (
    <section aria-labelledby="team-stats-heading">
      <h2 id="team-stats-heading" className="visually-hidden">Team stats</h2>
      <p className="muted team-stats-note">
        Each case counts once: for whoever recorded its latest result, or for its assignee while it waits for one.
        Time spent adds up every attempt{totalTime > 0 && <> ({formatDuration(totalTime)} in all)</>}.
      </p>
      <div className="surface table-wrap">
        <table className="data-table team-stats">
          <caption className="visually-hidden">Cases and time spent per person in this run</caption>
          <thead>
            <tr>
              <th scope="col" className="col-main">Person</th>
              <th scope="col" className="col-ribbon">Cases</th>
              {STATUS_ORDER.map((status) => (
                <th key={status} scope="col" className="num hide-sm">{STATUS_META[status].label}</th>
              ))}
              <th scope="col" className="num">Time spent</th>
            </tr>
          </thead>
          <tbody>
            {stats.data.map((row) => {
              const Icon = KIND_ICON[row.kind];
              const counts = normalizeCounts(row.counts);
              return (
                <tr key={row.userId ?? row.kind}>
                  <th scope="row" className="team-stats-person">
                    <Icon size={16} aria-hidden="true" />
                    {row.name}
                  </th>
                  <td className="col-ribbon">
                    {row.caseCount > 0 ? (
                      <div className="ribbon-cell-wrap">
                        <ResultRibbon counts={row.counts} size="md" label={row.name} showCounts />
                        <span className="ribbon-fraction num">{plural(row.caseCount, 'case')}</span>
                      </div>
                    ) : (
                      <span className="muted">No cases now</span>
                    )}
                  </td>
                  {STATUS_ORDER.map((status) => (
                    <td key={status} className={`num hide-sm${counts[status] === 0 ? ' muted' : ''}`}>{counts[status]}</td>
                  ))}
                  <td className="num">
                    {row.resultCount > 0 ? (
                      <>
                        {formatDuration(row.durationMs)}
                        <p className="cell-sub">{plural(row.resultCount, 'result')}</p>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
