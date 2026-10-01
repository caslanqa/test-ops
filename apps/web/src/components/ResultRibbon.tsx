import type { CSSProperties } from 'react';
import {
  STATUS_META,
  STATUS_ORDER,
  describeCounts,
  normalizeCounts,
  type ResultStatus,
} from '../lib/status';

/** Bu sayının üzerindeki run'larda hücreler okunamayacak kadar incelir; oransal görünüme geçilir. */
const MAX_CELLS = 400;

interface RibbonProps {
  /** Run sırasıyla case durumları; verilirse her case bir hücre olarak çizilir. */
  statuses?: ResultStatus[];
  /** Durum → adet; `statuses` yoksa oransal segmentler çizilir. */
  counts?: Record<string, number>;
  size?: 'sm' | 'lg';
  /** Ekran okuyucu özetinin başına eklenen bağlam (ör. run adı). */
  label?: string;
}

/**
 * Sonuç şeridi: arayüzün imza öğesi. Görsel hücreler aria-hidden'dır; bilgiyi
 * ekran okuyuculara `role="img"` etiketi, gören kullanıcılara ise yanındaki
 * StatusLegend metin olarak verir (renk tek başına anlam taşımaz).
 */
export function ResultRibbon({
  statuses,
  counts,
  size = 'lg',
  label,
}: RibbonProps) {
  const totals = normalizeCounts(
    counts ??
      statuses?.reduce<Record<string, number>>((acc, s) => {
        acc[s] = (acc[s] ?? 0) + 1;
        return acc;
      }, {}),
  );
  const summary = describeCounts(totals);
  const total = STATUS_ORDER.reduce((sum, s) => sum + totals[s], 0);
  const perCase = statuses && statuses.length <= MAX_CELLS;

  return (
    <div
      className={`ribbon ribbon--${size}${perCase ? ' ribbon--cells' : ''}`}
      role="img"
      aria-label={label ? `${label}: ${summary}` : summary}
    >
      {total === 0 && <span className="ribbon-empty" />}
      {perCase
        ? statuses.map((status, i) => (
            <span
              key={i}
              className={`ribbon-cell status-bg--${status.toLowerCase()}`}
              style={{ '--i': i } as CSSProperties}
              title={`Case ${i + 1}: ${STATUS_META[status].label}`}
            />
          ))
        : STATUS_ORDER.filter((s) => totals[s] > 0).map((status) => (
            <span
              key={status}
              className={`ribbon-segment status-bg--${status.toLowerCase()}`}
              style={{ flexGrow: totals[status] }}
              title={`${STATUS_META[status].label}: ${totals[status]}`}
            />
          ))}
    </div>
  );
}

/** Şeridin metin karşılığı: her durum için ikon, etiket ve adet. */
export function StatusLegend({
  counts,
  hideEmpty = false,
}: {
  counts: Record<string, number> | undefined;
  hideEmpty?: boolean;
}) {
  const totals = normalizeCounts(counts);
  return (
    <ul className="legend">
      {STATUS_ORDER.filter((s) => !hideEmpty || totals[s] > 0).map((status) => {
        const { label, icon: Icon } = STATUS_META[status];
        return (
          <li key={status} className={`legend-item status-fg--${status.toLowerCase()}`}>
            <Icon size={16} aria-hidden="true" />
            <span className="legend-label">{label}</span>
            <span className="legend-count num">{totals[status]}</span>
          </li>
        );
      })}
    </ul>
  );
}
