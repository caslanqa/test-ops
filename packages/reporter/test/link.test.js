import assert from 'node:assert/strict';
import test from 'node:test';
import { IMPORT_LINE, linkTestsInSource } from '../link.js';
import { locationOf } from './helpers.js';

const ID1 = '550e8400-e29b-41d4-a716-446655440000';
const ID2 = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const ID3 = '9b2f4c1e-3d5a-4f7b-8c6d-1a2b3c4d5e6f';
const PLAYWRIGHT_IMPORT = "import { test } from '@playwright/test';";

const link = (source, text, testCaseId = ID1) => ({ ...locationOf(source, text), testCaseId });
const linked = (id) => `, testops('${id}')`;

test('inserts testops after a plain string title and adds the import before the first import', () => {
  const source = [PLAYWRIGHT_IMPORT, '', "test('plain', async ({ page }) => {});", ''].join('\n');
  const result = linkTestsInSource(source, [link(source, "('plain'")]);
  assert.equal(result.source, [IMPORT_LINE, PLAYWRIGHT_IMPORT, '', `test('plain'${linked(ID1)}, async ({ page }) => {});`, ''].join('\n'));
  assert.equal(result.linked, 1);
  assert.deepEqual(result.skipped, []);
});

test('handles test.only, test.skip and test.fixme', () => {
  const source = [PLAYWRIGHT_IMPORT, "test.only('a', async () => {});", "test.skip('b', async () => {});", "test.fixme('c', () => {});"].join('\n');
  const result = linkTestsInSource(source, [
    link(source, "only('a'", ID1),
    link(source, "skip('b'", ID2),
    link(source, "fixme('c'", ID3),
  ]);
  assert.equal(result.linked, 3);
  assert.ok(result.source.includes(`test.only('a'${linked(ID1)}, async`));
  assert.ok(result.source.includes(`test.skip('b'${linked(ID2)}, async`));
  assert.ok(result.source.includes(`test.fixme('c'${linked(ID3)}, () =>`));
});

test('a test with a details object is skipped with a reason and the file is unchanged', () => {
  const source = [
    PLAYWRIGHT_IMPORT,
    "test('with details', { tag: '@x' }, async () => {});",
    "test('with a helper', demoTestops('x'), async () => {});",
  ].join('\n');
  const result = linkTestsInSource(source, [link(source, "('with details'"), link(source, "('with a helper'", ID2)]);
  assert.equal(result.source, source);
  assert.equal(result.linked, 0);
  assert.deepEqual(result.skipped.map((item) => item.line), [2, 3]);
  assert.match(result.skipped[0].reason, /second argument/);
});

test('a template-literal title is skipped', () => {
  const source = [PLAYWRIGHT_IMPORT, 'test(`template ${name}`, async () => {});'].join('\n');
  const result = linkTestsInSource(source, [link(source, '(`template')]);
  assert.equal(result.source, source);
  assert.match(result.skipped[0].reason, /string literal/);
});

test('single and double quoted titles with an escaped quote and non-ASCII characters are handled', () => {
  const source = [
    PLAYWRIGHT_IMPORT,
    String.raw`test('it\'s fine', async () => {});`,
    String.raw`test("say \"hi\"", async () => {});`,
    "test('ünïcode — ok', async () => {});",
  ].join('\n');
  const result = linkTestsInSource(source, [
    link(source, "('it\\'s", ID1),
    link(source, '("say', ID2),
    link(source, "('ünïcode", ID3),
  ]);
  assert.equal(result.linked, 3);
  assert.ok(result.source.includes(String.raw`test('it\'s fine'${linked(ID1)}, async`));
  assert.ok(result.source.includes(String.raw`test("say \"hi\""${linked(ID2)}, async`));
  assert.ok(result.source.includes(`test('ünïcode — ok'${linked(ID3)}, async`));
});

test('two tests in one file are linked from the bottom up and the expected full output matches', () => {
  const source = [PLAYWRIGHT_IMPORT, '', "test('first', async () => {});", "test('second', async () => {});"].join('\n');
  const result = linkTestsInSource(source, [link(source, "('first'", ID1), link(source, "('second'", ID2)]);
  assert.equal(result.source, [
    IMPORT_LINE,
    PLAYWRIGHT_IMPORT,
    '',
    `test('first'${linked(ID1)}, async () => {});`,
    `test('second'${linked(ID2)}, async () => {});`,
  ].join('\n'));
  assert.equal(result.linked, 2);
});

test('CRLF line endings are preserved', () => {
  const source = [PLAYWRIGHT_IMPORT, '', "test('plain', async () => {});", ''].join('\r\n');
  const result = linkTestsInSource(source, [link(source, "('plain'")]);
  assert.equal(result.linked, 1);
  assert.ok(result.source.startsWith(`${IMPORT_LINE}\r\n${PLAYWRIGHT_IMPORT}\r\n`));
  assert.equal(result.source.replaceAll('\r\n', '').includes('\n'), false);
});

test('an existing named import of testops is not duplicated', () => {
  const source = [PLAYWRIGHT_IMPORT, "import { syncTestCases, testops } from '@testops/reporter';", "test('plain', async () => {});"].join('\n');
  const result = linkTestsInSource(source, [link(source, "('plain'")]);
  assert.equal(result.linked, 1);
  assert.equal(result.source.split("'@testops/reporter'").length - 1, 1);
});

