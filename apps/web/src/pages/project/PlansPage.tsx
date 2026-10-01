import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client';

interface Plan {
  id: string;
  title: string;
  items: { testCaseId: string }[];
}

interface TestCase {
  id: string;
  title: string;
}

export function PlansPage() {
  const { projectId = '' } = useParams();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [title, setTitle] = useState('');
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);

  function load() {
    api.get<Plan[]>(`/projects/${projectId}/plans`).then(setPlans);
    api.get<TestCase[]>(`/projects/${projectId}/cases`).then(setCases);
  }

  useEffect(load, [projectId]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    await api.post(`/projects/${projectId}/plans`, {
      title,
      testCaseIds: selectedCaseIds,
    });
    setTitle('');
    setSelectedCaseIds([]);
    load();
  }

  return (
    <section>
      <h1>Plans</h1>
      <ul className="list">
        {plans.map((p) => (
          <li key={p.id} className="card">
            <strong>{p.title}</strong> — {p.items.length} case
          </li>
        ))}
      </ul>
      <form onSubmit={onCreate} className="card">
        <h2>Yeni plan</h2>
        <input
          placeholder="Başlık"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <label>
          Case&apos;ler
          <select
            multiple
            value={selectedCaseIds}
            onChange={(e) =>
              setSelectedCaseIds(
                Array.from(e.target.selectedOptions, (o) => o.value),
              )
            }
          >
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Oluştur</button>
      </form>
    </section>
  );
}
