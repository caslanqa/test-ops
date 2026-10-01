import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client';

const STATUSES = ['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED'] as const;

interface RunCase {
  id: string;
  testCaseId: string;
  status: string;
  testCase: { id: string; title: string };
}

interface RunDetail {
  id: string;
  title: string;
  status: string;
  runCases: RunCase[];
  progress: Record<string, number>;
}

interface ResultRow {
  id: string;
  runCase: { testCaseId: string };
}

export function RunDetailPage() {
  const { projectId = '', runId = '' } = useParams();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [latestResultByCase, setLatestResultByCase] = useState<
    Record<string, string>
  >({});

  function load() {
    api
      .get<RunDetail>(`/projects/${projectId}/runs/${runId}`)
      .then(setRun);
    api
      .get<ResultRow[]>(`/projects/${projectId}/runs/${runId}/results`)
      .then((results) => {
        const map: Record<string, string> = {};
        for (const r of results) map[r.runCase.testCaseId] = r.id;
        setLatestResultByCase(map);
      });
  }

  useEffect(load, [projectId, runId]);

  async function markResult(testCaseId: string, status: string) {
    await api.post(`/projects/${projectId}/runs/${runId}/results`, {
      testCaseId,
      status,
      source: 'MANUAL',
    });
    load();
  }

  async function completeRun() {
    await api.post(`/projects/${projectId}/runs/${runId}/complete`);
    load();
  }

  async function createDefect(testCaseId: string, title: string) {
    const resultId = latestResultByCase[testCaseId];
    await api.post(`/projects/${projectId}/defects`, {
      title: `Failed: ${title}`,
      resultIds: resultId ? [resultId] : [],
    });
    alert('Defect oluşturuldu');
  }

  if (!run) return <p>Yükleniyor...</p>;

  return (
    <section>
      <h1>{run.title}</h1>
      <p>
        Durum: <span className="badge">{run.status}</span>{' '}
        {run.status !== 'COMPLETED' && (
          <button onClick={completeRun}>Run&apos;ı tamamla</button>
        )}
      </p>
      <p>
        {Object.entries(run.progress).map(([status, count]) => (
          <span key={status} className="badge">
            {status}: {count}
          </span>
        ))}
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Test case</th>
            <th>Durum</th>
            <th>İşlemler</th>
          </tr>
        </thead>
        <tbody>
          {run.runCases.map((rc) => (
            <tr key={rc.id}>
              <td>{rc.testCase.title}</td>
              <td>
                <span className="badge">{rc.status}</span>
              </td>
              <td>
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    disabled={run.status === 'COMPLETED'}
                    onClick={() => markResult(rc.testCaseId, s)}
                  >
                    {s}
                  </button>
                ))}
                {rc.status === 'FAILED' && (
                  <button
                    onClick={() =>
                      createDefect(rc.testCaseId, rc.testCase.title)
                    }
                  >
                    Defect aç
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
