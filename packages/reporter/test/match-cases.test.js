import assert from 'node:assert/strict';
import test from 'node:test';
import { SUGGESTION_MIN_SCORE, dedupeByLocation, matchTestsToCases } from '../match.js';

const at = (line) => ({ file: '/repo/tests/cart.spec.ts', line, column: 1 });
const cases = [
  { id: 'c1', title: 'Open the cart' },
  { id: 'c2', title: 'Adding products updates the cart badge and totals' },
  { id: 'c3', title: 'Pay with a card' },
];

test('an exact normalized title match is returned when both sides are unique', () => {
  const tests = [{ title: '  open THE cart. ', location: at(3) }];
  const { exact, suggestions, ambiguous, unmatched } = matchTestsToCases(tests, cases);
  assert.deepEqual(exact, [{ test: tests[0], caseId: 'c1', caseTitle: 'Open the cart' }]);
  assert.deepEqual([suggestions, ambiguous, unmatched], [[], [], []]);
});

test('two tests with the same title are ambiguous and not linked', () => {
  const tests = [{ title: 'Open the cart', location: at(3) }, { title: 'open the cart', location: at(9) }];
  const { exact, ambiguous } = matchTestsToCases(tests, cases);
  assert.deepEqual(exact, []);
  assert.deepEqual(ambiguous.map((item) => item.test), tests);
  assert.match(ambiguous[0].reason, /2 tests/);
});

test('two cases with the same title are ambiguous and not linked', () => {
  const twins = [...cases, { id: 'c4', title: 'open the cart' }];
  const tests = [{ title: 'Open the cart', location: at(3) }];
  const { exact, ambiguous } = matchTestsToCases(tests, twins);
  assert.deepEqual(exact, []);
  assert.equal(ambiguous.length, 1);
  assert.match(ambiguous[0].reason, /2 cases/);
});

test('a near match above 0.6 token overlap is a suggestion, never exact', () => {
  assert.equal(SUGGESTION_MIN_SCORE, 0.6);
  const tests = [{ title: 'Adding products updates the cart badge', location: at(3) }];
  const { exact, suggestions } = matchTestsToCases(tests, cases);
  assert.deepEqual(exact, []);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].caseId, 'c2');
  assert.ok(suggestions[0].score >= 0.6 && suggestions[0].score < 1);
});

test('an exact-matched case is never suggested for another test', () => {
  const tests = [{ title: 'Open the cart', location: at(3) }, { title: 'Open the cart now', location: at(9) }];
  const { exact, suggestions, unmatched } = matchTestsToCases(tests, cases);
  assert.deepEqual(exact.map((item) => item.caseId), ['c1']);
  assert.deepEqual(suggestions, []);
  assert.deepEqual(unmatched, [tests[1]]);
});

test('a test with no case above the threshold is unmatched', () => {
  const tests = [{ title: 'Remove the mug', location: at(3) }];
  const { suggestions, unmatched } = matchTestsToCases(tests, cases);
  assert.deepEqual(suggestions, []);
  assert.deepEqual(unmatched, tests);
});

test('dedupeByLocation collapses Playwright project variants of one test', () => {
  const chromium = { title: 'Open the cart', project: 'chromium', location: at(3) };
  const firefox = { title: 'Open the cart', project: 'firefox', location: at(3) };
  const other = { title: 'Pay', project: 'chromium', location: at(9) };
  const noLocation = { title: 'No location' };
  assert.deepEqual(dedupeByLocation([chromium, firefox, other, noLocation]), [chromium, other, noLocation]);
});
