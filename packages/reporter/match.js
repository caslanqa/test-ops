// Mirrors the server's caps on a result's step results (STEP_RESULTS_MAX_ITEMS and
// STEP_RESULT_COMMENT_MAX_LENGTH in apps/api/src/runs/dto/result-limits.ts).
export const STEP_RESULTS_MAX = 200;
export const STEP_COMMENT_MAX = 2_000;

/** Lowercases, collapses whitespace and drops trailing dots and colons, so titles compare by wording only. */
export function normalizeTitle(title) {
  return String(title ?? '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[\s.:]+$/, '');
}

/**
 * Matches framework steps to the steps of a TestOps case by normalized title. A case step is used at
 * most once, so repeated titles pair up in order. Steps without a case step are returned in `unmatched`
 * and are not reported.
 */
export function matchSteps(steps, caseSteps) {
  const candidates = caseSteps.map((step) => ({ position: step.position, key: normalizeTitle(step.action), used: false }));
  const stepResults = [];
  const unmatched = [];
  for (const step of steps) {
    const key = normalizeTitle(step.title);
    const target = candidates.find((candidate) => !candidate.used && candidate.key === key);
    if (!target) {
      unmatched.push(step.title);
      continue;
    }
    target.used = true;
    if (stepResults.length >= STEP_RESULTS_MAX) continue;
    stepResults.push({
      stepPosition: target.position,
      status: step.status,
      ...(step.comment ? { comment: step.comment.slice(0, STEP_COMMENT_MAX) } : {}),
    });
  }
  return { stepResults, unmatched };
}
