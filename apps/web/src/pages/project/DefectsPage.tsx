import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client';

interface Defect {
  id: string;
  title: string;
  status: string;
  severity: string;
}

export function DefectsPage() {
  const { projectId = '' } = useParams();
  const [defects, setDefects] = useState<Defect[]>([]);

  useEffect(() => {
    api.get<Defect[]>(`/projects/${projectId}/defects`).then(setDefects);
  }, [projectId]);

  return (
    <section>
      <h1>Defects</h1>
      <ul className="list">
        {defects.map((d) => (
          <li key={d.id}>
            {d.title} <span className="badge">{d.status}</span>{' '}
            <span className="badge">{d.severity}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
