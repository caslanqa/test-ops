import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client';

interface Requirement {
  id: string;
  title: string;
  cases: { testCase: { id: string; title: string } }[];
}

interface TestCase {
  id: string;
  title: string;
}

export function RequirementsPage() {
  const { projectId = '' } = useParams();
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [title, setTitle] = useState('');

  function load() {
    api
      .get<Requirement[]>(`/projects/${projectId}/requirements`)
      .then(setRequirements);
    api.get<TestCase[]>(`/projects/${projectId}/cases`).then(setCases);
  }

  useEffect(load, [projectId]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    await api.post(`/projects/${projectId}/requirements`, { title });
    setTitle('');
    load();
  }

  async function onLinkCase(requirementId: string, testCaseId: string) {
    if (!testCaseId) return;
    await api.post(`/projects/${projectId}/requirements/${requirementId}/cases`, {
      testCaseIds: [testCaseId],
    });
    load();
  }

  return (
    <section>
      <h1>Requirements</h1>
      <ul className="list">
        {requirements.map((r) => (
          <li key={r.id} className="card">
            <strong>{r.title}</strong>
            <ul>
              {r.cases.map((c) => (
                <li key={c.testCase.id}>{c.testCase.title}</li>
              ))}
            </ul>
            <select
              defaultValue=""
              onChange={(e) => onLinkCase(r.id, e.target.value)}
            >
              <option value="" disabled>
                Case bağla...
              </option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      <form onSubmit={onCreate} className="card">
        <h2>Yeni requirement</h2>
        <input
          placeholder="Başlık"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <button type="submit">Oluştur</button>
      </form>
    </section>
  );
}
