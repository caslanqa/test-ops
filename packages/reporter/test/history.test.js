import assert from 'node:assert/strict';
import test from 'node:test';
import { captureConsole, fakeFetch, testClient } from './helpers.js';

const result = { testCaseId: 'c1', externalTestId: 't1', title: 'one', status: 'PASSED' };
const run = { id: 'r1', runCases: [{ testCaseId: 'c1', executionMode: 'AUTOMATED' }] };
const isBulk = (call) => call.path.endsWith('/results/bulk');

function routes(onBulk) {
  return {
    'GET /projects/p/runs/r1': () => run,
    'POST /projects/p/runs/r1/results/bulk': onBulk,
  };
}

test('two executions into one run send different externalTestId values', async () => {
  const output = captureConsole();
  try {
    const sent = [];
    for (let execution = 0; execution < 2; execution += 1) {
      const { fetch, calls } = fakeFetch(routes(() => ({ results: [{ id: 'x' }] })));
      await testClient(fetch, { runId: 'r1' }).report([result]);
      sent.push(calls.find(isBulk).body.results[0].externalTestId);
    }
    assert.notEqual(sent[0], sent[1]);
    assert.ok(sent.every((id) => id.startsWith('t1:')));
  } finally {
    output.restore();
  }
});

test('a retried bulk request keeps the same externalTestId', async () => {
  const output = captureConsole();
  try {
    let attempts = 0;
    const { fetch, calls } = fakeFetch(routes(() => (attempts++ === 0 ? { status: 503 } : { results: [{ id: 'x' }] })));
    await testClient(fetch, { runId: 'r1' }).report([result]);
    const ids = calls.filter(isBulk).map((call) => call.body.results[0].externalTestId);
    assert.equal(ids.length, 2);
    assert.equal(ids[0], ids[1]);
  } finally {
    output.restore();
  }
});
