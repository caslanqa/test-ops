// Demo workspace smoke test. Every user gets a DEMO workspace of their own (DEMO_WORKSPACE, on by
// default), made the first time they list their workspaces, with them as its admin.
//   docker compose up -d --wait && node tests/smoke/demo-workspace.mjs
// With --disabled it checks a server started with DEMO_WORKSPACE=false, after a run without it:
//   DEMO_WORKSPACE=false docker compose up -d --wait app && node tests/smoke/demo-workspace.mjs --disabled
// Signs up its own users, so it needs SELF_REGISTRATION=true (the default). BASE, ADMIN_EMAIL and
// ADMIN_PASSWORD change the target; the admin is the seeded one (prisma/seed.js).
const BASE = process.env.BASE ?? 'http://localhost:8080/api/v1';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@testops.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';
// The shared demo of earlier versions (apps/api/src/demo/demo.constants.ts), removed at startup.
const LEGACY_DEMO_WORKSPACE_ID = 'd3e00000-0000-4000-8000-000000000002';
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
  email: `${name}-${sfx}@test.local`, displayName: `Demo ${name}`, password: 'DemoPass1234',
});
const done = () => {
  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} CHECKS FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

const one = await register('one');
const admin = await auth('/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

if (process.argv.includes('--disabled')) {
  console.log('--- DEMO_WORKSPACE=false ---');
  const listed = await ok(one, 'GET', '/workspaces');
  check('a new user gets no demo workspace', !listed.some((w) => w.isDemo), JSON.stringify(listed));
  check('the server says it makes none', (await ok(one, 'GET', '/demo-workspace')).enabled === false);
  await expectStatus('...and makes none on request', 404, one, 'POST', '/demo-workspace');
  check('demos made before stay', (await ok(admin, 'GET', '/workspaces')).some((w) => w.isDemo));
  done();
}

console.log('--- A new user gets a demo of their own ---');
// Several requests at once (the page and the side menu both list workspaces) make one demo.
const lists = await Promise.all([1, 2, 3].map(() => ok(one, 'GET', '/workspaces')));
const demos = lists[0].filter((w) => w.isDemo);
check('the first listing has one DEMO workspace', demos.length === 1 && demos[0].name === 'DEMO', JSON.stringify(lists[0]));
check('...in every parallel listing', lists.every((l) => l.filter((w) => w.isDemo).length === 1 && l.find((w) => w.isDemo).id === demos[0].id));
const demo = demos[0];
const ws = await ok(one, 'GET', `/workspaces/${demo.id}`);
check('...where they are the admin', ws.currentUserRole === 'ADMIN' && ws.isDemo === true, JSON.stringify(ws));
check('listing again makes no second one', (await ok(one, 'GET', '/workspaces')).filter((w) => w.isDemo).length === 1);
const members = await ok(one, 'GET', `/workspaces/${demo.id}/members`);
check('they are its only member', members.length === 1 && members[0].user.email === `one-${sfx}@test.local` && members[0].role === 'ADMIN', JSON.stringify(members));
const project = (await ok(one, 'GET', `/workspaces/${demo.id}/projects`)).find((p) => p.key === 'SHOP');
check('...with the example shop project, as its admin', project?.currentUserRole === 'ADMIN', JSON.stringify(project));
const P = `/projects/${project.id}`;
check('it is in the list of projects they can open', (await ok(one, 'GET', '/projects')).some((p) => p.id === project.id));

console.log('--- What the demo holds ---');
const cases = await ok(one, 'GET', `${P}/cases`);
check('17 cases', cases.length === 17, `${cases.length}`);
check('13 automated ones are tagged for the reporter', cases.filter((c) => c.tags.some((t) => t.startsWith('e2e:'))).length === 13);
check('5 suites', (await ok(one, 'GET', `${P}/suites`)).length === 5);
check('4 requirements', (await ok(one, 'GET', `${P}/requirements`)).length === 4);
const plans = await ok(one, 'GET', `${P}/plans`);
check('1 milestone and 1 plan of every case', (await ok(one, 'GET', `${P}/milestones`)).length === 1 && plans.length === 1 && plans[0]._count.items === 17);
const runs = await ok(one, 'GET', `${P}/runs`);
check('2 runs', runs.length === 2, JSON.stringify(runs.map((r) => r.title)));
const ciRun = await ok(one, 'GET', `${P}/runs/${runs.find((r) => r.source === 'CI')?.id}`);
check('a completed automated run: 11 passed, 1 failed, 1 skipped',
  ciRun.status === 'COMPLETED' && ciRun.progress.PASSED === 11 && ciRun.progress.FAILED === 1 && ciRun.progress.SKIPPED === 1, JSON.stringify(ciRun.progress));
const manualRun = await ok(one, 'GET', `${P}/runs/${runs.find((r) => r.source === 'MANUAL')?.id}`);
check('an open manual run, partly done',
  manualRun.status === 'OPEN' && manualRun.progress.PASSED === 1 && manualRun.progress.FAILED === 1
    && manualRun.progress.BLOCKED === 1 && manualRun.progress.UNTESTED === 1, JSON.stringify(manualRun.progress));
const manualResults = await ok(one, 'GET', `${P}/results?runId=${manualRun.id}`);
check('manual results have step results', manualResults.some((r) => r.stepResults.some((s) => s.status === 'FAILED' && s.comment)));
const automated = await ok(one, 'GET', `${P}/results?runId=${ciRun.id}`);
check('automated results come from Playwright', automated.length === 13 && automated.every((r) => r.source === 'AUTOMATION' && r.automationSourceLabel === 'Playwright'));
const defects = await ok(one, 'GET', `${P}/defects`);
check('2 defects, each linked to a failed result', defects.length === 2 && defects.every((d) => d._count?.results === 1), JSON.stringify(defects.map((d) => d._count)));

console.log('--- The demo is theirs to try things on ---');
const me = members[0].user.id;
await expectStatus('they assign plan cases to themselves', 200, one, 'PATCH', `${P}/plans/${plans[0].id}/cases`, { testCaseIds: [cases[0].id, cases[1].id], assigneeId: me });
const started = await expectStatus('...start a run from the plan, some cases for CI', 201, one, 'POST', `${P}/runs`, {
  title: 'My first run', planId: plans[0].id, automatedCaseIds: [cases[0].id],
});
const myRun = await ok(one, 'GET', `${P}/runs/${started.json.id}`);
check('...which takes the plan over: every case, the assignees and the modes',
  myRun.runCases.length === 17
    && myRun.runCases.filter((rc) => rc.assigneeId === me).length === 2
    && myRun.runCases.find((rc) => rc.testCaseId === cases[0].id)?.executionMode === 'AUTOMATED',
  JSON.stringify(myRun.runCases.slice(0, 2)));
await expectStatus('...record a result', 201, one, 'POST', `${P}/runs/${myRun.id}/results`, { testCaseId: cases[1].id, status: 'PASSED' });
await expectStatus('...add a case', 201, one, 'POST', `${P}/cases`, { title: 'My own case' });
await expectStatus('...file a defect', 201, one, 'POST', `${P}/defects`, { title: 'My own defect' });
await expectStatus('...and rename the workspace', 200, one, 'PATCH', `/workspaces/${demo.id}`, { name: 'My demo' });

console.log("--- Each user's demo is their own ---");
const two = await register('two');
const twoDemo = (await ok(two, 'GET', '/workspaces')).filter((w) => w.isDemo);
check('another user gets a demo of their own', twoDemo.length === 1 && twoDemo[0].id !== demo.id, JSON.stringify(twoDemo));
check("...that doesn't hold the first user's changes", (await ok(two, 'GET', `/projects/${(await ok(two, 'GET', `/workspaces/${twoDemo[0].id}/projects`))[0].id}/cases`)).length === 17);
await expectStatus("...and can't open the first user's demo", 403, two, 'GET', `/workspaces/${demo.id}`);
await expectStatus('...or its project', 403, two, 'GET', P);
check('the shared demo of earlier versions is gone', (await call(one, 'GET', `/workspaces/${LEGACY_DEMO_WORKSPACE_ID}`)).status === 403);
check('the seeded admin has a demo too', (await ok(admin, 'GET', '/workspaces')).some((w) => w.isDemo));

console.log('--- A deleted demo stays deleted, and a new one can be made ---');
check('the server says where the demo is', (await ok(one, 'GET', '/demo-workspace')).workspaceId === demo.id);
await expectStatus('a second demo is refused while they have one', 409, one, 'POST', '/demo-workspace');
await expectStatus('they delete their demo', 204, one, 'DELETE', `/workspaces/${demo.id}`, { confirmName: 'My demo' });
check('listing again does not bring it back', !(await ok(one, 'GET', '/workspaces')).some((w) => w.isDemo));
const status = await ok(one, 'GET', '/demo-workspace');
check('the server offers a new one', status.enabled === true && status.workspaceId === null, JSON.stringify(status));
const fresh = await expectStatus('they make a fresh demo', 201, one, 'POST', '/demo-workspace');
const freshProjects = await ok(one, 'GET', `/workspaces/${fresh.json?.id}/projects`);
check('...with the example project, as new', freshProjects.length === 1 && (await ok(one, 'GET', `/projects/${freshProjects[0].id}/cases`)).length === 17);
await expectStatus('...and only one', 409, one, 'POST', '/demo-workspace');

done();
