import {
  Ban,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleX,
  type LucideIcon,
} from 'lucide-react';

export type ResultStatus =
  | 'PASSED'
  | 'FAILED'
  | 'BLOCKED'
  | 'SKIPPED'
  | 'UNTESTED';

/** Fixed order in the ribbon and legend: results first, untested last. */
export const STATUS_ORDER: ResultStatus[] = [
  'PASSED',
  'FAILED',
  'BLOCKED',
  'SKIPPED',
  'UNTESTED',
];

/** Results a tester can pick for a case (Untested is an initial state that can't be returned to). */
export const RESULT_CHOICES: Exclude<ResultStatus, 'UNTESTED'>[] = [
  'PASSED',
  'FAILED',
  'BLOCKED',
  'SKIPPED',
];

// Each status has a label and an icon so that color alone carries no meaning (WCAG 1.4.1).
export const STATUS_META: Record<
  ResultStatus,
  { label: string; icon: LucideIcon }
> = {
  PASSED: { label: 'Passed', icon: CircleCheck },
  FAILED: { label: 'Failed', icon: CircleX },
  BLOCKED: { label: 'Blocked', icon: Ban },
  SKIPPED: { label: 'Skipped', icon: CircleMinus },
  UNTESTED: { label: 'Untested', icon: CircleDashed },
};

export function isResultStatus(value: string): value is ResultStatus {
  return value in STATUS_META;
}

/** Normalizes a status → count map, dropping unknown keys. */
export function normalizeCounts(
  counts: Record<string, number> | undefined,
): Record<ResultStatus, number> {
  const result: Record<ResultStatus, number> = {
    PASSED: 0,
    FAILED: 0,
    BLOCKED: 0,
    SKIPPED: 0,
    UNTESTED: 0,
  };
  for (const [status, count] of Object.entries(counts ?? {})) {
    if (isResultStatus(status)) result[status] = count;
  }
  return result;
}

/** Screen reader summary such as "12 passed, 3 failed"; statuses with zero are skipped. */
export function describeCounts(counts: Record<ResultStatus, number>): string {
  const parts = STATUS_ORDER.filter((s) => counts[s] > 0).map(
    (s) => `${counts[s]} ${STATUS_META[s].label.toLowerCase()}`,
  );
  return parts.length > 0 ? parts.join(', ') : 'No cases';
}
