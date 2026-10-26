// AI assistant smoke test: who may define the AI provider, which setting applies to a project, and what the
// API never gives back. Runs against a running stack and creates its own data:
//   docker compose up -d --wait && docker compose exec -T app node prisma/seed.js
//   node tests/smoke/ai.mjs
//   AI_ENCRYPTION_KEY= docker compose up -d --wait app && node tests/smoke/ai.mjs --no-key
// Requires SELF_REGISTRATION=true (the default) and, for the first form, an AI_ENCRYPTION_KEY in the stack
// (scripts/ensure-env.sh makes one). The target can be changed with BASE, ADMIN_EMAIL and ADMIN_PASSWORD;
// the database facts are read with `docker compose exec postgres psql`.
//
// The rule (README, "AI assistant"): workspace admins define the workspace default and project admins their
// project's setting, which replaces the default whole; Tester, Automation, Viewer and API tokens cannot.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:8080/api/v1';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@testops.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';
const PASSWORD = 'AiSmokePass123';
const SECRET = 'sk-secret-1';
const ENDPOINT = 'http://127.0.0.1:8098/v1';
const noKey = process.argv.includes('--no-key');
const sfx = Date.now().toString(36);
let failures = 0;

async function call(token, method, path, body) {
  // Sign-up and sign-in allow only a few attempts a minute, so a run that follows another suite waits out a
  // 429 instead of failing.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 61_000));
      continue;
    }
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
    return { status: res.status, json, text };
  }
}
async function ok(token, method, path, body) {
  const r = await call(token, method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${r.text}`);
  return r.json;
}
function check(label, pass, detail = '') {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${pass ? '' : ` ${detail}`}`);
}
async function expectStatus(label, expected, token, method, path, body) {
  const r = await call(token, method, path, body);
  check(`[${r.status}] ${label}`, r.status === expected, `(expected ${expected}) ${r.text}`);
  return r;
}
const psql = (sql) =>
  execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'testops', '-d', 'testops', '-At', '-c', sql], {
    encoding: 'utf8',
    // The error text is read from the thrown error when a statement is meant to fail; it isn't echoed.
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const keys = (object) => Object.keys(object ?? {}).sort().join(',');

/** Runs a piece of JavaScript inside the app container and returns what it printed. */
const inApp = (code) =>
  execFileSync('docker', ['compose', 'exec', '-T', 'app', 'node', '-e', code], { encoding: 'utf8' }).trim();
const fakeUrl = 'http://127.0.0.1:8098';
const fromFake = (path, method = 'GET') =>
  inApp(`fetch('${fakeUrl}${path}',{method:'${method}'}).then(r=>r.text()).then(t=>process.stdout.write(t))`);
const lastRequest = () => JSON.parse(fromFake('/__last'));
/** Starts the fake provider (tests/smoke/fake-ai-provider.cjs) in the app container and waits until it listens. */
async function startFakeProvider() {
  try { fromFake('/__quit', 'POST'); } catch { /* none was running */ }
  await new Promise((resolve) => setTimeout(resolve, 400));
  const child = spawn('docker', ['compose', 'exec', '-T', 'app', 'node', '-'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const ready = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 20_000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('READY')) {
        clearTimeout(timer);
        resolve(true);
      }
    });
    child.stdin.write(readFileSync(new URL('./fake-ai-provider.cjs', import.meta.url)));
    child.stdin.end();
  });
  check('the fake provider started in the app container', ready);
  process.on('exit', () => {
    try { fromFake('/__quit', 'POST'); } catch { /* already gone */ }
    child.kill();
  });
}

