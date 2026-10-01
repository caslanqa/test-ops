import type { ReactNode } from 'react';
import { STATUS_META, isResultStatus } from '../lib/status';
import { PRIORITY_LABEL, PRIORITY_LEVEL, type CasePriority } from '../lib/labels';

/** Test sonucu etiketi: ikon + metin + durum rengi. */
export function StatusChip({ status }: { status: string }) {
  if (!isResultStatus(status)) return <span className="chip">{status}</span>;
  const { label, icon: Icon } = STATUS_META[status];
  return (
    <span className={`chip chip--${status.toLowerCase()}`}>
      <Icon size={14} aria-hidden="true" />
      {label}
    </span>
  );
}

/** Durum dışı nötr etiket (run durumu, kaynak, defect durumu vb.). */
export function Tag({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'strong' | 'outline';
}) {
  return <span className={`tag tag--${tone}`}>{children}</span>;
}

/** Öncelik: dört çubuklu gösterge + metin etiketi. */
export function PriorityMark({ priority }: { priority: string }) {
  const level = PRIORITY_LEVEL[priority as CasePriority] ?? 0;
  return (
    <span className={`priority priority--${level}`}>
      <span className="priority-bars" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={n <= level ? 'on' : undefined} />
        ))}
      </span>
      {PRIORITY_LABEL[priority as CasePriority] ?? priority}
    </span>
  );
}
