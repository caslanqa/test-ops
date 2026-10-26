import assert from 'node:assert/strict';
import test from 'node:test';
import { captureConsole, fakeFetch, testClient } from './helpers.js';

/** A run case as TestOps returns it: caseSnapshot holds the steps the case had when the run started. */
const runCase = (testCaseId, steps) => ({
  testCaseId,
  executionMode: 'AUTOMATED',
  caseSnapshot: steps && {
    title: testCaseId,
    steps: steps.map(([position, action]) => ({ position, action, expectedResult: null })),
  },
});
const step = (title, status = 'PASSED', comment) => ({ title, status, ...(comment ? { comment } : {}) });
const result = (id, steps) => ({ testCaseId: id, externalTestId: `t-${id}`, title: `test ${id}`, status: 'PASSED', steps });
const isBulk = (call) => call.path.endsWith('/results/bulk');
const requestedCases = (calls) => calls.some((call) => call.path.endsWith('/cases'));
const sentResults = (calls) => calls.find(isBulk).body.results;

const runCases = [
  runCase('c1', [[0, 'Open the cart'], [1, 'Pay']]),
  runCase('c2', [[0, 'Open the cart']]),
];

/** Reports into the existing run r1, whose GET answer is `runCasesAnswer`. */
async function reportIntoRun(results, runCasesAnswer = runCases) {
  const output = captureConsole();
  const { fetch, calls } = fakeFetch({
    'GET /projects/p/runs/r1': () => ({ id: 'r1', runCases: runCasesAnswer }),
    'POST /projects/p/runs/r1/results/bulk': ({ body }) => ({ results: body.results.map((_, index) => ({ id: `x${index}` })) }),
  });
  try {
    await testClient(fetch, { runId: 'r1' }).report(results);
  } finally {
    output.restore();
  }
  return { calls, warnings: output.warnings };
}

test('matched steps are sent as stepResults using the steps the run holds for each case', async () => {
  const { calls } = await reportIntoRun([
    result('c1', [step('Open the cart'), step('Pay', 'FAILED', 'declined')]),
    result('c2', [step('open the cart.')]),
  ]);
  assert.equal(requestedCases(calls), false);
  const [first, second] = sentResults(calls);
  assert.deepEqual(first.stepResults, [
    { stepPosition: 0, status: 'PASSED' },
    { stepPosition: 1, status: 'FAILED', comment: 'declined' },
  ]);
  assert.deepEqual(second.stepResults, [{ stepPosition: 0, status: 'PASSED' }]);
});

test("a step is reported at its position in the run's snapshot", async () => {
  // The case was edited after the run started, so its live positions differ; the snapshot is what the UI reads.
  const { calls } = await reportIntoRun(
    [result('c1', [step('Pay')])],
    [runCase('c1', [[0, 'Intro'], [2, 'Pay']])],
  );
  assert.deepEqual(sentResults(calls)[0].stepResults, [{ stepPosition: 2, status: 'PASSED' }]);
});

test('unmatched steps warn and the result is still sent', async () => {
  const { calls, warnings } = await reportIntoRun([result('c1', [step('Open the cart'), step('Wander about')])]);
  assert.deepEqual(sentResults(calls)[0].stepResults, [{ stepPosition: 0, status: 'PASSED' }]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /test c1/);
  assert.match(warnings[0], /Wander about/);
});

test('a run the reporter creates supplies the steps in its own response', async () => {
  const output = captureConsole();
  const { fetch, calls } = fakeFetch({
    'POST /projects/p/runs': () => ({ id: 'r9', runCases: [runCase('c1', [[0, 'Open the cart']])] }),
    'POST /projects/p/runs/r9/results/bulk': ({ body }) => ({ results: body.results.map((_, index) => ({ id: `x${index}` })) }),
    'POST /projects/p/runs/r9/complete': () => ({}),
    'PATCH /projects/p/runs/r9': () => ({}),
  });
  try {
    await testClient(fetch).report([result('c1', [step('Open the cart')])]);
  } finally {
    output.restore();
  }
  assert.equal(requestedCases(calls), false);
  assert.deepEqual(sentResults(calls)[0].stepResults, [{ stepPosition: 0, status: 'PASSED' }]);
});

test('a run case without a snapshot warns and the result is sent without stepResults', async () => {
  const { calls, warnings } = await reportIntoRun([result('c1', [step('Open the cart')])], [runCase('c1', null)]);
  assert.equal('stepResults' in sentResults(calls)[0], false);
  assert.equal(warnings.length, 1);
});

test('no step results are sent and no case list is requested when no result has steps', async () => {
  const { calls } = await reportIntoRun([result('c1', []), result('c2', undefined)]);
  assert.equal(requestedCases(calls), false);
  assert.equal('stepResults' in sentResults(calls)[0], false);
});
