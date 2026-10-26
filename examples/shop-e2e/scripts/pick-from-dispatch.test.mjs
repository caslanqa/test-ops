import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { pickGrep } from './pick-from-dispatch.mjs';

const A = '550e8400-e29b-41d4-a716-446655440000';
const B = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const script = fileURLToPath(new URL('./pick-from-dispatch.mjs', import.meta.url));

test('the grep names the tag of every case in the run', () => {
  assert.equal(pickGrep({ automation_case_ids: [A, B] }), `@testops-(${A}|${B})(\\s|$)`);
});

test('a run with no automated cases runs no test', () => {
  assert.equal(pickGrep({}), '(?!)');
  assert.equal(pickGrep({ automation_case_ids: [] }), '(?!)');
  assert.equal(pickGrep(undefined), '(?!)');
});

test('a field that is not a list runs no test', () => {
  assert.equal(pickGrep({ automation_case_ids: A }), '(?!)');
});

test('a value that is not a case ID never reaches the grep', () => {
  assert.equal(pickGrep({ automation_case_ids: ["x') || rm -rf /", 42, null, A] }), `@testops-(${A})(\\s|$)`);
});

test('the command line appends the grep to GITHUB_OUTPUT', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pick-'));
  const event = join(dir, 'event.json');
  const output = join(dir, 'output');
  writeFileSync(event, JSON.stringify({ client_payload: { automation_case_ids: [A] } }));
  writeFileSync(output, 'earlier=1\n');
  execFileSync('node', [script, event], { env: { ...process.env, GITHUB_OUTPUT: output } });
  assert.equal(readFileSync(output, 'utf8'), `earlier=1\ngrep=@testops-(${A})(\\s|$)\n`);
});

test('the command line prints the grep when there is no GITHUB_OUTPUT', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pick-'));
  const event = join(dir, 'event.json');
  writeFileSync(event, JSON.stringify({ client_payload: {} }));
  const env = { ...process.env };
  delete env.GITHUB_OUTPUT;
  assert.equal(execFileSync('node', [script, event], { env, encoding: 'utf8' }), 'grep=(?!)\n');
});
