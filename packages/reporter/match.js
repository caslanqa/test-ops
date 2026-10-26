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

// Title similarity at or above this score is offered as a suggestion for a person to confirm; it is
// never linked automatically.
export const SUGGESTION_MIN_SCORE = 0.6;

/** Keeps the first test per source location: a test run under several Playwright projects is one test. */
export function dedupeByLocation(tests) {
  const seen = new Set();
  return tests.filter((test) => {
    if (!test.location) return true;
    const key = `${test.location.file}:${test.location.line}:${test.location.column}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function words(title) {
  return new Set(normalizeTitle(title).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
}

/** Jaccard similarity of two word sets, 0 to 1. */
function similarity(a, b) {
  const shared = [...a].filter((word) => b.has(word)).length;
  const total = a.size + b.size - shared;
  return total === 0 ? 0 : shared / total;
}

function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) {
    const groupKey = key(item);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), item]);
  }
  return groups;
}

/**
 * Pairs tests that have no TestOps case ID with cases by title. Only a title that is equal after
 * normalizing, and unique on both sides, is `exact`. A title shared by several tests or several
 * cases is `ambiguous`. The rest get at most one `suggestion` (the most similar case that no exact
 * match claimed, at or above SUGGESTION_MIN_SCORE) or are `unmatched`.
 */
export function matchTestsToCases(tests, cases) {
  const testGroups = groupBy(tests, (test) => normalizeTitle(test.title));
  const caseGroups = groupBy(cases, (testCase) => normalizeTitle(testCase.title));
  const exact = [];
  const ambiguous = [];
  const open = [];
  const taken = new Set();

  for (const test of tests) {
    const key = normalizeTitle(test.title);
    const sameTests = testGroups.get(key);
    const sameCases = caseGroups.get(key) ?? [];
    if (sameTests.length > 1) {
      ambiguous.push({ test, reason: `${sameTests.length} tests share this title` });
    } else if (sameCases.length > 1) {
      ambiguous.push({ test, reason: `${sameCases.length} cases share this title` });
    } else if (sameCases.length === 1) {
      exact.push({ test, caseId: sameCases[0].id, caseTitle: sameCases[0].title });
      taken.add(sameCases[0].id);
    } else {
      open.push(test);
    }
  }

  const suggestions = [];
  const unmatched = [];
  const candidates = cases.filter((testCase) => !taken.has(testCase.id)).map((testCase) => ({ testCase, words: words(testCase.title) }));
  for (const test of open) {
    const testWords = words(test.title);
    let best;
    for (const { testCase, words: caseWords } of candidates) {
      const score = similarity(testWords, caseWords);
      if (!best || score > best.score) best = { caseId: testCase.id, caseTitle: testCase.title, score };
    }
    if (best && best.score >= SUGGESTION_MIN_SCORE) suggestions.push({ test, ...best });
    else unmatched.push(test);
  }
  return { exact, suggestions, ambiguous, unmatched };
}
