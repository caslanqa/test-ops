import assert from 'node:assert/strict';
import test from 'node:test';
import { captureConsole, fakeFetch, testClient } from './helpers.js';

const run = {
  id: 'r1',
  runCases: [
    { testCaseId: 'c1', executionMode: 'AUTOMATED' },
    { testCaseId: 'c2', executionMode: 'AUTOMATED' },
  ],
};
const cases = [
  { id: 'c1', steps: [{ position: 0, action: 'Open the cart' }, { position: 1, action: 'Pay' }] },
  { id: 'c2', steps: [{ position: 0, action: 'Open the cart' }] },
];
const step = (title, status = 'PASSED', comment) => ({ title, status, ...(comment ? { comment } : {}) });
const result = (id, steps) => ({ testCaseId: id, externalTestId: `t-${id}`, title: `test ${id}`, status: 'PASSED', steps });
const isBulk = (call) => call.path.endsWith('/results/bulk');
const isCases = (call) => call.path === '/projects/p/cases';

function routes(casesAnswer = () => cases) {
  return {
    'GET /projects/p/runs/r1': () => run,
    'GET /projects/p/cases': casesAnswer,
    'POST /projects/p/runs/r1/results/bulk': ({ body }) => ({ results: body.results.map((_, index) => ({ id: `x${index}` })) }),
  };
}

async function report(results, routeMap = routes()) {
  const output = captureConsole();
  const { fetch, calls } = fakeFetch(routeMap);
  try {
    await testClient(fetch, { runId: 'r1' }).report(results);
  } finally {
    output.restore();
  }
  return { calls, warnings: output.warnings };
}

test('matched steps are sent as stepResults and the case list is fetched once for several results', async () => {
  const { calls } = await report([
    result('c1', [step('Open the cart'), step('Pay', 'FAILED', 'declined')]),
    result('c2', [step('open the cart.')]),
  ]);
  assert.equal(calls.filter(isCases).length, 1);
  const [first, second] = calls.find(isBulk).body.results;
  assert.deepEqual(first.stepResults, [
    { stepPosition: 0, status: 'PASSED' },
    { stepPosition: 1, status: 'FAILED', comment: 'declined' },
  ]);
  assert.deepEqual(second.stepResults, [{ stepPosition: 0, status: 'PASSED' }]);
});

test('unmatched steps warn and the result is still sent', async () => {
  const { calls, warnings } = await report([result('c1', [step('Open the cart'), step('Wander about')])]);
  const [sent] = calls.find(isBulk).body.results;
  assert.deepEqual(sent.stepResults, [{ stepPosition: 0, status: 'PASSED' }]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /test c1/);
  assert.match(warnings[0], /Wander about/);
});

test('a failing GET /cases warns and the result is sent without stepResults', async () => {
  const { calls, warnings } = await report([result('c1', [step('Open the cart')])], routes(() => ({ status: 403 })));
  const [sent] = calls.find(isBulk).body.results;
  assert.equal('stepResults' in sent, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /403/);
});

test('GET /cases is not requested when no result has steps', async () => {
  const { calls } = await report([result('c1', []), result('c2', undefined)]);
  assert.equal(calls.filter(isCases).length, 0);
  assert.equal('stepResults' in calls.find(isBulk).body.results[0], false);
});
