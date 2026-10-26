import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const script = fileURLToPath(new URL('./create-cases.mjs', import.meta.url));
const definition = JSON.parse(readFileSync(new URL('../cases/cases.json', import.meta.url), 'utf8'));
const caseCount = definition.suites.reduce((sum, suite) => sum + suite.cases.length, 0);

// A TestOps API that keeps suites, cases and defects in memory, enough for the script to talk to.
const store = { suites: [], cases: [], defects: [] };
let nextId = 1;
const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const route = /^\/projects\/p1\/(suites|cases|defects)$/.exec(req.url ?? '');
    if (!route) return void res.writeHead(404).end();
    const list = store[route[1]];
    if (req.method === 'POST') {
      const item = { id: `id-${nextId++}`, ...JSON.parse(Buffer.concat(chunks).toString('utf8')) };
      list.push(item);
      return void res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify(item));
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(list));
  });
});
let api = '';

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  api = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const run = () =>
  promisify(execFile)(process.execPath, [script], {
    env: { ...process.env, TESTOPS_URL: api, TESTOPS_TOKEN: 'token', TESTOPS_PROJECT_ID: 'p1' },
  });
const counts = () => ({ suites: store.suites.length, cases: store.cases.length, defects: store.defects.length });

test('the first run creates every suite, case and defect', async () => {
  await run();
  assert.deepEqual(counts(), { suites: definition.suites.length, cases: caseCount, defects: definition.defects.length });
});

test('a second run adds nothing', async () => {
  const before = counts();
  await run();
  assert.deepEqual(counts(), before);
});

test('a run after testops-sync has renamed the cases still adds nothing', async () => {
  // testops-sync gives each linked case the title of its test, so titles stop matching cases.json.
  for (const testCase of store.cases) testCase.title = testCase.title.toLowerCase().replace(/^customer /, '');
  const before = counts();
  await run();
  assert.deepEqual(counts(), before);
});
