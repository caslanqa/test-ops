import assert from 'node:assert/strict';
import test from 'node:test';
import { matchSteps, normalizeTitle } from '../match.js';

const caseSteps = [
  { position: 0, action: 'Open the cart' },
  { position: 1, action: 'Remove the mug' },
];

test('normalizeTitle lowercases, collapses whitespace and drops a trailing dot or colon', () => {
  assert.equal(normalizeTitle('  Open   the\tCart. '), 'open the cart');
  assert.equal(normalizeTitle('Open the cart:'), 'open the cart');
  assert.equal(normalizeTitle('Open the cart ...'), 'open the cart');
});

test('matchSteps returns the case step position for a title match', () => {
  const { stepResults, unmatched } = matchSteps(
    [{ title: 'remove THE mug.', status: 'PASSED' }],
    caseSteps,
  );
  assert.deepEqual(stepResults, [{ stepPosition: 1, status: 'PASSED' }]);
  assert.deepEqual(unmatched, []);
});

test('repeated titles match case steps in order', () => {
  const repeated = [
    { position: 0, action: 'Add a product' },
    { position: 1, action: 'Open the cart' },
    { position: 2, action: 'Add a product' },
  ];
  const { stepResults } = matchSteps(
    [
      { title: 'Add a product', status: 'PASSED' },
      { title: 'Open the cart', status: 'PASSED' },
      { title: 'Add a product', status: 'FAILED', comment: 'boom' },
    ],
    repeated,
  );
  assert.deepEqual(stepResults.map((item) => item.stepPosition), [0, 1, 2]);
  assert.equal(stepResults[2].comment, 'boom');
});

test('steps without a case step are returned in unmatched', () => {
  const { stepResults, unmatched } = matchSteps(
    [
      { title: 'Open the cart', status: 'PASSED' },
      { title: 'Click somewhere unrelated', status: 'PASSED' },
      { title: 'Open the cart', status: 'PASSED' },
    ],
    caseSteps,
  );
  assert.deepEqual(stepResults.map((item) => item.stepPosition), [0]);
  assert.deepEqual(unmatched, ['Click somewhere unrelated', 'Open the cart']);
});

test('a step comment is cut to 2000 characters', () => {
  const { stepResults } = matchSteps(
    [{ title: 'Open the cart', status: 'FAILED', comment: 'x'.repeat(5000) }],
    caseSteps,
  );
  assert.equal(stepResults[0].comment.length, 2000);
});

test('no more than 200 step results are returned', () => {
  const many = Array.from({ length: 250 }, (_, index) => ({ position: index, action: `step ${index}` }));
  const { stepResults } = matchSteps(
    many.map((step) => ({ title: step.action, status: 'PASSED' })),
    many,
  );
  assert.equal(stepResults.length, 200);
});
