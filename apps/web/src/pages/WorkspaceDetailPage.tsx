import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { AppHeader } from '../components/AppHeader';

interface Project {
  id: string;
  key: string;
  name: string;
}

export function WorkspaceDetailPage() {
  const { workspaceId = '' } = useParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .get<Project[]>(`/workspaces/${workspaceId}/projects`)
      .then(setProjects);
  }

  useEffect(load, [workspaceId]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/workspaces/${workspaceId}/projects`, { key, name });
      setKey('');
      setName('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Oluşturulamadı');
    }
  }

  return (
    <>
      <AppHeader />
      <main className="page">
        <p>
          <Link to="/workspaces">&larr; Workspace&apos;ler</Link>
        </p>
        <h1>Projeler</h1>
        <ul className="list">
          {projects.map((p) => (
            <li key={p.id}>
              <Link to={`/projects/${p.id}`}>
                <code>{p.key}</code> {p.name}
              </Link>
            </li>
          ))}
        </ul>
        <form className="card" onSubmit={onCreate}>
          <h2>Yeni proje</h2>
          <label>
            Key
            <input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} required />
          </label>
          <label>
            Ad
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit">Oluştur</button>
        </form>
      </main>
    </>
  );
}
