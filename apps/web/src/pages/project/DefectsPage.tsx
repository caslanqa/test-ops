import { useParams } from 'react-router-dom';
import { Bug, ExternalLink } from 'lucide-react';
import { api } from '../../api/client';
import { EmptyState, LoadError, Loading, PageHeader } from '../../components/Page';
import { PriorityMark, Tag } from '../../components/StatusChip';
import { formatDate } from '../../lib/format';
import { DEFECT_STATUS_LABEL, labelOf } from '../../lib/labels';
import { useProjectInfo } from '../../lib/projectInfo';
import { plural } from '../../lib/format';
import { usePageTitle, useResource } from '../../lib/useResource';

interface Defect {
  id: string;
  title: string;
  status: string;
  severity: string;
  externalProvider: string | null;
  externalIssueId: string | null;
  externalUrl: string | null;
  createdAt: string;
  _count: { results: number };
}

/** Yalnızca http(s) adresleri link olarak açılır; serbest metin alanından gelen başka şemalar (javascript: vb.) engellenir. */
function safeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export function DefectsPage() {
  const { projectId = '' } = useParams();
  const { data: info } = useProjectInfo(projectId);
  usePageTitle(info ? `Defects (${info.project.name})` : 'Defects');
  const { data: defects, error, loading, reload } = useResource(
    () => api.get<Defect[]>(`/projects/${projectId}/defects`),
    [projectId],
  );
  const open = defects?.filter((d) => d.status === 'OPEN' || d.status === 'IN_PROGRESS').length ?? 0;

  return (
    <>
      <PageHeader
        title="Defects"
        description={
          defects && defects.length > 0
            ? `${plural(defects.length, 'defect')}, ${open} open.`
            : 'Bugs found during runs, linked to the results that exposed them.'
        }
      />
      {error && <LoadError message={error} onRetry={reload} />}
      {loading && <Loading />}
      {defects && defects.length === 0 && (
        <div className="surface">
          <EmptyState icon={Bug} title="No defects yet">
            Defects you create with "Create defect" on a failed case in a run are listed here.
          </EmptyState>
        </div>
      )}
      {defects && defects.length > 0 && (
        <div className="surface table-wrap">
          <table className="data-table">
            <caption className="visually-hidden">Defects</caption>
            <thead>
              <tr>
                <th scope="col" className="col-main">Defect</th>
                <th scope="col">Severity</th>
                <th scope="col">Status</th>
                <th scope="col" className="num-col hide-sm">Results</th>
                <th scope="col" className="hide-sm">External issue</th>
                <th scope="col" className="hide-sm">Created</th>
              </tr>
            </thead>
            <tbody>
              {defects.map((d) => {
                const href = safeUrl(d.externalUrl);
                const externalLabel = d.externalIssueId ?? d.externalProvider;
                return (
                  <tr key={d.id}>
                    <td><span className="cell-title">{d.title}</span></td>
                    <td><PriorityMark priority={d.severity} /></td>
                    <td>
                      <Tag tone={d.status === 'OPEN' ? 'strong' : 'neutral'}>{labelOf(DEFECT_STATUS_LABEL, d.status)}</Tag>
                    </td>
                    <td className="num-col num hide-sm">{d._count.results}</td>
                    <td className="hide-sm">
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer noopener" className="external-link">
                          {externalLabel ?? 'Open issue'}
                          <ExternalLink size={14} aria-hidden="true" />
                          <span className="visually-hidden"> (opens in a new tab)</span>
                        </a>
                      ) : (
                        <span className="muted">{externalLabel ?? '—'}</span>
                      )}
                    </td>
                    <td className="muted num hide-sm">{formatDate(d.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
