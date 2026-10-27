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
  execFileSync('docker', ['compose', 'exec', '-T', 'app', 'node', '-e', code], {
    encoding: 'utf8',
    // A failing snippet is reported through the error it throws, not by dumping its stack trace here.
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
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
for (const [model, label] of [
  ['fenced', 'an answer in a code fence'],
  ['prefixed', 'an answer after a sentence'],
  ['think', 'an answer after a <think> block'],
  ['double', 'an answer that is JSON inside a JSON string'],
]) {
  await ok(admin, 'PUT', WS, openAi(model));
  const wrapped = await testWorkspace();
  check(`[${wrapped.status}] ${label} still passes the test`, wrapped.status === 200 && wrapped.json?.ok === true, wrapped.text);
}
await ok(admin, 'PUT', WS, openAi('array'));
const arrayAnswer = await testWorkspace();
check('an answer that is a JSON array fails the test, saying what it is', arrayAnswer.json?.ok === false && /JSON object/.test(String(arrayAnswer.json?.error)) && /array/.test(String(arrayAnswer.json?.error)), arrayAnswer.text);
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

console.log('--- Testing before saving ---');
const EWS = `/workspaces/${emptyWorkspace.id}/ai`;
const draft = (extra = {}) => ({ provider: 'OPENAI_COMPATIBLE', model: 'ok', endpoint: ENDPOINT, credential: SECRET, ...extra });
const drafted = await call(admin, 'POST', `${EWS}/test`, draft());
check(`[${drafted.status}] the values of a form are tested before anything is saved`, drafted.status === 200 && drafted.json?.ok === true && typeof drafted.json?.proof === 'string', drafted.text);
check('...with the key that was typed', (await lastRequest()).headers.authorization === `Bearer ${SECRET}`);
check('...and nothing was saved', (await ok(admin, 'GET', EWS)).settings === null);
await expectStatus('a test without a model is refused', 400, admin, 'POST', `${EWS}/test`, { provider: 'OPENAI_COMPATIBLE', endpoint: ENDPOINT });
await expectStatus('an OpenAI-compatible test without an endpoint is refused', 400, admin, 'POST', `${EWS}/test`, draft({ endpoint: undefined }));
await expectStatus('a link-local endpoint is refused', 400, admin, 'POST', `${EWS}/test`, draft({ endpoint: 'http://169.254.169.254/v1' }));
await expectStatus('a Tester cannot test values either', 403, tester.token, 'POST', `${PS}/test`, draft());
await expectStatus('...nor an API token', 403, adminToken, 'POST', `${EWS}/test`, draft());
const failedDraft = await call(admin, 'POST', `${EWS}/test`, draft({ model: 'fail500' }));
check('values that do not work say so and give no proof', failedDraft.json?.ok === false && failedDraft.json?.proof === undefined && String(failedDraft.json?.error).includes('500'), failedDraft.text);
check('...and still nothing was saved', (await ok(admin, 'GET', EWS)).settings === null);

const proof = drafted.json.proof;
await expectStatus('a changed model does not ride on the proof', 409, admin, 'PUT', EWS, draft({ model: 'other', enabled: true, testProof: proof }));
await expectStatus('...nor a changed key', 409, admin, 'PUT', EWS, draft({ credential: 'sk-other', enabled: true, testProof: proof }));
await expectStatus('...nor another workspace', 409, admin, 'PUT', WS, draft({ model: 'ok-3', enabled: true, testProof: proof }));
await expectStatus('...nor a made-up proof', 409, admin, 'PUT', EWS, draft({ enabled: true, testProof: '9999999999999.AAAA' }));
const savedDraft = await call(admin, 'PUT', EWS, draft({ enabled: true, testProof: proof }));
check(`[${savedDraft.status}] values that were tested can be saved and switched on in one go`, savedDraft.status === 200 && savedDraft.json?.enabled === true && savedDraft.json?.testedAt !== null, savedDraft.text);

const badDraft = await call(admin, 'POST', `${EWS}/test`, draft({ model: 'fail500' }));
const stillSaved = (await ok(admin, 'GET', EWS)).settings;
check('a failing test of other values leaves what is saved alone', badDraft.json?.ok === false && stillSaved.enabled === true && stillSaved.testedAt !== null, JSON.stringify(stillSaved));
await call(admin, 'POST', `${EWS}/test`, { provider: 'OPENAI_COMPATIBLE', model: 'ok', endpoint: ENDPOINT });
check('without a key typed, the saved key is used for the same endpoint', (await lastRequest()).headers.authorization === `Bearer ${SECRET}`);
await call(admin, 'POST', `${EWS}/test`, { provider: 'OPENAI_COMPATIBLE', model: 'ok', endpoint: 'http://localhost:8098/v1' });
check('...but not for another endpoint', (await lastRequest()).headers.authorization === undefined);
await call(admin, 'POST', `${EWS}/test`, { provider: 'OPENAI_COMPATIBLE', model: 'ok', endpoint: ENDPOINT, clearCredential: true });
check('...and not when the key is being removed', (await lastRequest()).headers.authorization === undefined);
psql(`update ai_settings set "testedAt" = null where "workspaceId" = '${emptyWorkspace.id}'`);
await call(admin, 'POST', `${EWS}/test`, { provider: 'OPENAI_COMPATIBLE', model: 'ok', endpoint: ENDPOINT });
check('a passing test of exactly what is saved records it', (await ok(admin, 'GET', EWS)).settings.testedAt !== null);


console.log('--- Address and error helpers, inside the app ---');
try {
  const reservedYes = ['169.254.169.254', 'fe80::1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '::', 'ff02::1', '100.100.100.200', '168.63.129.16', '192.0.0.192', 'fd00:ec2::254'];
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
  const units = JSON.parse(
    inApp(`
      const { outputLimitParam } = require('./dist/ai/providers/openai-compatible');
      const { renderRequirement } = require('./dist/ai/skills/prompts');
      const { validateAgainst } = require('./dist/ai/validate-output');
      const { assertAiEndpoint } = require('./dist/webhooks/safe-post');
      const linked = Array.from({ length: 500 }, (_, i) => ({ title: 'Case ' + i, steps: Array.from({ length: 30 }, () => ({ action: 'x'.repeat(400) })) }));
      const rendered = renderRequirement({ requirement: { title: 'T', description: 'D' }, extraContext: null, linkedCases: linked, otherCases: [] });
      const refuses = (url) => { try { assertAiEndpoint(url); return false; } catch { return true; } };
      console.log(JSON.stringify({
        openai: outputLimitParam('api.openai.com'),
        azure: outputLimitParam('myorg.openai.azure.com'),
        local: outputLimitParam('localhost:11434'),
        promptLength: rendered.length,
        promptSaysMore: /more/.test(rendered),
        unexpected: validateAgainst({ type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } }, { a: 'x', 'LEAKED-PROPERTY': 1 }),
        httpPublic: refuses('http://8.8.8.8/v1'),
        httpsPublic: refuses('https://8.8.8.8/v1'),
        httpPrivate: refuses('http://10.0.0.5:11434/v1'),
        httpLocalhost: refuses('http://localhost:11434/v1'),
      }));
    `),
  );
  check('OpenAI itself is asked for max_completion_tokens', units.openai === 'max_completion_tokens' && units.azure === 'max_completion_tokens', JSON.stringify(units));
  check('...and a local server for max_tokens', units.local === 'max_tokens', JSON.stringify(units));
  check('a requirement with hundreds of linked cases stays within a prompt budget', units.promptLength < 60000 && units.promptSaysMore === true, `${units.promptLength}`);
  check('a validation message does not repeat a property name the provider made up', typeof units.unexpected === 'string' && !units.unexpected.includes('LEAKED-PROPERTY'), String(units.unexpected));
  check('http:// to a public address is refused when saving', units.httpPublic === true && units.httpsPublic === false, JSON.stringify(units));
  check('...but http:// to a private address or localhost is fine', units.httpPrivate === false && units.httpLocalhost === false, JSON.stringify(units));
  const parsed = JSON.parse(
    inApp(`
      const { parseModelJson, answerHint } = require('./dist/ai/providers/model-json');
      const attempt = (text) => { try { return JSON.stringify(parseModelJson(text)); } catch { return 'THROWS'; } };
      console.log(JSON.stringify({
        plain: attempt('{"a":1}'),
        fenced: attempt('\\u0060\\u0060\\u0060json\\n{"a":1}\\n\\u0060\\u0060\\u0060'),
        bareFence: attempt('\\u0060\\u0060\\u0060\\n{"a":1}\\n\\u0060\\u0060\\u0060'),
        prefixed: attempt('Sure! Here you go:\\n{"a":1}\\nHope it helps.'),
        think: attempt('<think>maybe {"b":2}</think>\\n{"a":1}'),
        double: attempt(JSON.stringify(JSON.stringify({ a: 1 }))),
        nested: attempt('{"a":{"b":[1,2]}}'),
        text: attempt('I cannot do that.'),
        empty: attempt(''),
        trailingComma: attempt('{"a":[1,2,],"b":{"c":1,},}'),
        rawNewline: attempt('{"a":"first line\\nsecond line","b":"tab\\there"}'),
        commaInString: attempt('{"a":"x,}","b":1}'),
        brokenHint: answerHint('{"a": "b" "c": 1}', false, null),
        // Answers built to make a pattern search run for ever: many openings and no closing.
        slowThink: (() => { const t = Date.now(); try { parseModelJson('<think>'.repeat(30000)); } catch { /* expected */ } return Date.now() - t; })(),
        slowFence: (() => { const t = Date.now(); try { parseModelJson('\\u0060\\u0060\\u0060\\nx'.repeat(30000)); } catch { /* expected */ } return Date.now() - t; })(),
        slowBrace: (() => { const t = Date.now(); try { parseModelJson('{'.repeat(200000)); } catch { /* expected */ } return Date.now() - t; })(),
        bigPlain: (() => { const big = JSON.stringify({ a: 'x'.repeat(1500000) }); const t = Date.now(); const ok = JSON.stringify(parseModelJson(big)).length === big.length; return ok ? Date.now() - t : -1; })(),
        publicHint: answerHint('Sorry, I cannot help with sk-1 or this.', false, 'sk-1'),
        privateHint: answerHint('Sorry, I cannot help.', true, null),
        longHint: answerHint('x'.repeat(2000), false, null).length,
      }));
    `),
  );
  check('an answer in a code fence is read', parsed.fenced === '{"a":1}' && parsed.bareFence === '{"a":1}', JSON.stringify(parsed));
  check('...after a sentence', parsed.prefixed === '{"a":1}', JSON.stringify(parsed));
  check('...after a <think> block, ignoring what is in it', parsed.think === '{"a":1}', JSON.stringify(parsed));
  check('...and JSON inside a JSON string', parsed.double === '{"a":1}', JSON.stringify(parsed));
  check('plain and nested JSON are read as before', parsed.plain === '{"a":1}' && parsed.nested === '{"a":{"b":[1,2]}}', JSON.stringify(parsed));
  check('text without JSON is still refused', parsed.text === 'THROWS' && parsed.empty === 'THROWS', JSON.stringify(parsed));
  check('many <think> openings without a closing are read in well under a second', parsed.slowThink < 500, `${parsed.slowThink} ms`);
  check('...and so are many code fences without a closing', parsed.slowFence < 500, `${parsed.slowFence} ms`);
  check('...and a long run of braces', parsed.slowBrace < 500, `${parsed.slowBrace} ms`);
  check('a large plain answer is still read whole', parsed.bigPlain >= 0 && parsed.bigPlain < 1000, `${parsed.bigPlain} ms`);
  check('trailing commas are tolerated', parsed.trailingComma === '{"a":[1,2],"b":{"c":1}}', JSON.stringify(parsed));
  check('...and a line break or tab inside a string', parsed.rawNewline === '{"a":"first line\\nsecond line","b":"tab\\there"}', JSON.stringify(parsed));
  check('...without touching a comma inside a string', parsed.commaInString === '{"a":"x,}","b":1}', JSON.stringify(parsed));
  check('a public endpoint\'s error also says where the JSON breaks', /breaks at/.test(parsed.brokenHint) && /position|column|Expected/i.test(parsed.brokenHint), parsed.brokenHint);
  check('a public endpoint\'s answer is quoted in the error, without the key', parsed.publicHint.includes('cannot help') && !parsed.publicHint.includes('sk-1'), parsed.publicHint);
  check('...but a private one\'s is not', parsed.privateHint === '', parsed.privateHint);
  check('...and the quote is short', parsed.longHint <= 220, String(parsed.longHint));
  check('a provider key is removed from error text', !helpers.scrubbed.includes('sk-1'), helpers.scrubbed);
  check('error text is cut to 500 characters', helpers.cut <= 500, String(helpers.cut));
  check('...and a key at the cut is removed before cutting', !helpers.edge.includes('sk-'), helpers.edge);
  check('a public endpoint keeps the error text', helpers.publicMessage.includes('500') && helpers.publicMessage.includes('oops'), helpers.publicMessage);
  check('a private endpoint shows only the status', helpers.privateMessage.includes('500') && !helpers.privateMessage.includes('oops'), helpers.privateMessage);

  const connect = JSON.parse(
    inApp(`
      const dns = require('dns');
      const { safePost } = require('./dist/webhooks/safe-post');
      const table = { 'metadata.test': [{ address: '169.254.169.254', family: 4 }], 'local.test': [{ address: '127.0.0.1', family: 4 }], 'public.test': [{ address: '8.8.8.8', family: 4 }] };
      const real = dns.lookup;
      dns.lookup = (host, options, cb) => (table[host] ? cb(null, table[host]) : real(host, options, cb));
      const send = (host) => safePost(new URL('http://' + host + ':8098/__last'), '{}', {}, { allowPrivate: true, refuseReserved: true, timeoutMs: 3000 });
      (async () => {
        const out = {};
        try { out.metadata = 'sent ' + (await send('metadata.test')).status; } catch (e) { out.metadata = e.message; }
        try { out.local = (await send('local.test')).status; } catch (e) { out.local = e.message; }
        try { out.cleartext = 'sent ' + (await safePost(new URL('http://public.test:8098/'), '{}', {}, { allowPrivate: true, refuseReserved: true, refuseCleartextPublic: true, timeoutMs: 3000 })).status; } catch (e) { out.cleartext = e.message; }
        console.log(JSON.stringify(out));
      })();
    `),
  );
  check('a name that resolves to a link-local address is refused when connecting', /link-local/.test(connect.metadata), JSON.stringify(connect));
  check('a name that resolves to loopback is reached', connect.local === 200, JSON.stringify(connect));
  check('a name that resolves to a public address is not sent http:// when connecting', /https/.test(connect.cleartext) && !/^sent/.test(connect.cleartext), JSON.stringify(connect));

  // A model on the host is reached as host.docker.internal from inside the container (docker-compose.yml maps it
  // for Linux, Docker Desktop provides it); its address must not be one the helper refuses.
  const hostName = JSON.parse(
    inApp(`
      const { isReservedAddress } = require('./dist/webhooks/safe-post');
      require('dns').lookup('host.docker.internal', { all: true }, (error, found) =>
        console.log(JSON.stringify(error ? { error: error.code } : { addresses: found.map((a) => [a.address, isReservedAddress(a.address)]) })));
    `),
  );
  check('host.docker.internal resolves inside the app container', Array.isArray(hostName.addresses), JSON.stringify(hostName));
  check('...to an address the AI helper allows', hostName.addresses?.every(([, reserved]) => reserved === false) === true, JSON.stringify(hostName));
} catch (error) {
  check('the helper checks ran', false, String(error.message).slice(0, 300));
}

console.log('--- AI runs ---');
const P = `/projects/${project.id}`;
const RUNS = `${P}/ai/runs`;
const requirement = await ok(admin, 'POST', `${P}/requirements`, { title: 'Password reset', description: 'A user can reset a forgotten password by email.' });
const unrelatedCase = await ok(admin, 'POST', `${P}/cases`, { title: 'Unrelated login case' });
const otherProject = await ok(admin, 'POST', `/workspaces/${ws.id}/projects`, { key: 'AO', name: 'Other AI project' });
const otherRequirement = await ok(admin, 'POST', `/projects/${otherProject.id}/requirements`, { title: 'Other project secret requirement' });
await ok(admin, 'POST', `/projects/${otherProject.id}/cases`, { title: 'Other project secret case' });
const archivedRequirement = await ok(admin, 'POST', `${P}/requirements`, { title: 'Archived requirement' });
await ok(admin, 'DELETE', `${P}/requirements/${archivedRequirement.id}`);
const outsider = await makeUser('outsider', null);
const limited = await makeUser('limited', 'TESTER');

const start = (token, body = {}) => call(token, 'POST', RUNS, { type: 'REQUIREMENT_TO_CASES', requirementId: requirement.id, ...body });
const caseCount = async () => (await ok(admin, 'GET', `${P}/cases`)).length;
const setting = (set) => psql(`update ai_settings set ${set} where "workspaceId" = '${ws.id}'`);
const useModel = (model) => setting(`model = '${model}'`);
const resetFake = () => fromFake('/__reset', 'POST');
const calls = () => JSON.parse(fromFake('/__calls'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForRun(runId, statuses, seconds = 40) {
  for (let i = 0; i < seconds * 2; i++) {
    const run = await ok(admin, 'GET', `${RUNS}/${runId}`);
    if (statuses.includes(run.status)) return run;
    await sleep(500);
  }
  throw new Error(`run ${runId} did not reach ${statuses.join(' or ')} in ${seconds} s`);
}
const stepNames = (run) => run.steps.map((step) => step.name).join(',');
const finished = ['AWAITING_APPROVAL', 'FAILED', 'COMPLETED', 'CANCELLED'];

await expectStatus('a Viewer cannot start a run', 403, viewer.token, 'POST', RUNS, { type: 'REQUIREMENT_TO_CASES', requirementId: requirement.id });
await expectStatus('an Automation user cannot start a run', 403, automation.token, 'POST', RUNS, { type: 'REQUIREMENT_TO_CASES', requirementId: requirement.id });
await expectStatus('someone outside the project cannot start a run', 403, outsider.token, 'POST', RUNS, { type: 'REQUIREMENT_TO_CASES', requirementId: requirement.id });
await expectStatus('extra context is limited to 8000 characters', 400, tester.token, 'POST', RUNS, { type: 'REQUIREMENT_TO_CASES', requirementId: requirement.id, extraContext: 'x'.repeat(8001) });
await expectStatus('an unknown workflow type is refused', 400, tester.token, 'POST', RUNS, { type: 'SOMETHING_ELSE', requirementId: requirement.id });
await expectStatus('a requirement of another project is not found', 404, tester.token, 'POST', RUNS, { type: 'REQUIREMENT_TO_CASES', requirementId: otherRequirement.id });
await expectStatus('an archived requirement is not found', 404, tester.token, 'POST', RUNS, { type: 'REQUIREMENT_TO_CASES', requirementId: archivedRequirement.id });
setting('enabled = false');
await expectStatus('with AI switched off no run starts', 409, tester.token, 'POST', RUNS, { type: 'REQUIREMENT_TO_CASES', requirementId: requirement.id });
setting('enabled = true');

console.log('--- A run from start to approval ---');
const casesBefore = await caseCount();
useModel('ok');
resetFake();
const started = await call(tester.token, 'POST', RUNS, { type: 'REQUIREMENT_TO_CASES', requirementId: requirement.id, extraContext: 'Mention the mobile app.' });
check(`[${started.status}] a Tester starts a run`, started.status === 202 && typeof started.json?.runId === 'string', started.text);
const first = await waitForRun(started.json.runId, finished);
check('the run ends waiting for approval', first.status === 'AWAITING_APPROVAL', `${first.status} ${first.error ?? ''}`);
check('...after review, design and audit, in that order', stepNames(first) === 'REVIEW,DESIGN,AUDIT', stepNames(first));
check('...each with a skill version and token usage', first.steps.every((step) => step.skillVersion === 1 && step.usage?.inputTokens === 11 && step.usage?.outputTokens === 7 && step.status === 'COMPLETED' && step.attempt === 1), JSON.stringify(first.steps));
check('...holding the review, the drafts and the audit', first.result?.review?.acceptanceCriteria?.length === 2 && first.result?.drafts?.length === 2 && first.result?.audit?.revisionNeeded === false, JSON.stringify(first.result));
check('...every draft says what kind of case it is', first.result.drafts.every((draft) => ['positive', 'negative', 'boundary', 'error'].includes(draft.kind)));
check('the run shows which setting it used', first.providerSnapshot?.source === 'WORKSPACE' && first.providerSnapshot?.endpointHost === '127.0.0.1:8098' && first.providerSnapshot?.model === 'ok', JSON.stringify(first.providerSnapshot));
check('...and what was asked', first.input?.requirementId === requirement.id && first.input?.extraContext === 'Mention the mobile app.', JSON.stringify(first.input));
check('a step shows no prompt and no answer, only how it went', keys(first.steps[0]) === 'attempt,endedAt,error,name,skillVersion,startedAt,status,usage', keys(first.steps[0]));
check('the run carries no provider key', !JSON.stringify(first).includes(SECRET) && !JSON.stringify(first).includes('credential'));
check('nothing was written to the cases yet', (await caseCount()) === casesBefore);
const lastPrompt = JSON.stringify((await lastRequest()).body.messages);
check('the requirement and the project\'s other cases went to the provider', lastPrompt.includes('Password reset') && lastPrompt.includes('Unrelated login case') && lastPrompt.includes(unrelatedCase.id), lastPrompt.slice(0, 300));
check('...and nothing from another project', !lastPrompt.includes('Other project secret') && !lastPrompt.includes(otherProject.id));
const reviewCall = calls();
check('three model calls were made', reviewCall.length === 3, JSON.stringify(reviewCall));

console.log('--- Reading runs ---');
const asViewer = await call(viewer.token, 'GET', `${RUNS}/${started.json.runId}`);
check(`[${asViewer.status}] a Viewer can read a run`, asViewer.status === 200 && asViewer.json?.id === started.json.runId);
await expectStatus('someone outside the project cannot read a run', 403, outsider.token, 'GET', `${RUNS}/${started.json.runId}`);
await expectStatus('...or list runs', 403, outsider.token, 'GET', `${RUNS}?requirementId=${requirement.id}`);
await expectStatus('a run of another project is not found through this one', 404, admin, 'GET', `/projects/${otherProject.id}/ai/runs/${started.json.runId}`);
await expectStatus('an unknown run is not found', 404, tester.token, 'GET', `${RUNS}/00000000-0000-0000-0000-000000000000`);

console.log('--- Revision, retry and failure ---');
useModel('revise');
resetFake();
const revising = await waitForRun((await start(tester.token)).json.runId, finished);
check('a revision follows an audit that asks for one', revising.status === 'AWAITING_APPROVAL' && stepNames(revising) === 'REVIEW,DESIGN,AUDIT,REVISE,AUDIT_REVISED', `${revising.status} ${stepNames(revising)}`);
check('...with five model calls and the audit after the revision', calls().length === 5 && revising.result?.audit?.revisionNeeded === false, JSON.stringify(revising.result?.audit));

useModel('flaky');
resetFake();
const flaky = await waitForRun((await start(tester.token)).json.runId, finished);
check('a step whose answer is not JSON is tried once more', flaky.status === 'AWAITING_APPROVAL' && flaky.steps.some((step) => step.name === 'REVIEW' && step.attempt === 1 && step.status === 'FAILED') && flaky.steps.some((step) => step.name === 'REVIEW' && step.attempt === 2 && step.status === 'COMPLETED'), JSON.stringify(flaky.steps));
check('...four model calls in all', calls().length === 4, String(calls().length));

useModel('invalid');
resetFake();
const invalid = await waitForRun((await start(tester.token)).json.runId, finished);
check('an answer that does not fit the schema fails the run after one retry', invalid.status === 'FAILED' && Boolean(invalid.error) && calls().length === 2, `${invalid.status} ${invalid.error} calls=${calls().length}`);
check('...and writes no cases', (await caseCount()) === casesBefore);
check('...and the failed steps still record what the provider used', invalid.steps.length === 2 && invalid.steps.every((step) => step.status === 'FAILED' && step.usage?.inputTokens === 11 && step.usage?.outputTokens === 7), JSON.stringify(invalid.steps));

useModel('fail500');
resetFake();
const failing = await waitForRun((await start(tester.token)).json.runId, finished);
check('a provider that keeps failing fails the run after one retry', failing.status === 'FAILED' && calls().length === 2, `${failing.status} calls=${calls().length}`);
check('...saying only the status, for a private address', String(failing.error).includes('500') && !String(failing.error).includes('INTERNAL-SECRET-BODY'), String(failing.error));
check('...and the failed step is recorded without its answer', failing.steps.length === 2 && failing.steps.every((step) => step.status === 'FAILED' && step.attempt >= 1), JSON.stringify(failing.steps));

console.log('--- Cancelling ---');
useModel('ok');
const toCancel = await waitForRun((await start(tester.token)).json.runId, finished);
await expectStatus('a run waiting for approval can be cancelled', 200, tester.token, 'POST', `${RUNS}/${toCancel.id}/cancel`);
check('...and stays cancelled', (await ok(admin, 'GET', `${RUNS}/${toCancel.id}`)).status === 'CANCELLED');
await expectStatus('a finished run cannot be cancelled again', 409, tester.token, 'POST', `${RUNS}/${toCancel.id}/cancel`);
await expectStatus('a Viewer cannot cancel a run', 403, viewer.token, 'POST', `${RUNS}/${first.id}/cancel`);

useModel('slow');
const slowRun = (await start(tester.token)).json.runId;
await waitForRun(slowRun, ['RUNNING']);
await expectStatus('a run in progress can be cancelled', 200, tester.token, 'POST', `${RUNS}/${slowRun}/cancel`);
await sleep(26_000);
const slowAfter = await ok(admin, 'GET', `${RUNS}/${slowRun}`);
check('...and stays cancelled when the step it was in returns', slowAfter.status === 'CANCELLED' && stepNames(slowAfter) === 'REVIEW', `${slowAfter.status} ${stepNames(slowAfter)}`);

console.log('--- Limits and listing ---');
useModel('ok');
setting('"maxRunsPerUserPerDay" = 2');
await expectStatus('a user may start a run within the daily limit', 202, limited.token, 'POST', RUNS, { type: 'REQUIREMENT_TO_CASES', requirementId: requirement.id, extraContext: 'first' });
await expectStatus('...and a second one', 202, limited.token, 'POST', RUNS, { type: 'REQUIREMENT_TO_CASES', requirementId: requirement.id, extraContext: 'second' });
await expectStatus('...but not a third', 429, limited.token, 'POST', RUNS, { type: 'REQUIREMENT_TO_CASES', requirementId: requirement.id, extraContext: 'third' });
// Starts that arrive together must not slip past the limit by being counted before any of them is saved.
const racer = await makeUser('racer', 'TESTER');
setting('"maxRunsPerUserPerDay" = 2');
const racing = await Promise.all(Array.from({ length: 6 }, (_, i) => call(racer.token, 'POST', RUNS, { type: 'REQUIREMENT_TO_CASES', requirementId: requirement.id, extraContext: `race ${i}` })));
check('six starts at once with a limit of two: two are accepted', racing.filter((r) => r.status === 202).length === 2, racing.map((r) => r.status).join());
check('...and the rest are refused', racing.filter((r) => r.status === 429).length === 4, racing.map((r) => r.status).join());
setting('"maxRunsPerUserPerDay" = 100');
const listed = await call(viewer.token, 'GET', `${RUNS}?requirementId=${requirement.id}`);
check(`[${listed.status}] a Viewer can list the runs of a requirement`, listed.status === 200 && Array.isArray(listed.json) && listed.json.length >= 8, listed.text.slice(0, 200));
const stamps = listed.json.map((run) => Date.parse(run.createdAt));
check('...newest first', stamps.every((time, index) => index === 0 || stamps[index - 1] >= time));
check('...as a summary without the result or the steps', !('result' in listed.json[0]) && !('steps' in listed.json[0]) && listed.json[0].providerSnapshot?.model !== undefined);
const paged = await call(viewer.token, 'GET', `${RUNS}?requirementId=${requirement.id}&limit=2`);
check('...and in pages, with the total in the header', paged.json.length === 2, paged.text.slice(0, 100));
const other = await call(viewer.token, 'GET', `${RUNS}?requirementId=${otherRequirement.id}`);
check('runs of another requirement are not listed', other.status === 200 && other.json.length === 0, other.text.slice(0, 100));

console.log('--- Approving drafts ---');
useModel('ok');
const newRun = async (body = {}) => waitForRun((await start(tester.token, body)).json.runId, ['AWAITING_APPROVAL']);
const approve = (token, runId, body, projectPath = P) => call(token, 'POST', `${projectPath}/ai/runs/${runId}/approve`, body);
const suite = await ok(admin, 'POST', `${P}/suites`, { name: 'AI drafts' });
const otherSuite = await ok(admin, 'POST', `/projects/${otherProject.id}/suites`, { name: 'Other suite' });

const run1 = await newRun();
const edited = run1.result.drafts.map((draft, index) => (index === 0 ? { ...draft, title: 'Edited by a person' } : draft));
const before1 = await caseCount();
const approved = await approve(tester.token, run1.id, { suiteId: suite.id, cases: edited });
check(`[${approved.status}] approving writes the drafts as cases`, approved.status === 200 && approved.json?.createdCaseIds?.length === 2, approved.text);
check('...which are new cases', (await caseCount()) === before1 + 2);
const created = await Promise.all(approved.json.createdCaseIds.map((id) => ok(admin, 'GET', `${P}/cases/${id}`)));
check('...with the edited title and the steps', created.some((c) => c.title === 'Edited by a person') && created.every((c) => c.steps.length >= 1), JSON.stringify(created.map((c) => c.title)));
check('...tagged as made by AI and with their kind', created.every((c) => c.tags.includes('ai-generated') && ['positive', 'negative', 'boundary', 'error'].some((kind) => c.tags.includes(kind))), JSON.stringify(created.map((c) => c.tags)));
check('...in the chosen suite', created.every((c) => c.suiteId === suite.id));
const linked = await ok(admin, 'GET', `${P}/requirements/${requirement.id}`);
check('...linked to the requirement', approved.json.createdCaseIds.every((id) => linked.cases.some((link) => link.testCaseId === id || link.testCase?.id === id)), JSON.stringify(linked.cases.map((l) => l.testCaseId)));
const completed = await ok(admin, 'GET', `${RUNS}/${run1.id}`);
check('the run is completed and remembers the cases', completed.status === 'COMPLETED' && completed.result?.createdCaseIds?.join() === approved.json.createdCaseIds.join() && completed.result?.drafts?.length === 2, JSON.stringify(completed.result?.createdCaseIds));
check('...and the approval is audited', Number(psql(`select count(*) from audit_log where action = 'ai.run.approved' and "projectId" = '${project.id}' and "entityId" = '${run1.id}'`)) === 1);
await expectStatus('approving again is refused', 409, tester.token, 'POST', `${RUNS}/${run1.id}/approve`, { cases: edited });
check('...and writes nothing', (await caseCount()) === before1 + 2);

const run2 = await newRun();
const before2 = await caseCount();
const bothApprovals = await Promise.all([approve(tester.token, run2.id, { cases: run2.result.drafts }), approve(tester.token, run2.id, { cases: run2.result.drafts })]);
check('two approvals at once: one wins, one is refused', bothApprovals.map((r) => r.status).sort().join() === '200,409', bothApprovals.map((r) => r.status).join());
check('...and the drafts are written once', (await caseCount()) === before2 + 2);

const run3 = await newRun();
const before3 = await caseCount();
const tooMany = Array.from({ length: 26 }, () => run3.result.drafts[0]);
await expectStatus('more than 25 drafts are refused', 400, tester.token, 'POST', `${RUNS}/${run3.id}/approve`, { cases: tooMany });
await expectStatus('no drafts are refused', 400, tester.token, 'POST', `${RUNS}/${run3.id}/approve`, { cases: [] });
await expectStatus('a draft without a title is refused', 400, tester.token, 'POST', `${RUNS}/${run3.id}/approve`, { cases: [{ ...run3.result.drafts[0], title: '' }] });
await expectStatus('a draft with an unknown priority is refused', 400, tester.token, 'POST', `${RUNS}/${run3.id}/approve`, { cases: [{ ...run3.result.drafts[0], priority: 'URGENT' }] });
await expectStatus('a draft without a kind is refused', 400, tester.token, 'POST', `${RUNS}/${run3.id}/approve`, { cases: [{ title: 'x' }] });
await expectStatus('a draft whose title is only spaces is refused', 400, tester.token, 'POST', `${RUNS}/${run3.id}/approve`, { cases: [{ ...run3.result.drafts[0], title: '   ' }] });
await expectStatus('a step whose action is only spaces is refused', 400, tester.token, 'POST', `${RUNS}/${run3.id}/approve`, { cases: [{ ...run3.result.drafts[0], steps: [{ action: '   ' }] }] });
await expectStatus('a suite of another project is not found', 404, tester.token, 'POST', `${RUNS}/${run3.id}/approve`, { suiteId: otherSuite.id, cases: run3.result.drafts });
check('...nothing was written', (await caseCount()) === before3);
check('...and the run still waits for approval', (await ok(admin, 'GET', `${RUNS}/${run3.id}`)).status === 'AWAITING_APPROVAL');

const run4 = await newRun();
await expectStatus('a Viewer cannot approve', 403, viewer.token, 'POST', `${RUNS}/${run4.id}/approve`, { cases: run4.result.drafts });
await ok(admin, 'PUT', `/workspaces/${ws.id}/permissions/projects/${project.id}/users/${tester.id}`, { role: 'VIEWER' });
await expectStatus('someone who was demoted to Viewer since cannot approve', 403, tester.token, 'POST', `${RUNS}/${run4.id}/approve`, { cases: run4.result.drafts });
await ok(admin, 'PUT', `/workspaces/${ws.id}/permissions/projects/${project.id}/users/${tester.id}`, { role: 'TESTER' });
await expectStatus('a run of another project is not found through that project', 404, admin, 'POST', `/projects/${otherProject.id}/ai/runs/${run4.id}/approve`, { cases: run4.result.drafts });
await ok(admin, 'DELETE', `/projects/${project.id}`);
await expectStatus('an archived project is read-only', 409, tester.token, 'POST', `${RUNS}/${run4.id}/approve`, { cases: run4.result.drafts });
await ok(admin, 'POST', `/projects/${project.id}/restore`);
check('...and the run still waits for approval', (await ok(admin, 'GET', `${RUNS}/${run4.id}`)).status === 'AWAITING_APPROVAL');
await expectStatus('approving after all of that works', 200, tester.token, 'POST', `${RUNS}/${run4.id}/approve`, { cases: run4.result.drafts });

const archivable = await ok(admin, 'POST', `${P}/requirements`, { title: 'Archived while waiting' });
const run5 = await newRun({ requirementId: archivable.id });
await ok(admin, 'DELETE', `${P}/requirements/${archivable.id}`);
await expectStatus('drafts for a requirement archived meanwhile are refused', 409, tester.token, 'POST', `${RUNS}/${run5.id}/approve`, { cases: run5.result.drafts });
await ok(admin, 'POST', `${P}/requirements/${archivable.id}/restore`);
await expectStatus('...and can be approved once it is restored', 200, tester.token, 'POST', `${RUNS}/${run5.id}/approve`, { cases: run5.result.drafts });

const vanishing = await ok(admin, 'POST', `${P}/requirements`, { title: 'Gone while waiting' });
const run6 = await newRun({ requirementId: vanishing.id });
psql(`delete from requirements where id = '${vanishing.id}'`);
const before6 = await caseCount();
await expectStatus('drafts for a requirement that is gone are not found', 404, tester.token, 'POST', `${RUNS}/${run6.id}/approve`, { cases: run6.result.drafts });
check('...nothing was written and the run still waits', (await caseCount()) === before6 && (await ok(admin, 'GET', `${RUNS}/${run6.id}`)).status === 'AWAITING_APPROVAL');

console.log('--- A run whose setting changes ---');
const copied = psql(`insert into ai_workflow_runs (id, type, "projectId", "createdById", status, input, "providerSnapshot", "availableAt", "createdAt")
  select gen_random_uuid()::text, type, "projectId", "createdById", 'QUEUED', input, "providerSnapshot", timezone('utc', now()) + interval '1 hour', timezone('utc', now())
  from ai_workflow_runs where id = '${first.id}' returning id`).split('\n')[0];
setting('enabled = false');
psql(`update ai_workflow_runs set "availableAt" = timezone('utc', now()) where id = '${copied}'`);
const orphaned = await waitForRun(copied, finished);
check('a waiting run fails when AI was switched off before it started', orphaned.status === 'FAILED' && String(orphaned.error).includes('AI is not enabled for this project'), `${orphaned.status} ${orphaned.error}`);
check('...without calling the provider', orphaned.steps.length === 0);
setting('enabled = true');

console.log('--- A setting that changes while a run is under way ---');
// The review answers at once and the design takes 20 s, so there is time to change the setting during the design.
async function startSlowRun() {
  useModel('slow-after-review');
  resetFake();
  const runId = (await start(tester.token)).json.runId;
  for (let i = 0; i < 60; i++) {
    const run = await ok(admin, 'GET', `${RUNS}/${runId}`);
    if (run.steps.some((step) => step.name === 'DESIGN' && step.status === 'RUNNING')) return runId;
    await sleep(500);
  }
  throw new Error(`run ${runId} never reached its design step`);
}
const restoreDefault = async () => {
  await ok(admin, 'PUT', WS, openAi('ok', { credential: SECRET, maxRunsPerUserPerDay: 100 }));
  await ok(admin, 'POST', `${WS}/test`);
  await ok(admin, 'PUT', WS, openAi('ok', { enabled: true, maxRunsPerUserPerDay: 100 }));
};

const midOff = await startSlowRun();
setting('enabled = false');
const midOffEnd = await waitForRun(midOff, finished, 60);
check('a run whose AI is switched off meanwhile fails at its next step', midOffEnd.status === 'FAILED' && String(midOffEnd.error).includes('AI is not enabled'), `${midOffEnd.status} ${midOffEnd.error}`);
check('...without asking the provider again', calls().length === 2 && stepNames(midOffEnd) === 'REVIEW,DESIGN', `${calls().length} ${stepNames(midOffEnd)}`);
setting('enabled = true');

const midMoved = await startSlowRun();
setting(`endpoint = 'http://localhost:8098/v1'`);
const midMovedEnd = await waitForRun(midMoved, finished, 60);
check('a run whose endpoint is changed meanwhile fails at its next step', midMovedEnd.status === 'FAILED' && String(midMovedEnd.error).includes('setting changed'), `${midMovedEnd.status} ${midMovedEnd.error}`);
check('...without sending anything more to the new endpoint', calls().length === 2, String(calls().length));
setting(`endpoint = '${ENDPOINT}'`);

const midRemoved = await startSlowRun();
await expectStatus('the workspace default is removed during a run', 204, admin, 'DELETE', WS);
const midRemovedEnd = await waitForRun(midRemoved, finished, 60);
check('...and the run fails at its next step', midRemovedEnd.status === 'FAILED' && String(midRemovedEnd.error).includes('AI is not enabled') && calls().length === 2, `${midRemovedEnd.status} ${midRemovedEnd.error} calls=${calls().length}`);
await restoreDefault();

const queuedCopy = psql(`insert into ai_workflow_runs (id, type, "projectId", "createdById", status, input, "providerSnapshot", "availableAt", "createdAt")
  select gen_random_uuid()::text, type, "projectId", "createdById", 'QUEUED', input, "providerSnapshot", timezone('utc', now()) + interval '1 hour', timezone('utc', now())
  from ai_workflow_runs where id = '${first.id}' returning id`).split('\n')[0];
const settingsNow = psql(`select id from ai_settings where "workspaceId" = '${ws.id}'`);
psql(`update ai_workflow_runs set "providerSnapshot" = jsonb_set("providerSnapshot", '{settingsId}', to_jsonb('${settingsNow}'::text)) where id = '${queuedCopy}'`);
setting(`endpoint = 'http://localhost:8098/v1'`);
psql(`update ai_workflow_runs set "availableAt" = timezone('utc', now()) where id = '${queuedCopy}'`);
const queuedEnd = await waitForRun(queuedCopy, finished, 30);
check('a waiting run fails when its setting was pointed elsewhere before it started', queuedEnd.status === 'FAILED' && String(queuedEnd.error).includes('setting changed') && queuedEnd.steps.length === 0, `${queuedEnd.status} ${queuedEnd.error}`);
setting(`endpoint = '${ENDPOINT}'`);
useModel('ok');

console.log('--- The same start twice is one run ---');
const sameBody = { type: 'REQUIREMENT_TO_CASES', requirementId: requirement.id, extraContext: `double click ${sfx}` };
const twice = await Promise.all([call(tester.token, 'POST', RUNS, sameBody), call(tester.token, 'POST', RUNS, sameBody)]);
check('two identical starts at once are both accepted', twice.every((r) => r.status === 202), twice.map((r) => r.status).join());
check('...and give the same run', twice[0].json?.runId === twice[1].json?.runId, twice.map((r) => r.text).join(' '));
check('...so only one was made', psql(`select count(*) from ai_workflow_runs where input->>'extraContext' = '${sameBody.extraContext}'`) === '1');
const different = await call(tester.token, 'POST', RUNS, { ...sameBody, extraContext: `${sameBody.extraContext} and more` });
check('a start with other notes is a run of its own', different.status === 202 && different.json?.runId !== twice[0].json?.runId, different.text);
await waitForRun(twice[0].json.runId, finished);
await waitForRun(different.json.runId, finished);
const afterFinish = await call(tester.token, 'POST', RUNS, sameBody);
check('once that run has finished the same start makes a new one', afterFinish.status === 202 && afterFinish.json?.runId !== twice[0].json?.runId, afterFinish.text);
await waitForRun(afterFinish.json.runId, finished);

console.log('--- The provider key is trimmed ---');
await expectStatus('a key of only spaces is refused', 400, admin, 'PUT', WS, openAi('ok', { credential: '   ', maxRunsPerUserPerDay: 100 }));
await ok(admin, 'PUT', WS, openAi('ok', { credential: '  sk-trim-1 \n', maxRunsPerUserPerDay: 100 }));
check('a key pasted with spaces and a line break is saved without them', (await ok(admin, 'POST', `${WS}/test`)).ok === true && (await lastRequest()).headers.authorization === 'Bearer sk-trim-1', JSON.stringify((await lastRequest()).headers));
await restoreDefault();

console.log('--- A DEMO workspace takes no AI settings ---');
const demoOwner = await makeUser('demo-owner', null);
const demoWorkspace = (await ok(demoOwner.token, 'GET', '/workspaces')).find((w) => w.isDemo);
check('a user has a DEMO workspace of their own', demoWorkspace?.isDemo === true, JSON.stringify(demoWorkspace));
const demoProject = (await ok(demoOwner.token, 'GET', `/workspaces/${demoWorkspace?.id}/projects`))[0];
const demoRefused = await call(demoOwner.token, 'PUT', `/workspaces/${demoWorkspace?.id}/ai`, workspaceDefault);
check(`[${demoRefused.status}] its workspace default cannot be defined`, demoRefused.status === 403 && String(demoRefused.json?.message).includes('DEMO'), demoRefused.text);
await expectStatus('...nor a project setting in it', 403, demoOwner.token, 'PUT', `/projects/${demoProject?.id}/ai/settings`, workspaceDefault);
await expectStatus('...nor tested', 403, demoOwner.token, 'POST', `/workspaces/${demoWorkspace?.id}/ai/test`);
await expectStatus('...nor a project setting tested', 403, demoOwner.token, 'POST', `/projects/${demoProject?.id}/ai/settings/test`);
await expectStatus('what is there can still be read', 200, demoOwner.token, 'GET', `/workspaces/${demoWorkspace?.id}/ai`);

console.log('--- A graceful restart hands a run on at once ---');
async function waitReady() {
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(`${new URL(BASE).origin}/ready`)).status === 200) return; } catch { /* still starting */ }
    await sleep(1000);
  }
  throw new Error('the app did not become ready again');
}
const restartRun = await startSlowRun();
execFileSync('docker', ['compose', 'restart', '-t', '40', 'app'], { stdio: 'ignore' });
await waitReady();
inApp("require('fs').writeFileSync('/tmp/fake-ai-fast', '')");
await startFakeProvider();
const restarted = await waitForRun(restartRun, finished, 60);
check('after a restart the run is taken on at once, not when its claim runs out', restarted.status === 'AWAITING_APPROVAL', `${restarted.status} ${restarted.error ?? ''}`);
inApp("require('fs').rmSync('/tmp/fake-ai-fast', { force: true })");
useModel('ok');

console.log('--- A crash in the middle of a run ---');
useModel('slow-after-review');
resetFake();
const crashed = (await start(tester.token)).json.runId;
for (let i = 0; i < 40; i++) {
  const run = await ok(admin, 'GET', `${RUNS}/${crashed}`);
  if (run.steps.some((step) => step.name === 'REVIEW' && step.status === 'COMPLETED') && run.steps.some((step) => step.name === 'DESIGN' && step.status === 'RUNNING')) break;
  await sleep(500);
}
execFileSync('docker', ['compose', 'kill', 'app'], { stdio: 'ignore' });
execFileSync('docker', ['compose', 'up', '-d', '--wait', '--wait-timeout', '120', 'app'], { stdio: 'ignore' });
// The restarted container keeps its files: from now on the fake answers at once, so the resumed run finishes.
inApp("require('fs').writeFileSync('/tmp/fake-ai-fast', '')");
await startFakeProvider();
psql(`update ai_workflow_runs set "lockedUntil" = timezone('utc', now()) - interval '1 minute' where id = '${crashed}'`);
const recovered = await waitForRun(crashed, finished, 60);
check('a run left behind by a crash is taken over and finished', recovered.status === 'AWAITING_APPROVAL', `${recovered.status} ${recovered.error ?? ''}`);
check('...the review that was done before the crash was not asked again', recovered.steps.filter((step) => step.name === 'REVIEW').length === 1, JSON.stringify(recovered.steps));
check('...the interrupted design is recorded as failed, then done', recovered.steps.filter((step) => step.name === 'DESIGN').map((step) => step.status).join() === 'FAILED,COMPLETED', JSON.stringify(recovered.steps));
inApp("require('fs').rmSync('/tmp/fake-ai-fast', { force: true })");
useModel('ok');

console.log('--- What the runs left in the audit log ---');
for (const action of ['ai.run.started', 'ai.run.cancelled', 'ai.run.failed']) {
  check(`${action} is audited`, Number(psql(`select count(*) from audit_log where action = '${action}' and "projectId" = '${project.id}'`)) >= 1);
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
