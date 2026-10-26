import assert from 'node:assert/strict';
import test from 'node:test';
import TestOpsReporter from '../reporter.js';
import { API_BASE, captureConsole, fakeFetch, fakeSuite, fakeTest } from './helpers.js';

const CASE_ID = '550e8400-e29b-41d4-a716-446655440000';
const isBulk = (call) => call.path.endsWith('/results/bulk');
const step = (title, extra = {}) => ({ category: 'test.step', title, steps: [], ...extra });

function routes() {
  return {
    'GET /projects/p/runs/r1': () => ({ id: 'r1', runCases: [{ testCaseId: CASE_ID, executionMode: 'AUTOMATED' }] }),
    'GET /projects/p/cases': () => [{ id: CASE_ID, steps: [{ position: 0, action: 'Open the cart' }, { position: 1, action: 'Pay' }] }],
    // Reached only when the environment running the tests looks like a CI system.
    'PATCH /projects/p/runs/r1': () => ({}),
    'POST /projects/p/runs/r1/results/bulk': ({ body }) => ({ results: body.results.map((_, index) => ({ id: `x${index}` })) }),
  };
}

/** Drives the reporter like Playwright does, with the global fetch replaced for the duration. */
async function runReporter(tests, routeMap = routes()) {
  const output = captureConsole();
  const originalFetch = globalThis.fetch;
  const { fetch, calls } = fakeFetch(routeMap);
  globalThis.fetch = fetch;
  try {
    const reporter = new TestOpsReporter({ apiUrl: API_BASE, token: 't', projectId: 'p', runId: 'r1' });
    reporter.onBegin({}, fakeSuite(tests));
    const outcome = await reporter.onEnd();
    return { calls, outcome, output };
  } finally {
    globalThis.fetch = originalFetch;
    output.restore();
  }
}

test("onEnd sends the collected steps with the last retry's result", async () => {
  const { calls, outcome } = await runReporter([
    fakeTest({
      id: 'pw-1',
      testCaseId: CASE_ID,
      results: [
        { status: 'failed', steps: [step('Open the cart', { error: { message: 'first attempt' } })] },
        { status: 'passed', steps: [step('Open the cart'), step('Pay')] },
      ],
    }),
  ]);
  assert.equal(outcome, undefined);
  const [sent] = calls.find(isBulk).body.results;
  assert.equal(sent.status, 'PASSED');
  assert.deepEqual(sent.stepResults, [
    { stepPosition: 0, status: 'PASSED' },
    { stepPosition: 1, status: 'PASSED' },
  ]);
});
