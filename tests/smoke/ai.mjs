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
import { execFileSync } from 'node:child_process';

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
  }).trim();
const keys = (object) => Object.keys(object ?? {}).sort().join(',');

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
