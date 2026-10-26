import assert from 'node:assert/strict';
import test from 'node:test';
import { collectSteps } from '../reporter.js';

const step = (category, title, extra = {}) => ({ category, title, steps: [], ...extra });

test('keeps only test.step steps and drops expect and pw:api steps', () => {
  const collected = collectSteps([
    step('hook', 'Before Hooks'),
    step('pw:api', 'page.goto'),
    step('test.step', 'Open the cart'),
    step('expect', 'expect.toBeVisible'),
  ]);
  assert.deepEqual(collected, [{ title: 'Open the cart', status: 'PASSED' }]);
});

test('walks nested steps depth first', () => {
  const collected = collectSteps([
    step('test.step', 'Checkout', {
      steps: [
        step('test.step', 'Fill the form', { steps: [step('test.step', 'Enter the name')] }),
        step('test.step', 'Pay'),
      ],
    }),
    step('test.step', 'Confirm'),
  ]);
  assert.deepEqual(collected.map((item) => item.title), ['Checkout', 'Fill the form', 'Enter the name', 'Pay', 'Confirm']);
});

test('a step with an error is FAILED with the ANSI-stripped message', () => {
  const collected = collectSteps([
    step('test.step', 'Pay', { error: { message: '\u001b[31mExpected: 1\u001b[39m\nReceived: 2' } }),
  ]);
  assert.deepEqual(collected, [{ title: 'Pay', status: 'FAILED', comment: 'Expected: 1\nReceived: 2' }]);
});
