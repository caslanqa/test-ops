import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';

interface Run {
  id: string;
  title: string;
  status: string;
}

interface Plan {
  id: string;
  title: string;
}

export function RunsPage() {
  const { projectId = '' } = useParams();
  const [runs, setRuns] = useState<Run[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [title, setTitle] = useState('');
  const [planId, setPlanId] = useState('');

  function load() {
    api.get<Run[]>(`/projects/${projectId}/runs`).then(setRuns);
    api.get<Plan[]>(`/projects/${projectId}/plans`).then(setPlans);
  }

  useEffect(load, [projectId]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    await api.post(`/projects/${projectId}/runs`, {
      title,
      planId: planId || undefined,
    });
    setTitle('');
    setPlanId('');
    load();
  }

  return (
    <section>
      <h1>Runs</h1>
      <ul className="list">
        {runs.map((r) => (
          <li key={r.id}>
            <Link to={`/projects/${projectId}/runs/${r.id}`}>{r.title}</Link>{' '}
            <span className="badge">{r.status}</span>
          </li>
        ))}
      </ul>
      <form onSubmit={onCreate} className="card">
        <h2>Yeni run</h2>
        <input
          placeholder="Başlık"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <label>
          Plan (opsiyonel)
          <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">Ad hoc (case seçimi yok)</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Başlat</button>
      </form>
    </section>
  );
}
