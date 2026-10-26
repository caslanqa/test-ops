import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureConsole, fakeFetch, locationOf, testClient } from './helpers.js';

const C1 = '550e8400-e29b-41d4-a716-446655440001';
const C2 = '550e8400-e29b-41d4-a716-446655440002';
const C3 = '550e8400-e29b-41d4-a716-446655440003';
const SPEC = [
  "import { test } from '@playwright/test';",
  '',
  "test('Open the cart', async () => {});",
  "test('Adding products updates the cart badge', async () => {});",
  "test('Remove the mug', async () => {});",
  '',
].join('\n');
const cases = [
  { id: C1, title: 'Open the cart', automationStatus: 'MANUAL' },
  { id: C2, title: 'Adding products updates the cart badge and totals', automationStatus: 'MANUAL' },
  { id: C3, title: 'Pay with a card', automationStatus: 'MANUAL' },
];

/** Runs syncTests against a spec file in a temp directory; `discover` builds the tests from the file path. */
async function sync({ source = SPEC, options, discover, caseList = cases, packageJson = '{"type":"module"}', expectError = false }) {
  const dir = await mkdtemp(join(tmpdir(), 'testops-test-'));
  const output = captureConsole();
  try {
    const file = join(dir, 'cart.spec.ts');
    await writeFile(join(dir, 'package.json'), packageJson);
    await writeFile(file, source);
    const tests = discover(file, source);
    const { fetch, calls } = fakeFetch({ 'GET /projects/p/cases': () => caseList });
    let error;
    try {
      await testClient(fetch).syncTests(tests, options);
    } catch (caught) {
      if (!expectError) throw caught;
      error = caught;
    }
    return { calls, logs: output.logs, warnings: output.warnings, after: await readFile(file, 'utf8'), source, error };
  } finally {
    output.restore();
    await rm(dir, { recursive: true, force: true });
  }
}

const plain = (file, source, title, text, extra = {}) => ({ title, location: { file, ...locationOf(source, text) }, ...extra });
const unlinkedTests = (file, source) => [
  plain(file, source, 'Open the cart', "('Open the cart'"),
  plain(file, source, 'Adding products updates the cart badge', "('Adding products"),
  plain(file, source, 'Remove the mug', "('Remove the mug'"),
];

test('a dry run lists exact matches and suggestions and leaves files unchanged', async () => {
  const { logs, after, source, calls } = await sync({ options: { link: true }, discover: unlinkedTests });
  assert.equal(after, source);
  assert.equal(calls.filter((call) => call.method !== 'GET').length, 0);
  const text = logs.join('\n');
  assert.match(text, /3 tests have no TestOps ID: 1 match a case by title, 1 is a suggestion, 0 are ambiguous, 1 has no match/);
  assert.match(text, new RegExp(`would link .*cart\\.spec\\.ts:3 "Open the cart".*${C1}`));
  assert.match(text, new RegExp(`suggestion for .*cart\\.spec\\.ts:4.*${C2}`));
  assert.match(text, /no case matches .*Remove the mug/);
  assert.match(text, /dry run only/);
});

test('--link --apply writes IDs for exact matches only', async () => {
  const { after, logs } = await sync({ options: { link: true, apply: true }, discover: unlinkedTests });
  assert.ok(after.startsWith("import { testops } from '@testops/reporter';\n"));
  assert.ok(after.includes(`test('Open the cart', testops('${C1}'), async`));
  assert.ok(after.includes("test('Adding products updates the cart badge', async"));
  assert.ok(after.includes("test('Remove the mug', async"));
  assert.match(logs.join('\n'), /linked 1 test in .*cart\.spec\.ts/);
});

test('a case already linked to another test is not offered', async () => {
  const { logs, after, source } = await sync({
    options: { link: true, apply: true },
    caseList: [{ id: C1, title: 'Open the cart', automationStatus: 'AUTOMATED' }],
    discover: (file, text) => [
      plain(file, text, 'Open the cart', "('Open the cart'", { testCaseId: C1 }),
      plain(file, text, 'Open the cart', "('Adding products", {}),
    ],
  });
  assert.equal(after, source);
  assert.match(logs.join('\n'), /no case matches/);
});

test('the link phase runs when the linked tests are already in sync', async () => {
  const { logs, after } = await sync({
    options: { link: true, apply: true },
    caseList: [
      { id: C3, title: 'Remove the mug', automationStatus: 'AUTOMATED' },
      { id: C1, title: 'Open the cart', automationStatus: 'MANUAL' },
    ],
    discover: (file, text) => [
      plain(file, text, 'Remove the mug', "('Remove the mug'", { testCaseId: C3 }),
      plain(file, text, 'Open the cart', "('Open the cart'"),
    ],
  });
  assert.match(logs.join('\n'), /1 linked test is already in sync/);
  assert.ok(after.includes(`test('Open the cart', testops('${C1}'), async`));
});

test('a test whose edit is refused is printed with file:line and its file is unchanged', async () => {
  const source = [
    "import { test } from '@playwright/test';",
    '',
    "test('Open the cart', { tag: '@x' }, async () => {});",
    '',
  ].join('\n');
  const { warnings, after } = await sync({
    source,
    options: { link: true, apply: true },
    discover: (file, text) => [plain(file, text, 'Open the cart', "('Open the cart'")],
  });
  assert.equal(after, source);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /cart\.spec\.ts:3/);
  assert.match(warnings[0], /second argument/);
});

test('without link nothing changes in how sync behaves', async () => {
  const { logs, after, source } = await sync({ options: { apply: true }, discover: unlinkedTests });
  assert.equal(after, source);
  assert.equal(logs.some((line) => line.includes('TestOps link:')), false);
  assert.match(logs.join('\n'), /0 linked tests are already in sync/);
});

test('tests in a project that is not an ES module project are linked too', async () => {
  const { after, warnings } = await sync({
    options: { link: true, apply: true },
    packageJson: '{}',
    discover: unlinkedTests,
  });
  assert.ok(after.startsWith("import { testops } from '@testops/reporter';\n"));
  assert.ok(after.includes(`test('Open the cart', testops('${C1}'), async`));
  assert.deepEqual(warnings, []);
});

test('--link --apply with narrowed tests refuses before it changes anything', async () => {
  const { error, after, source, calls } = await sync({
    options: { link: true, apply: true, partial: true },
    discover: unlinkedTests,
    expectError: true,
  });
  assert.match(error.message, /without Playwright arguments/);
  assert.equal(after, source);
  assert.equal(calls.filter((call) => call.method !== 'GET').length, 0);
});

test('a dry run with narrowed tests warns that the list may be incomplete', async () => {
  const { warnings, error } = await sync({ options: { link: true, partial: true }, discover: unlinkedTests, expectError: true });
  assert.equal(error, undefined);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Playwright arguments/);
});

test('narrowed tests change nothing for a sync without link', async () => {
  const { warnings, error } = await sync({ options: { apply: true, partial: true }, discover: unlinkedTests, expectError: true });
  assert.equal(error, undefined);
  assert.deepEqual(warnings, []);
});