const admin = (await ok(null, 'POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).accessToken;

console.log('--- Setup ---');
const ws = await ok(admin, 'POST', '/workspaces', { name: 'AI test', slug: `ai-${sfx}` });
const project = await ok(admin, 'POST', `/workspaces/${ws.id}/projects`, { key: 'AI', name: 'AI project' });
const WS = `/workspaces/${ws.id}/ai`;
const PS = `/projects/${project.id}/ai/settings`;
const STATUS = `/projects/${project.id}/ai/status`;
const workspaceDefault = { provider: 'OPENAI_COMPATIBLE', model: 'm1', endpoint: ENDPOINT, credential: SECRET };

if (noKey) {
  console.log('--- Without an AI_ENCRYPTION_KEY ---');
  const withCredential = await call(admin, 'PUT', WS, workspaceDefault);
  check(`[${withCredential.status}] saving a provider key is refused`, withCredential.status === 409, withCredential.text);
  check('...and the refusal names AI_ENCRYPTION_KEY', String(withCredential.json?.message).includes('AI_ENCRYPTION_KEY'), withCredential.text);
  const { credential: _credential, ...keyless } = workspaceDefault;
  const withoutCredential = await expectStatus('a setting without a provider key is saved', 200, admin, 'PUT', WS, keyless);
  check('...with no key on record', withoutCredential.json?.hasCredential === false, withoutCredential.text);
  console.log(failures === 0 ? '\nAll AI checks passed.' : `\n${failures} AI check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

const register = (body) => ok(null, 'POST', '/auth/register', body);

/**
 * An account that joined the workspace by invitation, with `projectRole` in the project (none when null) or,
 * with `workspaceRole` ADMIN, as a workspace admin. The role is given through the workspace permissions API,
 * which only a web session may call.
 */
async function makeUser(label, projectRole, workspaceRole = 'MEMBER') {
  const email = `${label}-${sfx}@ai.test`;
  const invitation = await ok(admin, 'POST', `/workspaces/${ws.id}/invitations`, { email, role: workspaceRole });
  const session = await register({ email, displayName: label, password: PASSWORD, inviteToken: invitation.token });
  const user = { label, email, id: session.user.id, token: session.accessToken };
  if (projectRole) {
    await ok(admin, 'PUT', `/workspaces/${ws.id}/permissions/projects/${project.id}/users/${user.id}`, { role: projectRole });
  }
  return user;
}

const pa = await makeUser('pa', 'ADMIN');
const tester = await makeUser('tester', 'TESTER');
const viewer = await makeUser('viewer', 'VIEWER');
const automation = await makeUser('automation', 'AUTOMATION');
const wsAdmin = await makeUser('wsadmin', null, 'ADMIN');
const adminToken = (await ok(admin, 'POST', '/api-tokens', { name: 'ai smoke' })).token;

console.log('--- Who may define, read and remove settings ---');
for (const user of [tester, automation, viewer]) {
  await expectStatus(`${user.label}: GET project settings`, 403, user.token, 'GET', PS);
  await expectStatus(`${user.label}: PUT project settings`, 403, user.token, 'PUT', PS, workspaceDefault);
  await expectStatus(`${user.label}: DELETE project settings`, 403, user.token, 'DELETE', PS);
  await expectStatus(`${user.label} reads only the status`, 200, user.token, 'GET', STATUS);
}
await expectStatus('a project admin cannot read the workspace default', 403, pa.token, 'GET', WS);
await expectStatus('a project admin cannot define the workspace default', 403, pa.token, 'PUT', WS, workspaceDefault);
await expectStatus('a workspace member without a project role cannot read the workspace default', 403, tester.token, 'GET', WS);
await expectStatus('an API token cannot define the workspace default', 403, adminToken, 'PUT', WS, workspaceDefault);
await expectStatus('an API token cannot define a project setting', 403, adminToken, 'PUT', PS, workspaceDefault);
await expectStatus('an API token cannot read the workspace default', 403, adminToken, 'GET', WS);

console.log('--- Workspace default ---');
const none = await ok(admin, 'GET', WS);
check('before anything is saved there is no setting', none.settings === null, JSON.stringify(none));
const saved = await call(admin, 'PUT', WS, workspaceDefault);
check(`[${saved.status}] a workspace admin defines the workspace default`, saved.status === 200, saved.text);
check('...it has a key on record', saved.json?.hasCredential === true && saved.json?.scope === 'WORKSPACE', saved.text);
check('...and the answer carries neither the key nor its ciphertext', !saved.text.includes(SECRET) && !saved.text.includes('credentialCipher'), saved.text);
const readBack = await ok(admin, 'GET', WS);
check('reading it back also hides the key', readBack.settings?.hasCredential === true && !JSON.stringify(readBack).includes(SECRET), JSON.stringify(readBack));
const defaultStatus = await ok(tester.token, 'GET', STATUS);
check('a member sees the default applies, switched off', defaultStatus.enabled === false && defaultStatus.source === 'WORKSPACE', JSON.stringify(defaultStatus));
await expectStatus('it cannot be switched on before a connection test', 409, admin, 'PUT', WS, { ...workspaceDefault, enabled: true });

console.log('--- Validation ---');
await expectStatus('an endpoint must be http or https', 400, admin, 'PUT', WS, { ...workspaceDefault, endpoint: 'ftp://example.com' });
await expectStatus('an endpoint carries no credentials', 400, admin, 'PUT', WS, { ...workspaceDefault, endpoint: 'http://user:pw@example.com/v1' });
await expectStatus('an OpenAI-compatible setting needs an endpoint', 400, admin, 'PUT', WS, { provider: 'OPENAI_COMPATIBLE', model: 'm1' });
await expectStatus('an unknown provider is refused', 400, admin, 'PUT', WS, { ...workspaceDefault, provider: 'MADE_UP' });
await expectStatus('too small an output limit is refused', 400, admin, 'PUT', WS, { ...workspaceDefault, maxOutputTokens: 100 });
await expectStatus('too short a timeout is refused', 400, admin, 'PUT', WS, { ...workspaceDefault, requestTimeoutMs: 1000 });
await expectStatus('a daily limit of zero is refused', 400, admin, 'PUT', WS, { ...workspaceDefault, maxRunsPerUserPerDay: 0 });

console.log('--- A project setting ---');
const mine = { provider: 'OPENAI_COMPATIBLE', model: 'p-model', endpoint: ENDPOINT, credential: 'sk-project-1' };
const projectSaved = await call(pa.token, 'PUT', PS, mine);
check(`[${projectSaved.status}] a project admin defines their project's setting`, projectSaved.status === 200 && projectSaved.json?.scope === 'PROJECT', projectSaved.text);
check('...the answer hides the key', !projectSaved.text.includes('sk-project-1'), projectSaved.text);
const projectStatus = await ok(viewer.token, 'GET', STATUS);
check('the project setting now applies', projectStatus.source === 'PROJECT' && projectStatus.enabled === false, JSON.stringify(projectStatus));
const both = await ok(pa.token, 'GET', PS);
check('the project admin sees their own setting', both.own?.model === 'p-model' && both.own?.hasCredential === true && both.source === 'PROJECT', JSON.stringify(both));
check('...and the workspace default beside it', both.inherited?.model === 'm1' && both.inherited?.hasCredential === true, JSON.stringify(both));
check('...which shows no key, no limits and no ids', keys(both.inherited) === 'enabled,endpoint,hasCredential,model,provider', keys(both.inherited));
check('...and nothing anywhere holds a key', !JSON.stringify(both).includes(SECRET) && !JSON.stringify(both).includes('sk-project-1'));

const keepsKey = await ok(pa.token, 'PUT', PS, { provider: 'OPENAI_COMPATIBLE', model: 'p-model-2', endpoint: ENDPOINT });
check('saving the same endpoint without a key keeps the saved key', keepsKey.hasCredential === true && keepsKey.model === 'p-model-2', JSON.stringify(keepsKey));
const movedEndpoint = await ok(pa.token, 'PUT', PS, { provider: 'OPENAI_COMPATIBLE', model: 'p-model-2', endpoint: `${ENDPOINT}/other` });
check('pointing it at another endpoint without a key drops the saved key', movedEndpoint.hasCredential === false, JSON.stringify(movedEndpoint));
const newKey = await ok(pa.token, 'PUT', PS, { ...mine, endpoint: `${ENDPOINT}/other` });
check('...and a key sent with the new endpoint is kept', newKey.hasCredential === true, JSON.stringify(newKey));
const cleared = await ok(pa.token, 'PUT', PS, { provider: 'OPENAI_COMPATIBLE', model: 'p-model-2', endpoint: `${ENDPOINT}/other`, clearCredential: true });
check('a key can be removed', cleared.hasCredential === false, JSON.stringify(cleared));
await expectStatus('Anthropic needs a key before it can be switched on', 409, pa.token, 'PUT', PS, { provider: 'ANTHROPIC', model: 'p-model-2', enabled: true });

const outside = await call(wsAdmin.token, 'GET', PS);
check(`[${outside.status}] a workspace admin who is not a project member reads the project setting`, outside.status === 200, outside.text);
await expectStatus('...and defines it', 200, wsAdmin.token, 'PUT', PS, mine);

await expectStatus('removing the project setting', 204, pa.token, 'DELETE', PS);
const afterRemove = await ok(tester.token, 'GET', STATUS);
check('the workspace default applies again', afterRemove.source === 'WORKSPACE', JSON.stringify(afterRemove));
const afterRemoveView = await ok(pa.token, 'GET', PS);
check('...and the project has no setting of its own', afterRemoveView.own === null && afterRemoveView.source === 'WORKSPACE', JSON.stringify(afterRemoveView));
await expectStatus('removing it again is a 404', 404, pa.token, 'DELETE', PS);

console.log('--- Connection test ---');
await startFakeProvider();
const openAi = (model, extra = {}) => ({ provider: 'OPENAI_COMPATIBLE', model, endpoint: ENDPOINT, ...extra });
const testWorkspace = () => call(admin, 'POST', `${WS}/test`);
const workspaceView = async () => (await ok(admin, 'GET', WS)).settings;

await ok(admin, 'PUT', WS, openAi('ok'));
const passed = await testWorkspace();
check(`[${passed.status}] a working provider passes the test`, passed.status === 200 && passed.json?.ok === true && typeof passed.json?.latencyMs === 'number', passed.text);
check('...which is recorded', (await workspaceView()).testedAt !== null);
const sent = await lastRequest();
check('the request went to chat completions with the saved key', sent.path === '/v1/chat/completions' && sent.headers.authorization === `Bearer ${SECRET}`, JSON.stringify(sent));
check('...asking for the answer in a JSON schema', sent.body.response_format?.type === 'json_schema' && sent.body.response_format.json_schema?.strict === true && sent.body.model === 'ok', JSON.stringify(sent.body));
check('...with the output limit from the settings', sent.body.max_tokens === 256, String(sent.body.max_tokens));
check('...and no project data in it', !JSON.stringify(sent.body).includes('AI project') && !JSON.stringify(sent.body).includes(project.id));
await expectStatus('a tested setting can be switched on', 200, admin, 'PUT', WS, openAi('ok', { enabled: true }));
const nowOn = await ok(tester.token, 'GET', STATUS);
check('...and then applies to the project', nowOn.enabled === true && nowOn.source === 'WORKSPACE', JSON.stringify(nowOn));
await ok(admin, 'PUT', WS, openAi('ok-2'));
const afterModelChange = await workspaceView();
check('changing only the model clears the test and switches AI off', afterModelChange.testedAt === null && afterModelChange.enabled === false, JSON.stringify(afterModelChange));

for (const [model, label, fits] of [
  ['fail500', 'an HTTP error shows only its status for a private address', (e) => e.includes('500') && !e.includes('INTERNAL-SECRET-BODY')],
  ['bad-json', 'an answer that is not JSON', (e) => /valid JSON/.test(e)],
  ['invalid', 'an answer that does not fit the schema', (e) => /shape/.test(e)],
  ['huge', 'an answer over 2 MiB', (e) => e.includes('2 MiB')],
  ['redirect', 'a redirect is not followed', (e) => e.includes('302')],
  ['unsupported', 'a server without structured output', (e) => /structured output/.test(e)],
]) {
  await ok(admin, 'PUT', WS, openAi(model));
  const failed = await testWorkspace();
  check(`[${failed.status}] ${label} fails the test`, failed.status === 200 && failed.json?.ok === false && fits(String(failed.json?.error)), failed.text);
  check('...and leaves AI untested', (await workspaceView()).testedAt === null);
}
await ok(admin, 'PUT', WS, openAi('slow', { requestTimeoutMs: 5000 }));
const slow = await testWorkspace();
check(`[${slow.status}] a provider that does not answer in time fails the test`, slow.json?.ok === false && String(slow.json?.error).includes('No answer within 5 s'), slow.text);
await ok(admin, 'PUT', WS, openAi('ok', { requestTimeoutMs: 120000 }));

await ok(admin, 'PUT', WS, { provider: 'ANTHROPIC', model: 'ok', endpoint: fakeUrl, credential: 'sk-anthropic-1' });
const anthropic = await testWorkspace();
check(`[${anthropic.status}] the Anthropic provider passes the test`, anthropic.json?.ok === true, anthropic.text);
const anthropicSent = await lastRequest();
check('...through the Messages API with its own headers', anthropicSent.path === '/v1/messages' && anthropicSent.headers['x-api-key'] === 'sk-anthropic-1' && Boolean(anthropicSent.headers['anthropic-version']), JSON.stringify(anthropicSent.headers));
check('...forcing the one tool', anthropicSent.body.tool_choice?.type === 'tool' && anthropicSent.body.tools?.length === 1 && anthropicSent.body.tools[0].name === anthropicSent.body.tool_choice.name, JSON.stringify(anthropicSent.body));
await ok(admin, 'PUT', WS, openAi('ok', { credential: SECRET }));
check('going back to the other provider needs a new test', (await workspaceView()).testedAt === null);
check('...which passes again', (await testWorkspace()).json?.ok === true);
await expectStatus('...and AI is switched on for the rest of the run', 200, admin, 'PUT', WS, openAi('ok', { enabled: true }));

console.log('--- Where the endpoint may point ---');
await expectStatus('a link-local address (cloud metadata) is refused', 400, admin, 'PUT', WS, openAi('ok', { endpoint: 'http://169.254.169.254/v1' }));
await expectStatus('...also written as an IPv4-mapped IPv6 address', 400, admin, 'PUT', WS, openAi('ok', { endpoint: 'http://[::ffff:a9fe:a9fe]/v1' }));
await expectStatus('...or as a decimal number', 400, admin, 'PUT', WS, openAi('ok', { endpoint: 'http://2852039166/v1' }));
await expectStatus('...and "this network"', 400, admin, 'PUT', WS, openAi('ok', { endpoint: 'http://0.0.0.0:11434/v1' }));
await expectStatus('localhost is allowed, for a model on the same machine', 200, admin, 'PUT', WS, openAi('ok', { endpoint: 'http://localhost:8098/v1' }));
await expectStatus('a private address is allowed, for a model on the network', 200, admin, 'PUT', WS, openAi('ok', { endpoint: 'http://192.168.1.50:11434/v1' }));
await ok(admin, 'PUT', WS, openAi('ok', { credential: SECRET }));
await ok(admin, 'POST', `${WS}/test`);
await ok(admin, 'PUT', WS, openAi('ok', { enabled: true }));

console.log('--- A project tests its own setting ---');
await expectStatus('a project without a setting has nothing to test', 404, pa.token, 'POST', `${PS}/test`);
await ok(pa.token, 'PUT', PS, openAi('ok', { credential: 'sk-project-1' }));
const projectTest = await call(pa.token, 'POST', `${PS}/test`);
check(`[${projectTest.status}] a project admin tests their project's setting`, projectTest.status === 200 && projectTest.json?.ok === true, projectTest.text);
check('...with the project key, not the workspace one', (await lastRequest()).headers.authorization === 'Bearer sk-project-1');
await expectStatus('removing the project setting again', 204, pa.token, 'DELETE', PS);
for (const user of [tester, automation, viewer]) {
  await expectStatus(`${user.label}: test the project setting`, 403, user.token, 'POST', `${PS}/test`);
}
await expectStatus('a project admin cannot test the workspace default', 403, pa.token, 'POST', `${WS}/test`);
await expectStatus('an API token cannot test the workspace default', 403, adminToken, 'POST', `${WS}/test`);
await expectStatus('an API token cannot test a project setting', 403, adminToken, 'POST', `${PS}/test`);
const emptyWorkspace = await ok(admin, 'POST', '/workspaces', { name: 'AI empty', slug: `ai-empty-${sfx}` });
await expectStatus('a workspace default that was never saved has nothing to test', 404, admin, 'POST', `/workspaces/${emptyWorkspace.id}/ai/test`);

console.log('--- Address and error helpers, inside the app ---');
try {
  const reservedYes = ['169.254.169.254', 'fe80::1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '::', 'ff02::1'];
  const reservedNo = ['127.0.0.1', '10.1.2.3', '192.168.1.5', '172.16.0.1', '100.64.1.1', '::1', 'fd00::1', '8.8.8.8'];
  // Node's BlockList checks an IPv4 address as an IPv4-mapped IPv6 one, so an IPv6 "mapped" rule in the same
  // list as the IPv4 ranges would match every IPv4 address, public ones included.
  const privateYes = ['10.1.2.3', '127.0.0.1', '192.168.1.5', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1'];
  const privateNo = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111'];
  const classified = JSON.parse(
    inApp(`
      const { isPrivateAddress } = require('./dist/webhooks/safe-post');
      console.log(JSON.stringify({
        yes: ${JSON.stringify(privateYes)}.map((a) => [a, isPrivateAddress(a)]),
        no: ${JSON.stringify(privateNo)}.map((a) => [a, isPrivateAddress(a)]),
      }));
    `),
  );
  for (const [address, isPrivate] of classified.yes) check(`${address} is private`, isPrivate === true);
  for (const [address, isPrivate] of classified.no) check(`${address} is public`, isPrivate === false);

  const helpers = JSON.parse(
    inApp(`
      const { isReservedAddress } = require('./dist/webhooks/safe-post');
      const { scrubProviderError, providerFailureMessage } = require('./dist/ai/provider-error');
      const edge = 'x'.repeat(498) + 'sk-12345';
      console.log(JSON.stringify({
        yes: ${JSON.stringify(reservedYes)}.map((a) => [a, isReservedAddress(a)]),
        no: ${JSON.stringify(reservedNo)}.map((a) => [a, isReservedAddress(a)]),
        scrubbed: scrubProviderError('bad key sk-1 here, sk-1 again', 'sk-1'),
        cut: scrubProviderError('y'.repeat(2000), null).length,
        edge: scrubProviderError(edge, 'sk-12345'),
        publicMessage: providerFailureMessage(500, false, 'oops', null),
        privateMessage: providerFailureMessage(500, true, 'oops', null),
      }));
    `),
  );
  for (const [address, reserved] of helpers.yes) check(`${address} is reserved`, reserved === true);
  for (const [address, reserved] of helpers.no) check(`${address} is not reserved`, reserved === false);
  check('a provider key is removed from error text', !helpers.scrubbed.includes('sk-1'), helpers.scrubbed);
  check('error text is cut to 500 characters', helpers.cut <= 500, String(helpers.cut));
  check('...and a key at the cut is removed before cutting', !helpers.edge.includes('sk-'), helpers.edge);
  check('a public endpoint keeps the error text', helpers.publicMessage.includes('500') && helpers.publicMessage.includes('oops'), helpers.publicMessage);
  check('a private endpoint shows only the status', helpers.privateMessage.includes('500') && !helpers.privateMessage.includes('oops'), helpers.privateMessage);

  const connect = JSON.parse(
    inApp(`
      const dns = require('dns');
      const { safePost } = require('./dist/webhooks/safe-post');
      const table = { 'metadata.test': [{ address: '169.254.169.254', family: 4 }], 'local.test': [{ address: '127.0.0.1', family: 4 }] };
      const real = dns.lookup;
      dns.lookup = (host, options, cb) => (table[host] ? cb(null, table[host]) : real(host, options, cb));
      const send = (host) => safePost(new URL('http://' + host + ':8098/__last'), '{}', {}, { allowPrivate: true, refuseReserved: true, timeoutMs: 3000 });
      (async () => {
        const out = {};
        try { out.metadata = 'sent ' + (await send('metadata.test')).status; } catch (e) { out.metadata = e.message; }
        try { out.local = (await send('local.test')).status; } catch (e) { out.local = e.message; }
        console.log(JSON.stringify(out));
      })();
    `),
  );
  check('a name that resolves to a link-local address is refused when connecting', /link-local/.test(connect.metadata), JSON.stringify(connect));
  check('a name that resolves to loopback is reached', connect.local === 200, JSON.stringify(connect));
} catch (error) {
  check('the helper checks ran', false, String(error.message).slice(0, 300));
}

console.log('--- What the database holds ---');
check('the key is stored encrypted', psql(`select count(*) from ai_settings where "credentialCipher" like 'v1:%'`) !== '0');
check('...and never as plain text', psql(`select count(*) from ai_settings where "credentialCipher" like '%${SECRET}%'`) === '0');
check('the changes are audited', Number(psql(`select count(*) from audit_log where action = 'ai.settings.updated' and "workspaceId" = '${ws.id}'`)) >= 1);
check('...without any key', psql(`select count(*) from audit_log where metadata::text like '%${SECRET}%' or metadata::text like '%sk-project-1%'`) === '0');
check('...the removal too', Number(psql(`select count(*) from audit_log where action = 'ai.settings.removed' and "projectId" = '${project.id}'`)) >= 1);

const doomed = await ok(admin, 'POST', `/workspaces/${ws.id}/projects`, { key: 'GONE', name: 'Doomed project' });
await ok(admin, 'PUT', `/projects/${doomed.id}/ai/settings`, mine);
check('a project setting exists', psql(`select count(*) from ai_settings where "projectId" = '${doomed.id}'`) === '1');
psql(`delete from projects where id = '${doomed.id}'`);
check('deleting the project deletes its setting', psql(`select count(*) from ai_settings where "projectId" = '${doomed.id}'`) === '0');

function insertFails(owners) {
  try {
    psql(`insert into ai_settings (id, ${owners.columns}, provider, model, "updatedAt") values ('smoke-${sfx}-${owners.name}', ${owners.values}, 'ANTHROPIC', 'm', now())`);
    return false;
  } catch (error) {
    return String(error.stderr ?? error.message).includes('ai_settings_one_owner');
  }
}
check('a row owned by both a workspace and a project is refused', insertFails({ name: 'both', columns: '"workspaceId", "projectId"', values: `'${ws.id}', '${project.id}'` }));
check('a row owned by nothing is refused', insertFails({ name: 'none', columns: '"enabled"', values: 'false' }));

console.log(failures === 0 ? '\nAll AI checks passed.' : `\n${failures} AI check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
