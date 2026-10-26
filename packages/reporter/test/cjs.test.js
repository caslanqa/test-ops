import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as esm from '@testops/reporter';
import * as esmCore from '@testops/reporter/core';
import { API_BASE, captureConsole, fakeFetch, fakeSuite, fakeTest } from './helpers.js';

const require = createRequire(import.meta.url);
const cjs = require('@testops/reporter');
const cjsCore = require('@testops/reporter/core');
const ID = '550e8400-e29b-41d4-a716-446655440000';

test('the CommonJS entry exports the same names as the ES module entry', () => {
  const names = (entry) => Object.keys(entry).filter((name) => name !== '__esModule').sort();
  assert.deepEqual(names(cjs), names(esm));
});

test('testops of both entries gives the same annotation and the same error', () => {
  assert.deepEqual(cjs.testops(ID, 'defect'), esm.testops(ID, 'defect'));
  assert.deepEqual(cjs.testops(), esm.testops());
  assert.throws(() => cjs.testops('nope'), { name: 'TypeError', message: /UUID/ });
});

test('the CommonJS core entry has the documented functions; createReporterClient is the one ES-only export', () => {
  assert.deepEqual(Object.keys(cjsCore).sort(), ['reportResults', 'syncTestCases']);
  assert.deepEqual(Object.keys(esmCore).sort(), ['createReporterClient', 'reportResults', 'syncTestCases']);
});

test('the CommonJS reporter class reports results like the ES module one', async () => {
  const output = captureConsole();
  const originalFetch = globalThis.fetch;
  const { fetch, calls } = fakeFetch({
    'GET /projects/p/runs/r1': () => ({ id: 'r1', runCases: [{ testCaseId: ID, executionMode: 'AUTOMATED' }] }),
    // The reporter reads process.env, so on a CI system it also attaches the CI job URL to the run.
    'PATCH /projects/p/runs/r1': () => ({}),
    'POST /projects/p/runs/r1/results/bulk': ({ body }) => ({ results: body.results.map(() => ({ id: 'x' })) }),
  });
  globalThis.fetch = fetch;
  try {
    const Reporter = cjs.default;
    const reporter = new Reporter({ apiUrl: API_BASE, token: 't', projectId: 'p', runId: 'r1' });
    assert.equal(reporter.printsToStdio(), false);
    // Playwright may not wait for onBegin, so onEnd has to wait for the reporter behind it.
    reporter.onBegin({}, fakeSuite([fakeTest({ id: 'pw-1', testCaseId: ID, results: [{ status: 'passed' }] })]));
    assert.equal(await reporter.onEnd(), undefined);
    assert.equal(calls.filter((call) => call.path.endsWith('/results/bulk')).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    output.restore();
  }
});

test('the CommonJS entries load where require() cannot load ES modules', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  // Node 22 and newer can switch require(esm) off, which is how older Node versions behave.
  const flags = Number(process.versions.node.split('.')[0]) >= 22 ? ['--no-experimental-require-module'] : [];
  const code = `
    const entry = require('@testops/reporter');
    const core = require('@testops/reporter/core');
    const Reporter = entry.default;
    (async () => {
      await core.reportResults([], {});
      const reporter = new Reporter({});
      reporter.onBegin({}, { allTests: () => [] });
      await reporter.onEnd({});
      console.log(JSON.stringify([typeof entry.testops(), typeof entry.syncTestCases, typeof Reporter]));
    })();
  `;
  const stdout = execFileSync(process.execPath, [...flags, '-e', code], { cwd: root, env: { PATH: process.env.PATH }, encoding: 'utf8' });
  assert.match(stdout, /\["object","function","function"\]/);
});
