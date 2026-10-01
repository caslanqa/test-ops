import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client';

interface Suite {
  id: string;
  name: string;
}

interface TestCase {
  id: string;
  title: string;
  priority: string;
  suiteId: string | null;
}

export function SuitesCasesPage() {
  const { projectId = '' } = useParams();
  const [suites, setSuites] = useState<Suite[]>([]);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [selectedSuiteId, setSelectedSuiteId] = useState<string | undefined>();
  const [suiteName, setSuiteName] = useState('');
  const [caseTitle, setCaseTitle] = useState('');

  function loadSuites() {
    api.get<Suite[]>(`/projects/${projectId}/suites`).then(setSuites);
  }

  function loadCases() {
    const query = selectedSuiteId ? `?suiteId=${selectedSuiteId}` : '';
    api
      .get<TestCase[]>(`/projects/${projectId}/cases${query}`)
      .then(setCases);
  }

  useEffect(loadSuites, [projectId]);
  useEffect(loadCases, [projectId, selectedSuiteId]);

  async function onCreateSuite(e: FormEvent) {
    e.preventDefault();
    await api.post(`/projects/${projectId}/suites`, { name: suiteName });
    setSuiteName('');
    loadSuites();
  }

  async function onCreateCase(e: FormEvent) {
    e.preventDefault();
    await api.post(`/projects/${projectId}/cases`, {
      title: caseTitle,
      suiteId: selectedSuiteId,
    });
    setCaseTitle('');
    loadCases();
  }

  return (
    <div className="split">
      <aside>
        <h2>Suite&apos;ler</h2>
        <ul className="list">
          <li>
            <button
              className={!selectedSuiteId ? 'active' : ''}
              onClick={() => setSelectedSuiteId(undefined)}
            >
              (tümü)
            </button>
          </li>
          {suites.map((s) => (
            <li key={s.id}>
              <button
                className={selectedSuiteId === s.id ? 'active' : ''}
                onClick={() => setSelectedSuiteId(s.id)}
              >
                {s.name}
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={onCreateSuite} className="card">
          <input
            placeholder="Yeni suite adı"
            value={suiteName}
            onChange={(e) => setSuiteName(e.target.value)}
            required
          />
          <button type="submit">Ekle</button>
        </form>
      </aside>
      <section>
        <h2>Test Case&apos;ler</h2>
        <ul className="list">
          {cases.map((c) => (
            <li key={c.id}>
              {c.title} <span className="badge">{c.priority}</span>
            </li>
          ))}
        </ul>
        <form onSubmit={onCreateCase} className="card">
          <input
            placeholder="Yeni test case başlığı"
            value={caseTitle}
            onChange={(e) => setCaseTitle(e.target.value)}
            required
          />
          <button type="submit">Ekle</button>
        </form>
      </section>
    </div>
  );
}
