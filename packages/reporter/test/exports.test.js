import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

// playwright.config.ts and the README locate the reporter with require.resolve, which only
// follows the "require" and "default" export conditions, never "import".
const require = createRequire(import.meta.url);

test('require.resolve finds the reporter entry point', () => {
  assert.match(require.resolve('@testops/reporter'), /index\.js$/);
});

test('require.resolve finds the core subpath', () => {
  assert.match(require.resolve('@testops/reporter/core'), /core\.js$/);
});