test('a default-only import from @testops/reporter gets an added named import line', () => {
  const source = [PLAYWRIGHT_IMPORT, "import TestOpsReporter from '@testops/reporter';", "test('plain', async () => {});"].join('\n');
  const result = linkTestsInSource(source, [link(source, "('plain'")]);
  assert.equal(result.linked, 1);
  assert.ok(result.source.startsWith(`${IMPORT_LINE}\n`));
  assert.equal(result.source.split("'@testops/reporter'").length - 1, 2);
});

test('a file without a top-level import is skipped entirely with a reason that names the import', () => {
  const source = ["const { test } = require('@playwright/test');", "test('a', async () => {});"].join('\n');
  const result = linkTestsInSource(source, [link(source, "('a'")]);
  assert.equal(result.source, source);
  assert.equal(result.linked, 0);
  assert.match(result.skipped[0].reason, /import/);
});

test('a location that does not point at a test call is skipped', () => {
  const source = [PLAYWRIGHT_IMPORT, "test('plain', async () => {});"].join('\n');
  const result = linkTestsInSource(source, [
    { line: 1, column: 1, testCaseId: ID1 },
    { line: 99, column: 1, testCaseId: ID2 },
  ]);
  assert.equal(result.source, source);
  assert.equal(result.linked, 0);
  assert.equal(result.skipped.length, 2);
  assert.match(result.skipped[0].reason, /test call/);
});

test('an ID that is not a UUID is never written into the source', () => {
  const source = [PLAYWRIGHT_IMPORT, "test('plain', async () => {});"].join('\n');
  const result = linkTestsInSource(source, [{ ...locationOf(source, "('plain'"), testCaseId: "x'); process.exit(1); //" }]);
  assert.equal(result.source, source);
  assert.equal(result.linked, 0);
  assert.match(result.skipped[0].reason, /UUID/);
});

const BOM = String.fromCharCode(0xfeff);
const CR = String.fromCharCode(13);
const BACKSLASH = String.fromCharCode(92);

test('an import line inside a block comment is not taken for the first import', () => {
  const source = ['/*', "import old from 'x';", '*/', PLAYWRIGHT_IMPORT, "test('plain', async () => {});"].join('\n');
  const result = linkTestsInSource(source, [link(source, "('plain'")]);
  assert.equal(result.source, ['/*', "import old from 'x';", '*/', IMPORT_LINE, PLAYWRIGHT_IMPORT, `test('plain'${linked(ID1)}, async () => {});`].join('\n'));
});

test('a commented-out testops import does not stand in for the real one', () => {
  const source = [PLAYWRIGHT_IMPORT, "// import { testops } from '@testops/reporter';", "test('plain', async () => {});"].join('\n');
  const result = linkTestsInSource(source, [link(source, "('plain'")]);
  assert.equal(result.linked, 1);
  assert.ok(result.source.startsWith(`${IMPORT_LINE}\n${PLAYWRIGHT_IMPORT}\n`));
});

test('a string that looks like the start of a comment does not hide the imports after it', () => {
  const source = ["const note = '/* not a comment';", PLAYWRIGHT_IMPORT, "test('plain', async () => {});"].join('\n');
  const result = linkTestsInSource(source, [link(source, "('plain'")]);
  assert.equal(result.linked, 1);
  assert.ok(result.source.includes(`${IMPORT_LINE}\n${PLAYWRIGHT_IMPORT}`));
});

test('a testops name that another import already binds refuses the file', () => {
  const source = [PLAYWRIGHT_IMPORT, "import { testops } from './helpers';", "test('plain', async () => {});"].join('\n');
  const result = linkTestsInSource(source, [link(source, "('plain'")]);
  assert.equal(result.source, source);
  assert.equal(result.linked, 0);
  assert.match(result.skipped[0].reason, /testops/);
});

test('a byte order mark before the first import is kept and the import goes after it', () => {
  const source = BOM + [PLAYWRIGHT_IMPORT, "test('plain', async () => {});"].join('\n');
  const result = linkTestsInSource(source, [link(source, "('plain'")]);
  assert.equal(result.linked, 1);
  assert.ok(result.source.startsWith(`${BOM}${IMPORT_LINE}\n${PLAYWRIGHT_IMPORT}`));
});

test('a lone CR counts as a line break, like in the line numbers Playwright reports', () => {
  const source = [PLAYWRIGHT_IMPORT, `/* a${CR}b */`, "test('plain', async () => {});", ''].join('\n');
  // The CR inside the comment starts a line, so the test is on line 4.
  const result = linkTestsInSource(source, [{ line: 4, column: 5, testCaseId: ID1, title: 'plain' }]);
  assert.equal(result.linked, 1);
  assert.deepEqual(result.skipped, []);
});

test('a location that belongs to a different test is skipped when the title does not match', () => {
  const source = [PLAYWRIGHT_IMPORT, "test('first', async () => {});", "test('second', async () => {});"].join('\n');
  const result = linkTestsInSource(source, [{ ...locationOf(source, "('first'"), testCaseId: ID1, title: 'second' }]);
  assert.equal(result.source, source);
  assert.equal(result.linked, 0);
  assert.match(result.skipped[0].reason, /"first".*"second"/);
});

test('the title is compared after the escapes in the literal are resolved', () => {
  const literal = `it${BACKSLASH}'s ${BACKSLASH}u00fc ${BACKSLASH}x41 ${BACKSLASH}u{1F600}`;
  const title = `it's ${String.fromCharCode(0xfc)} A ${String.fromCodePoint(0x1f600)}`;
  const source = [PLAYWRIGHT_IMPORT, `test('${literal}', async () => {});`].join('\n');
  const result = linkTestsInSource(source, [{ ...locationOf(source, "('it"), testCaseId: ID1, title }]);
  assert.equal(result.linked, 1);
  assert.deepEqual(result.skipped, []);
});
