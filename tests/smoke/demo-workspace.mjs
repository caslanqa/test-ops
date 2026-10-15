// Demo workspace smoke test: with DEMO_WORKSPACE_ID set, every signed-in user reads that workspace
// and its projects as a viewer, without a membership record, and can't change anything in it.
// Needs the seed data (the seeded admin owns the "default" workspace) and the app started with
// that workspace as the demo:
//   docker compose up -d --wait && docker compose exec -T app node prisma/seed.js
//   DEMO_WORKSPACE_ID=$(node tests/smoke/demo-workspace.mjs --print-id) docker compose up -d --wait app
//   node tests/smoke/demo-workspace.mjs
// Signs up its own users, so it needs SELF_REGISTRATION=true (the default). BASE, ADMIN_EMAIL and
// ADMIN_PASSWORD change the target. Not part of `test:smoke`, which runs without a demo workspace;
// CI runs it as a separate step after recreating the app.
const BASE = process.env.BASE ?? 'http://localhost:8080/api/v1';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@testops.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';
const sfx = Date.now().toString(36);
let failures = 0;

async function call(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  return { status: res.status, json };
}
async function ok(token, method, path, body) {
  const r = await call(token, method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}
function check(label, pass, detail = '') {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${pass ? '' : ` ${detail}`}`);
}
async function expectStatus(label, expected, token, method, path, body) {
  const r = await call(token, method, path, body);
  check(`[${r.status}] ${label}`, r.status === expected, `(expected ${expected}) ${JSON.stringify(r.json)}`);
  return r;
}

const admin = (await ok(null, 'POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).accessToken;
const demo = (await ok(admin, 'GET', '/workspaces')).find((w) => w.slug === 'default');
if (!demo) throw new Error('The seeded "default" workspace is missing; run prisma/seed.js first.');

// CI starts the app with this id as DEMO_WORKSPACE_ID.
if (process.argv.includes('--print-id')) {
  console.log(demo.id);
  process.exit(0);
}

console.log('--- Setup ---');
check('the configured workspace is marked as the demo', demo.isDemo === true, JSON.stringify(demo));
const project = (await ok(admin, 'GET', `/workspaces/${demo.id}/projects`)).find((p) => p.key === 'DEMO');
const P = `/projects/${project.id}`;
const testCase = await ok(admin, 'POST', `${P}/cases`, { title: `Pay by card ${sfx}`, steps: [{ action: 'Open the cart' }] });
const run = await ok(admin, 'POST', `${P}/runs`, { title: `Demo run ${sfx}`, testCaseIds: [testCase.id] });
const result = await ok(admin, 'POST', `${P}/runs/${run.id}/results`, { testCaseId: testCase.id, status: 'FAILED', comment: 'Card declined' });
// A workspace of the admin's own, which visitors of the demo must not see.
const privateWs = await ok(admin, 'POST', '/workspaces', { name: `Private ${sfx}`, slug: `private-${sfx}` });
const privateProject = await ok(admin, 'POST', `/workspaces/${privateWs.id}/projects`, { key: 'PRV', name: 'Private' });
const membersBefore = (await ok(admin, 'GET', `/workspaces/${demo.id}/members`)).length;

const register = async (name) => (await ok(null, 'POST', '/auth/register', {
  email: `${name}-${sfx}@test.local`, displayName: `Visitor ${name}`, password: 'VisitorPass123',
})).accessToken;
const visitor = await register('one');
const visitorId = (await ok(visitor, 'GET', '/auth/me')).id;

console.log('--- A new user reads the demo ---');
const visible = await ok(visitor, 'GET', '/workspaces');
check('a new user sees the demo workspace', visible.some((w) => w.id === demo.id && w.isDemo === true), JSON.stringify(visible));
check("...but not other people's workspaces", !visible.some((w) => w.id === privateWs.id));
const ws = await ok(visitor, 'GET', `/workspaces/${demo.id}`);
check('...as a member who can only look', ws.currentUserRole === 'MEMBER' && ws.isDemo === true, JSON.stringify(ws));
const projects = await ok(visitor, 'GET', `/workspaces/${demo.id}/projects`);
check('...with every project of the demo workspace', projects.some((p) => p.id === project.id), JSON.stringify(projects));
const accessible = await ok(visitor, 'GET', '/projects');
check('the demo projects are in the list of projects one can open', accessible.some((p) => p.id === project.id) && !accessible.some((p) => p.id === privateProject.id));
check('a demo project opens as a viewer', (await ok(visitor, 'GET', P)).currentUserRole === 'VIEWER');
check('its cases can be read', (await ok(visitor, 'GET', `${P}/cases`)).some((c) => c.id === testCase.id));
check('its runs and results can be read', (await ok(visitor, 'GET', `${P}/runs/${run.id}`)).runCases.length === 1
  && (await ok(visitor, 'GET', `${P}/results?runId=${run.id}`)).some((r) => r.id === result.id));

console.log('--- Visitors stay out of the member lists ---');
const members = await ok(visitor, 'GET', `/workspaces/${demo.id}/members`);
check('the demo workspace members list has only its real members', members.length === membersBefore && !members.some((m) => m.userId === visitorId), `${members.length} vs ${membersBefore}`);
check("...and shows the members' names but not their email addresses", members.every((m) => m.user.displayName && !('email' in m.user)), JSON.stringify(members));
const projectMembers = await ok(visitor, 'GET', `${P}/members`);
check('...and so has the project members list', !projectMembers.some((m) => m.userId === visitorId));
check('...also without email addresses', projectMembers.length > 0 && projectMembers.every((m) => !('email' in m.user)), JSON.stringify(projectMembers));
check('real members still see the email addresses', (await ok(admin, 'GET', `${P}/members`)).every((m) => typeof m.user.email === 'string'));
await register('two');
check('another sign-up adds nobody to the demo members', (await ok(admin, 'GET', `/workspaces/${demo.id}/members`)).length === membersBefore);

console.log('--- Visitors change nothing ---');
await expectStatus('a visitor cannot add a case', 403, visitor, 'POST', `${P}/cases`, { title: 'Spam' });
await expectStatus('...or edit one', 403, visitor, 'PATCH', `${P}/cases/${testCase.id}`, { title: 'Spam' });
await expectStatus('...or record a result', 403, visitor, 'POST', `${P}/runs/${run.id}/results`, { testCaseId: testCase.id, status: 'PASSED' });
await expectStatus('...or start a run', 403, visitor, 'POST', `${P}/runs`, { title: 'Spam run', testCaseIds: [testCase.id] });
await expectStatus('...or delete a run', 403, visitor, 'DELETE', `${P}/runs/${run.id}`);
await expectStatus('...or file a defect', 403, visitor, 'POST', `${P}/defects`, { title: 'Spam' });
await expectStatus('...or add a project member', 403, visitor, 'POST', `${P}/members`, { email: `one-${sfx}@test.local`, role: 'ADMIN' });
await expectStatus('...or archive the project', 403, visitor, 'DELETE', P);
await expectStatus('...or create a project in the demo workspace', 403, visitor, 'POST', `/workspaces/${demo.id}/projects`, { key: 'SPM', name: 'Spam' });
await expectStatus('...or rename the workspace', 403, visitor, 'PATCH', `/workspaces/${demo.id}`, { name: 'Spam' });
await expectStatus('...or invite people to it', 403, visitor, 'POST', `/workspaces/${demo.id}/invitations`, { email: `friend-${sfx}@test.local`, role: 'ADMIN' });
await expectStatus('...or delete it', 403, visitor, 'DELETE', `/workspaces/${demo.id}`, { confirmName: demo.name });
await expectStatus("other people's workspaces stay closed", 403, visitor, 'GET', `/workspaces/${privateWs.id}`);
await expectStatus("...and so do their projects", 403, visitor, 'GET', `/projects/${privateProject.id}`);

// An API token acts as its user, so it reads the demo too and changes nothing either.
const token = (await ok(visitor, 'POST', '/api-tokens', { name: 'Demo reader' })).token;
check('an API token reads the demo', (await call(token, 'GET', `${P}/cases`)).status === 200);
await expectStatus('...and cannot write to it', 403, token, 'POST', `${P}/cases`, { title: 'Spam' });

console.log('--- The demo owner keeps their role ---');
check('the admin is still the demo workspace admin', (await ok(admin, 'GET', `/workspaces/${demo.id}`)).currentUserRole === 'ADMIN');
check('...and a project admin', (await ok(admin, 'GET', P)).currentUserRole === 'ADMIN');

// Clean-up: the extra workspace would otherwise show up in later runs against the same database.
await ok(admin, 'DELETE', `/workspaces/${privateWs.id}`, { confirmName: privateWs.name });

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
