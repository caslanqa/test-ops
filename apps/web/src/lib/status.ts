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

/** Şeritte ve lejantta sabit sıra: önce sonuçlananlar, en son test edilmeyenler. */
export const STATUS_ORDER: ResultStatus[] = [
  'PASSED',
  'FAILED',
  'BLOCKED',
  'SKIPPED',
  'UNTESTED',
];

/** Tester'ın bir case için seçebileceği sonuçlar (Untested geri alınamaz bir başlangıç durumudur). */
export const RESULT_CHOICES: Exclude<ResultStatus, 'UNTESTED'>[] = [
  'PASSED',
  'FAILED',
  'BLOCKED',
  'SKIPPED',
];

// Renk tek başına anlam taşımasın diye (WCAG 1.4.1) her durumun bir etiketi ve ikonu var.
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

/** Durum → adet sözlüğünü, bilinmeyen anahtarları atarak normalize eder. */
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

/** "12 passed, 3 failed" biçiminde ekran okuyucu özeti; sıfır olan durumlar atlanır. */
export function describeCounts(counts: Record<ResultStatus, number>): string {
  const parts = STATUS_ORDER.filter((s) => counts[s] > 0).map(
    (s) => `${counts[s]} ${STATUS_META[s].label.toLowerCase()}`,
  );
  return parts.length > 0 ? parts.join(', ') : 'No cases';
}
