import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import TestOpsReporter from '../reporter.js';
import { API_BASE, captureConsole, fakeFetch, fakeSuite, fakeTest } from './helpers.js';

// The reporter reads TESTOPS_* from the environment for anything the options leave out.
delete process.env.TESTOPS_ATTACHMENTS;

const CASE_ID = '550e8400-e29b-41d4-a716-446655440000';
const isBulk = (call) => call.path.endsWith('/results/bulk');
const isUpload = (call) => call.path.endsWith('/attachments');
const step = (title, extra = {}) => ({ category: 'test.step', title, steps: [], ...extra });

function routes() {
  return {
    'GET /projects/p/runs/r1': () => ({ id: 'r1', runCases: [{ testCaseId: CASE_ID, executionMode: 'AUTOMATED' }] }),
    'GET /projects/p/cases': () => [{ id: CASE_ID, steps: [{ position: 0, action: 'Open the cart' }, { position: 1, action: 'Pay' }] }],
    // Reached only when the environment running the tests looks like a CI system.
    'PATCH /projects/p/runs/r1': () => ({}),
    'POST /projects/p/runs/r1/results/bulk': ({ body }) => ({ results: body.results.map((_, index) => ({ id: `x${index}` })) }),
    'POST /projects/p/results/x0/attachments': () => ({}),
  };
}

/** Drives the reporter like Playwright does, with the global fetch replaced for the duration. */
async function runReporter(tests, { routeMap = routes(), options = {} } = {}) {
  const output = captureConsole();
  const originalFetch = globalThis.fetch;
  const { fetch, calls } = fakeFetch(routeMap);
  globalThis.fetch = fetch;
  try {
    const reporter = new TestOpsReporter({ apiUrl: API_BASE, token: 't', projectId: 'p', runId: 'r1', ...options });
    reporter.onBegin({}, fakeSuite(tests));
    const outcome = await reporter.onEnd();
    return { calls, outcome, output };
  } finally {
    globalThis.fetch = originalFetch;
    output.restore();
  }
}

/** Files the test reporter leaves in the OS temp directory. */
async function artifactDirs() {
  return (await readdir(tmpdir())).filter((entry) => entry.startsWith('testops-artifacts-'));
}

/** Real files for path-based attachments. */
async function withFiles(names, body) {
  const dir = await mkdtemp(join(tmpdir(), 'testops-test-'));
  try {
    const paths = {};
    for (const name of names) {
      paths[name] = join(dir, name);
      await writeFile(paths[name], name);
    }
    return await body(paths);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const failed = (extra = {}) => ({ status: 'failed', errors: [{ message: 'boom' }], ...extra });

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

test('a failed test uploads path attachments of every type', async () => {
  await withFiles(['shot.png', 'trace.zip', 'video.webm'], async (paths) => {
    const { calls } = await runReporter([
      fakeTest({
        id: 'pw-1',
        testCaseId: CASE_ID,
        results: [failed({
          attachments: [
            { name: 'screenshot', contentType: 'image/png', path: paths['shot.png'] },
            { name: 'trace', contentType: 'application/zip', path: paths['trace.zip'] },
            { name: 'video', contentType: 'video/webm', path: paths['video.webm'] },
          ],
        })],
      }),
    ]);
    const uploads = calls.filter(isUpload);
    assert.equal(uploads.length, 1);
    assert.deepEqual(uploads[0].form.getAll('files').map((file) => file.name), ['shot.png', 'trace.zip', 'video.webm']);
  });
});

test('body-only attachments and stdout and stderr are uploaded as files with the right extensions', async () => {
  const before = await artifactDirs();
  const { calls } = await runReporter([
    fakeTest({
      id: 'pw-1',
      testCaseId: CASE_ID,
      results: [failed({
        attachments: [
          { name: 'notes', contentType: 'text/plain', body: Buffer.from('hello') },
          { name: 'data.json', contentType: 'application/json', body: Buffer.from('{}') },
        ],
        stdout: ['out ', Buffer.from('put')],
        stderr: ['err'],
      })],
    }),
  ]);
  const files = calls.filter(isUpload).flatMap((call) => call.form.getAll('files'));
  assert.deepEqual(files.map((file) => file.name), ['notes.txt', 'data.json', 'stdout.log', 'stderr.log']);
  assert.equal(await files[0].text(), 'hello');
  assert.equal(await files[2].text(), 'out put');
  assert.deepEqual(await artifactDirs(), before);
});

test('a passed test under the default policy reads and writes nothing', async () => {
  const before = await artifactDirs();
  const { calls } = await runReporter([
    fakeTest({
      id: 'pw-1',
      testCaseId: CASE_ID,
      results: [{
        status: 'passed',
        attachments: [{ name: 'notes', contentType: 'text/plain', body: Buffer.from('hello') }],
        stdout: ['some output'],
      }],
    }),
  ]);
  assert.equal(calls.filter(isUpload).length, 0);
  assert.deepEqual(await artifactDirs(), before);
});

test("only the last retry's attachments are used", async () => {
  await withFiles(['first.png', 'second.png'], async (paths) => {
    const { calls } = await runReporter([
      fakeTest({
        id: 'pw-1',
        testCaseId: CASE_ID,
        results: [
          failed({ attachments: [{ name: 'screenshot', contentType: 'image/png', path: paths['first.png'] }] }),
          failed({ attachments: [{ name: 'screenshot', contentType: 'image/png', path: paths['second.png'] }] }),
        ],
      }),
    ]);
    const files = calls.filter(isUpload).flatMap((call) => call.form.getAll('files'));
    assert.deepEqual(files.map((file) => file.name), ['second.png']);
  });
});

test('the temp directory is removed when sending fails', async () => {
  const before = await artifactDirs();
  const routeMap = { ...routes(), 'POST /projects/p/runs/r1/results/bulk': () => ({ status: 400, body: { message: 'bad' } }) };
  const { outcome } = await runReporter(
    [
      fakeTest({
        id: 'pw-1',
        testCaseId: CASE_ID,
        results: [failed({ attachments: [{ name: 'notes', contentType: 'text/plain', body: Buffer.from('hello') }] })],
      }),
    ],
    { routeMap },
  );
  assert.deepEqual(outcome, { status: 'failed' });
  assert.deepEqual(await artifactDirs(), before);
});
