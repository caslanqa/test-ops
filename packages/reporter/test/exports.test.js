import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

// playwright.config.ts and the README locate the reporter with require.resolve, which follows the
// "require" export condition; ES module projects follow "import".
const require = createRequire(import.meta.url);

test('require.resolve finds the CommonJS entry point', () => {
  assert.match(require.resolve('@testops/reporter'), /index\.cjs$/);
});

test('require.resolve finds the CommonJS core subpath', () => {
  assert.match(require.resolve('@testops/reporter/core'), /core\.cjs$/);
});

test('import resolves to the ES module entry points', () => {
  assert.match(import.meta.resolve('@testops/reporter'), /index\.js$/);
  assert.match(import.meta.resolve('@testops/reporter/core'), /core\.js$/);
});

// TypeScript projects that resolve modules like Node (node16, nodenext) and compile to CommonJS read
// the .d.cts files. They are copies of the .d.ts files, with the imports pointing at each other.
test('the .d.cts declarations are copies of the .d.ts declarations', async () => {
  const { readFile } = await import('node:fs/promises');
  const read = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
  const hint = 'Copy the .d.ts file to the .d.cts file and change its "./core.js" import to "./core.cjs".';
  assert.equal(await read('core.d.cts'), await read('core.d.ts'), hint);
  assert.equal(await read('index.d.cts'), (await read('index.d.ts')).replaceAll("'./core.js'", "'./core.cjs'"), hint);
});

test('the package manifest points TypeScript at the matching declarations', async () => {
  const { readFile } = await import('node:fs/promises');
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.exports['.'].require, { types: './index.d.cts', default: './index.cjs' });
  assert.deepEqual(manifest.exports['./core'].require, { types: './core.d.cts', default: './core.cjs' });
  assert.deepEqual(manifest.exports['.'].import, { types: './index.d.ts', default: './index.js' });
  for (const name of ['index.d.cts', 'core.d.cts']) assert.ok(manifest.files.includes(name), `${name} is published`);
});
