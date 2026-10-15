// Demo workspace smoke test. The server builds the DEMO workspace at startup (DEMO_WORKSPACE, on by
// default), and every signed-in user can read it, without a membership record, and change nothing.
//   docker compose up -d --wait && node tests/smoke/demo-workspace.mjs
// The content counts are exact, so running it again after a restart shows that starting again adds
// nothing. With --disabled it checks a server started with DEMO_WORKSPACE=false:
//   DEMO_WORKSPACE=false docker compose up -d --wait app && node tests/smoke/demo-workspace.mjs --disabled
// Signs up its own users, so it needs SELF_REGISTRATION=true (the default). BASE, ADMIN_EMAIL and
// ADMIN_PASSWORD change the target; the admin is the seeded one (prisma/seed.js).
const BASE = process.env.BASE ?? 'http://localhost:8080/api/v1';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@testops.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';
// apps/api/src/demo/demo.constants.ts
const DEMO_WORKSPACE_ID = 'd3e00000-0000-4000-8000-000000000002';
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
  return { status: res.status, json, headers: res.headers };
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
/**
 * Sign-up and sign-in, waiting out the per-IP limit once: the suites before this one use most of
 * it within the same minute.
 */
async function auth(path, body) {
  let r = await call(null, 'POST', path, body);
  if (r.status === 429) {
    const seconds = Number(r.headers.get('retry-after')) || 60;
    console.log(`(sign-up limit reached; waiting ${seconds} s)`);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    r = await call(null, 'POST', path, body);
  }
  if (r.status >= 300) throw new Error(`POST ${path} -> ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.accessToken;
}
const register = (name) => auth('/auth/register', {
  email: `${name}-${sfx}@test.local`, displayName: `Visitor ${name}`, password: 'VisitorPass123',
});
const done = () => {
  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} CHECKS FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

const visitor = await register('one');

if (process.argv.includes('--disabled')) {
  console.log('--- DEMO_WORKSPACE=false ---');
  const listed = await ok(visitor, 'GET', '/workspaces');
  check('the demo workspace is not listed', !listed.some((w) => w.id === DEMO_WORKSPACE_ID || w.isDemo), JSON.stringify(listed));
  await expectStatus('...and cannot be opened', 403, visitor, 'GET', `/workspaces/${DEMO_WORKSPACE_ID}`);
  done();
}

console.log('--- A new user sees the demo ---');
const listed = await ok(visitor, 'GET', '/workspaces');
const demo = listed.find((w) => w.isDemo);
check('a new user sees the DEMO workspace', demo?.id === DEMO_WORKSPACE_ID && demo.name === 'DEMO', JSON.stringify(listed));
const ws = await ok(visitor, 'GET', `/workspaces/${DEMO_WORKSPACE_ID}`);
check('...as a member who can only look', ws.currentUserRole === 'MEMBER' && ws.isDemo === true, JSON.stringify(ws));
const project = (await ok(visitor, 'GET', `/workspaces/${DEMO_WORKSPACE_ID}/projects`)).find((p) => p.key === 'SHOP');
check('...with the example shop project', Boolean(project));
const P = `/projects/${project.id}`;
check('the project opens as a viewer', (await ok(visitor, 'GET', P)).currentUserRole === 'VIEWER');
check('it is in the list of projects one can open', (await ok(visitor, 'GET', '/projects')).some((p) => p.id === project.id));

console.log('--- What the demo shows (exact counts: a restart adds nothing) ---');
const cases = await ok(visitor, 'GET', `${P}/cases`);
check('17 cases', cases.length === 17, `${cases.length}`);
check('13 automated ones are tagged for the reporter', cases.filter((c) => c.tags.some((t) => t.startsWith('e2e:'))).length === 13);
check('5 suites', (await ok(visitor, 'GET', `${P}/suites`)).length === 5);
check('4 requirements', (await ok(visitor, 'GET', `${P}/requirements`)).length === 4);
check('1 milestone and 1 plan', (await ok(visitor, 'GET', `${P}/milestones`)).length === 1 && (await ok(visitor, 'GET', `${P}/plans`)).length === 1);
const runs = await ok(visitor, 'GET', `${P}/runs`);
check('2 runs', runs.length === 2, JSON.stringify(runs.map((r) => r.title)));
const ciRun = await ok(visitor, 'GET', `${P}/runs/${runs.find((r) => r.source === 'CI')?.id}`);
check('a completed automated run: 11 passed, 1 failed, 1 skipped',
  ciRun.status === 'COMPLETED' && ciRun.progress.PASSED === 11 && ciRun.progress.FAILED === 1 && ciRun.progress.SKIPPED === 1, JSON.stringify(ciRun.progress));
const manualRun = await ok(visitor, 'GET', `${P}/runs/${runs.find((r) => r.source === 'MANUAL')?.id}`);
check('an open manual run, partly done',
  manualRun.status === 'OPEN' && manualRun.progress.PASSED === 1 && manualRun.progress.FAILED === 1
    && manualRun.progress.BLOCKED === 1 && manualRun.progress.UNTESTED === 1, JSON.stringify(manualRun.progress));
const manualResults = await ok(visitor, 'GET', `${P}/results?runId=${manualRun.id}`);
check('manual results have step results', manualResults.some((r) => r.stepResults.some((s) => s.status === 'FAILED' && s.comment)));
const automated = await ok(visitor, 'GET', `${P}/results?runId=${ciRun.id}`);
check('automated results come from Playwright', automated.length === 13 && automated.every((r) => r.source === 'AUTOMATION' && r.automationSourceLabel === 'Playwright'));
const defects = await ok(visitor, 'GET', `${P}/defects`);
check('2 defects, each linked to a failed result', defects.length === 2 && defects.every((d) => d._count?.results === 1), JSON.stringify(defects.map((d) => d._count)));

console.log('--- Visitors stay out of the member lists ---');
const members = await ok(visitor, 'GET', `/workspaces/${DEMO_WORKSPACE_ID}/members`);
check('the only member is the system user', members.length === 1 && members[0].user.displayName === 'TestOps Demo', JSON.stringify(members));
check('...shown without an email address', !('email' in members[0].user));
const projectMembers = await ok(visitor, 'GET', `${P}/members`);
check('the project members list has no email addresses either', projectMembers.length === 1 && !('email' in projectMembers[0].user));
await register('two');
check('another sign-up adds nobody', (await ok(visitor, 'GET', `/workspaces/${DEMO_WORKSPACE_ID}/members`)).length === 1);

console.log('--- Visitors change nothing ---');
const testCase = cases[0];
const run = manualRun;
await expectStatus('a visitor cannot add a case', 403, visitor, 'POST', `${P}/cases`, { title: 'Spam' });
await expectStatus('...or edit one', 403, visitor, 'PATCH', `${P}/cases/${testCase.id}`, { title: 'Spam' });
await expectStatus('...or record a result', 403, visitor, 'POST', `${P}/runs/${run.id}/results`, { testCaseId: run.runCases[0].testCaseId, status: 'PASSED' });
await expectStatus('...or start a run', 403, visitor, 'POST', `${P}/runs`, { title: 'Spam run', testCaseIds: [testCase.id] });
await expectStatus('...or delete a run', 403, visitor, 'DELETE', `${P}/runs/${run.id}`);
await expectStatus('...or file a defect', 403, visitor, 'POST', `${P}/defects`, { title: 'Spam' });
await expectStatus('...or add a project member', 403, visitor, 'POST', `${P}/members`, { email: `one-${sfx}@test.local`, role: 'ADMIN' });
await expectStatus('...or archive the project', 403, visitor, 'DELETE', P);
await expectStatus('...or create a project in the demo workspace', 403, visitor, 'POST', `/workspaces/${DEMO_WORKSPACE_ID}/projects`, { key: 'SPM', name: 'Spam' });
await expectStatus('...or rename the workspace', 403, visitor, 'PATCH', `/workspaces/${DEMO_WORKSPACE_ID}`, { name: 'Spam' });
await expectStatus('...or invite people to it', 403, visitor, 'POST', `/workspaces/${DEMO_WORKSPACE_ID}/invitations`, { email: `friend-${sfx}@test.local`, role: 'ADMIN' });
await expectStatus('...or delete it', 403, visitor, 'DELETE', `/workspaces/${DEMO_WORKSPACE_ID}`, { confirmName: 'DEMO' });

// An API token acts as its user, so it reads the demo too and changes nothing either.
const token = (await ok(visitor, 'POST', '/api-tokens', { name: 'Demo reader' })).token;
check('an API token reads the demo', (await call(token, 'GET', `${P}/cases`)).status === 200);
await expectStatus('...and cannot write to it', 403, token, 'POST', `${P}/cases`, { title: 'Spam' });

console.log('--- Everyone else keeps their own access ---');
const admin = await auth('/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
check('an installation admin is only a visitor of the demo', (await ok(admin, 'GET', `/workspaces/${DEMO_WORKSPACE_ID}`)).currentUserRole === 'MEMBER');
await expectStatus('...and cannot change it either', 403, admin, 'POST', `${P}/cases`, { title: 'Spam' });
const privateWs = await ok(admin, 'POST', '/workspaces', { name: `Private ${sfx}`, slug: `private-${sfx}` });
const privateProject = await ok(admin, 'POST', `/workspaces/${privateWs.id}/projects`, { key: 'PRV', name: 'Private' });
check("visitors don't see other people's workspaces", !(await ok(visitor, 'GET', '/workspaces')).some((w) => w.id === privateWs.id));
await expectStatus('...or open them', 403, visitor, 'GET', `/workspaces/${privateWs.id}`);
await expectStatus('...or their projects', 403, visitor, 'GET', `/projects/${privateProject.id}`);
await ok(admin, 'DELETE', `/workspaces/${privateWs.id}`, { confirmName: privateWs.name });

done();
