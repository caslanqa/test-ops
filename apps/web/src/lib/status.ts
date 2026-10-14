import {
  Ban,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleMinus,
  RotateCcw,
  CircleX,
  type LucideIcon,
} from 'lucide-react';

export type ResultStatus =
  | 'PASSED'
  | 'FAILED'
  | 'BLOCKED'
  | 'SKIPPED'
  | 'INVALID'
  | 'RETEST'
  | 'UNTESTED';

/** Fixed order in the ribbon and legend: results first, untested last. */
export const STATUS_ORDER: ResultStatus[] = [
  'PASSED',
  'FAILED',
  'BLOCKED',
  'SKIPPED',
  'INVALID',
  'RETEST',
  'UNTESTED',
];

/**
 * Results a tester can pick for a case. Untested is the initial state and Retest comes from
 * "Run again"; neither is a result.
 */
export const RESULT_CHOICES: Exclude<ResultStatus, 'UNTESTED' | 'RETEST'>[] = [
  'PASSED',
  'FAILED',
  'BLOCKED',
  'SKIPPED',
  'INVALID',
];

/** Results a step can get; Invalid describes a whole case, so it isn't offered per step. */
export const STEP_RESULT_CHOICES: Exclude<ResultStatus, 'UNTESTED' | 'INVALID' | 'RETEST'>[] = [
  'PASSED',
  'FAILED',
  'BLOCKED',
  'SKIPPED',
];

/** Results that usually need a defect, so the result form offers one by default. */
export const DEFECT_STATUSES: ResultStatus[] = ['FAILED', 'BLOCKED', 'INVALID'];

// Each status has a label and an icon so that color alone carries no meaning (WCAG 1.4.1).
export const STATUS_META: Record<
  ResultStatus,
  { label: string; icon: LucideIcon }
> = {
  PASSED: { label: 'Passed', icon: CircleCheck },
  FAILED: { label: 'Failed', icon: CircleX },
  BLOCKED: { label: 'Blocked', icon: Ban },
  SKIPPED: { label: 'Skipped', icon: CircleMinus },
  INVALID: { label: 'Invalid', icon: CircleHelp },
  RETEST: { label: 'Retest', icon: RotateCcw },
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
    INVALID: 0,
    RETEST: 0,
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

/** Cases still waiting for a result: never tested, or marked to run again. */
export function pendingCount(counts: Record<ResultStatus, number>): number {
  return counts.UNTESTED + counts.RETEST;
}
