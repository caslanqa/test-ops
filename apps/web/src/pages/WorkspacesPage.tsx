import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { AppHeader } from '../components/AppHeader';

interface Workspace {
  id: string;
  name: string;
  slug: string;
}

export function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get<Workspace[]>('/workspaces').then(setWorkspaces);
  }

  useEffect(load, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/workspaces', { name, slug });
      setName('');
      setSlug('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Oluşturulamadı');
    }
  }

  return (
    <>
      <AppHeader />
      <main className="page">
        <h1>Workspace&apos;ler</h1>
        <ul className="list">
          {workspaces.map((w) => (
            <li key={w.id}>
              <Link to={`/workspaces/${w.id}`}>{w.name}</Link> <code>{w.slug}</code>
            </li>
          ))}
        </ul>
        <form className="card" onSubmit={onCreate}>
          <h2>Yeni workspace</h2>
          <label>
            Ad
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Slug
            <input value={slug} onChange={(e) => setSlug(e.target.value)} required />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit">Oluştur</button>
        </form>
      </main>
    </>
  );
}
