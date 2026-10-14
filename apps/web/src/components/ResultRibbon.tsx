import type { CSSProperties } from 'react';
import {
  STATUS_META,
  STATUS_ORDER,
  describeCounts,
  normalizeCounts,
  type ResultStatus,
} from '../lib/status';

/** Above this many cases, cells get too thin to read; the proportional view is used instead. */
const MAX_CELLS = 400;

interface RibbonProps {
  /** Case statuses in run order; when given, each case is drawn as a cell. */
  statuses?: ResultStatus[];
  /** Status → count; without `statuses`, proportional segments are drawn. */
  counts?: Record<string, number>;
  size?: 'sm' | 'md' | 'lg';
  /** Context prepended to the screen reader summary (e.g. the run name). */
  label?: string;
  /**
   * Writes each status's count (and, where it fits, its name) on its segment. Draws proportional
   * segments even when `statuses` is given, since a count belongs to a status, not to a case.
   */
  showCounts?: boolean;
  /** Status the page is filtered to; the other segments are dimmed. */
  selected?: ResultStatus | null;
  /**
   * Makes each segment a toggle button that filters the page to its status. The ribbon is then a
   * group of buttons instead of an image, so keyboard and screen reader users can use it too.
   */
  onSelect?: (status: ResultStatus) => void;
}

/**
 * Result ribbon: the signature element of the UI. The visual cells are aria-hidden; the
 * information reaches screen readers through the `role="img"` label and sighted users
 * through the StatusLegend text next to it (color alone carries no meaning).
 */
export function ResultRibbon({
  statuses,
  counts,
  size = 'lg',
  label,
  showCounts = false,
  selected = null,
  onSelect,
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
  const perCase = !onSelect && !showCounts && statuses && statuses.length <= MAX_CELLS;

  if (onSelect && total > 0) {
    return (
      <div
        className={`ribbon ribbon--${size} ribbon--counts ribbon--interactive${selected ? ' ribbon--filtered' : ''}`}
        role="group"
        aria-label={`${label ? `${label}: ${summary}` : summary}. Choose a status to list only its cases.`}
      >
        {STATUS_ORDER.filter((s) => totals[s] > 0).map((status) => {
          const name = STATUS_META[status].label;
          return (
            <button
              key={status}
              type="button"
              className={`ribbon-segment status-bg--${status.toLowerCase()}`}
              style={{ flexGrow: totals[status] }}
              aria-pressed={selected === status}
              aria-label={`${name}: ${totals[status]}`}
              title={selected === status ? `Show all cases` : `Show only ${name.toLowerCase()} cases (${totals[status]})`}
              onClick={() => onSelect(status)}
            >
              <span className={`ribbon-count ribbon-count--${status.toLowerCase()}`} aria-hidden="true">
                <span className="num">{totals[status]}</span>
                <span className="ribbon-count-label">{name}</span>
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className={`ribbon ribbon--${size}${perCase ? ' ribbon--cells' : ''}${showCounts ? ' ribbon--counts' : ''}`}
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
            >
              {/* The role="img" label already reads the counts out, so this copy is visual only.
                  Container queries drop the name, then the number, on segments too narrow for them. */}
              {showCounts && (
                <span className={`ribbon-count ribbon-count--${status.toLowerCase()}`} aria-hidden="true">
                  <span className="num">{totals[status]}</span>
                  <span className="ribbon-count-label">{STATUS_META[status].label}</span>
                </span>
              )}
            </span>
          ))}
    </div>
  );
}

/** Text equivalent of the ribbon: icon, label and count for each status. */
export function StatusLegend({
  counts,
  hideEmpty = false,
  selected = null,
  onSelect,
}: {
  counts: Record<string, number> | undefined;
  hideEmpty?: boolean;
  /** Status the page is filtered to. */
  selected?: ResultStatus | null;
  /** Makes each entry a toggle button that filters the page to its status. */
  onSelect?: (status: ResultStatus) => void;
}) {
  const totals = normalizeCounts(counts);
  return (
    <ul className="legend">
      {STATUS_ORDER.filter((s) => !hideEmpty || totals[s] > 0).map((status) => {
        const { label, icon: Icon } = STATUS_META[status];
        return (
          <li key={status} className={`legend-item status-fg--${status.toLowerCase()}`}>
            {onSelect ? (
              <button
                type="button"
                className="legend-button"
                aria-pressed={selected === status}
                // A status with no cases has nothing to list.
                disabled={totals[status] === 0 && selected !== status}
                onClick={() => onSelect(status)}
              >
                <Icon size={16} aria-hidden="true" />
                <span className="legend-label">{label}</span>
                <span className="legend-count num">{totals[status]}</span>
              </button>
            ) : (
              <>
                <Icon size={16} aria-hidden="true" />
                <span className="legend-label">{label}</span>
                <span className="legend-count num">{totals[status]}</span>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
