import assert from 'node:assert/strict';
import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { API_BASE, captureConsole, fakeFetch, testClient } from './helpers.js';

const run = { id: 'r1', runCases: [{ testCaseId: 'c1', executionMode: 'AUTOMATED' }] };
const isUpload = (call) => call.path.endsWith('/attachments');

function routes(uploadAnswer = () => ({})) {
  return {
    'GET /projects/p/runs/r1': () => run,
    'POST /projects/p/runs/r1/results/bulk': ({ body }) => ({ results: body.results.map((_, index) => ({ id: `x${index}` })) }),
    'POST /projects/p/results/x0/attachments': uploadAnswer,
  };
}

/** Runs one result with the given files in a temp directory; returns the calls and warnings. */
async function report({ status = 'FAILED', files, overrides = {}, routeMap = routes() }) {
  const dir = await mkdtemp(join(tmpdir(), 'testops-test-'));
  const output = captureConsole();
  try {
    const attachments = [];
    for (const file of files) {
      const path = join(dir, file.name);
      if (!file.missing) {
        await writeFile(path, 'content');
        // A sparse file reaches the size limit without writing the bytes.
        if (file.size) await truncate(path, file.size);
      }
      attachments.push({ path, contentType: 'application/octet-stream' });
    }
    const { fetch, calls } = fakeFetch(routeMap);
    await testClient(fetch, { runId: 'r1', ...overrides }).report([
      { testCaseId: 'c1', externalTestId: 't1', title: 'one', status, attachments },
    ]);
    return { calls, warnings: output.warnings };
  } finally {
    output.restore();
    await rm(dir, { recursive: true, force: true });
  }
}

test('25 small files are uploaded in two requests of 20 and 5', async () => {
  const files = Array.from({ length: 25 }, (_, index) => ({ name: `f${index}.txt` }));
  const { calls } = await report({ files });
  const uploads = calls.filter(isUpload);
  assert.deepEqual(uploads.map((call) => call.form.getAll('files').length), [20, 5]);
});

test('an oversize file and a missing file warn and the others upload', async () => {
  const { calls, warnings } = await report({
    files: [{ name: 'ok.txt' }, { name: 'huge.webm', size: 33 * 1024 * 1024 }, { name: 'gone.png', missing: true }],
  });
  const uploads = calls.filter(isUpload);
  assert.equal(uploads.length, 1);
  assert.deepEqual(uploads[0].form.getAll('files').map((file) => file.name), ['ok.txt']);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.some((line) => line.includes('huge.webm') && line.includes('32 MB')));
  assert.ok(warnings.some((line) => line.includes('gone.png')));
});

test('a passed result gets no upload under the default policy and uploads under all', async () => {
  const files = [{ name: 'shot.png' }];
  assert.equal((await report({ status: 'PASSED', files })).calls.filter(isUpload).length, 0);
  assert.equal((await report({ status: 'PASSED', files, overrides: { attachments: 'all' } })).calls.filter(isUpload).length, 1);
  assert.equal((await report({ status: 'FAILED', files, overrides: { attachments: 'none' } })).calls.filter(isUpload).length, 0);
});

test('a failing upload warns and the result is still reported', async () => {
  const { calls, warnings } = await report({
    files: [{ name: 'shot.png' }],
    routeMap: routes(() => ({ status: 400, body: { message: 'bad file' } })),
  });
  assert.equal(calls.filter((call) => call.path.endsWith('/results/bulk')).length, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /attachments for "one" could not be uploaded/);
  assert.match(warnings[0], /400/);
});

test('a group the server refuses is resent file by file', async () => {
  const { calls, warnings } = await report({
    files: [{ name: 'shot.png' }, { name: 'trace.zip' }, { name: 'log.txt' }],
    routeMap: routes(({ form }) => (form.getAll('files').length > 1 ? { status: 413, body: { message: 'too large' } } : {})),
  });
  const uploads = calls.filter(isUpload);
  assert.deepEqual(uploads.map((call) => call.form.getAll('files').length), [3, 1, 1, 1]);
  assert.deepEqual(warnings, []);
});

test('only the file the server still refuses on its own warns', async () => {
  const { calls, warnings } = await report({
    files: [{ name: 'shot.png' }, { name: 'bad.txt' }, { name: 'log.txt' }],
    routeMap: routes(({ form }) => {
      const names = form.getAll('files').map((file) => file.name);
      return names.includes('bad.txt') ? { status: 400, body: { message: 'refused' } } : {};
    }),
  });
  const uploaded = calls.filter(isUpload).filter((call) => call.form.getAll('files').length === 1)
    .map((call) => call.form.getAll('files')[0].name);
  assert.deepEqual(uploaded, ['shot.png', 'bad.txt', 'log.txt']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /bad\.txt/);
});

test('a large file is sent from disk and not copied into memory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'testops-test-'));
  const output = captureConsole();
  try {
    const path = join(dir, 'big.zip');
    await writeFile(path, 'x');
    await truncate(path, 30 * 1024 * 1024);
    const baseline = process.memoryUsage().arrayBuffers;
    let during;
    const fetch = async (url, init = {}) => {
      const requested = String(url).slice(API_BASE.length);
      if (requested.endsWith('/attachments')) {
        during = process.memoryUsage().arrayBuffers;
        return new Response('{}');
      }
      if (init.method === 'GET') return new Response(JSON.stringify(run));
      if (requested.endsWith('/results/bulk')) return new Response(JSON.stringify({ results: [{ id: 'x0' }] }));
      return new Response('{}');
    };
    await testClient(fetch, { runId: 'r1' }).report([
      { testCaseId: 'c1', externalTestId: 't1', title: 'one', status: 'FAILED', attachments: [{ path, contentType: 'application/zip' }] },
    ]);
    assert.notEqual(during, undefined, 'the upload request was made');
    assert.ok(during - baseline < 8 * 1024 * 1024, `the upload held ${Math.round((during - baseline) / 1024 / 1024)} MB in memory`);
  } finally {
    output.restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test('after a network failure the remaining uploads are skipped with one more warning', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'testops-test-'));
  const output = captureConsole();
  try {
    const path = join(dir, 'f.txt');
    await writeFile(path, 'content');
    const { fetch, calls } = fakeFetch({
      'GET /projects/p/runs/r1': () => ({ id: 'r1', runCases: [{ testCaseId: 'c1', executionMode: 'AUTOMATED' }, { testCaseId: 'c2', executionMode: 'AUTOMATED' }] }),
      'POST /projects/p/runs/r1/results/bulk': ({ body }) => ({ results: body.results.map((_, index) => ({ id: `x${index}` })) }),
      'POST /projects/p/results/x0/attachments': () => { throw new Error('connection reset'); },
      'POST /projects/p/results/x1/attachments': () => ({}),
    });
    const failed = (id) => ({ testCaseId: id, externalTestId: `t-${id}`, title: id, status: 'FAILED', attachments: [{ path, contentType: 'text/plain' }] });
    await testClient(fetch, { runId: 'r1' }).report([failed('c1'), failed('c2')]);
    assert.equal(calls.filter(isUpload).length, 1);
    assert.equal(output.warnings.length, 2);
    assert.match(output.warnings[0], /connection reset/);
    assert.match(output.warnings[1], /uploads are skipped/);
  } finally {
    output.restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a file that cannot be read does not stop the uploads of the next result', async () => {
  const { calls } = await report({ files: [{ name: 'gone.png', missing: true }, { name: 'ok.txt' }] });
  assert.equal(calls.filter(isUpload).length, 1);
});
