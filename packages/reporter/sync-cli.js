#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncTestCases } from './core.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const link = args.includes('--link');
const playwrightArgs = args.filter((arg) => arg !== '--apply' && arg !== '--link');
const require = createRequire(resolve(process.cwd(), 'package.json'));

let playwrightCli;
try {
  playwrightCli = require.resolve('@playwright/test/cli');
} catch {
  console.error('TestOps sync: install @playwright/test in this project before running testops-sync.');
  process.exit(1);
}

const syncReporter = fileURLToPath(new URL('./sync-reporter.js', import.meta.url));
const output = join(tmpdir(), `testops-sync-${randomUUID()}.json`);
try {
  const result = spawnSync(process.execPath, [
    playwrightCli,
    'test',
    '--list',
    '--reporter',
    syncReporter,
    ...playwrightArgs,
  ], {
    stdio: 'inherit',
    env: { ...process.env, TESTOPS_SYNC_OUTPUT: output },
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else {
    const tests = JSON.parse(readFileSync(output, 'utf8'));
    // Playwright arguments (a file, --grep, --project) narrow the tests the sync sees.
    await syncTestCases(tests, { apply, link, partial: playwrightArgs.length > 0 });
  }
} catch (error) {
  console.error(`TestOps sync: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  rmSync(output, { force: true });
}
