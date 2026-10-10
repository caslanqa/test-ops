// API completeness smoke test: pagination and filters on list endpoints, the get/update/delete
// endpoints that complete each resource's CRUD, bulk case creation, project-wide listings and
// the cleanup of attachment files. Runs against a running stack and creates its own data:
//   docker compose up -d --wait && docker compose exec -T app node prisma/seed.js
//   node tests/smoke/api-crud.mjs
// BASE, ADMIN_EMAIL, ADMIN_PASSWORD can be used to change the target.
const BASE = process.env.BASE ?? 'http://localhost:8080/api/v1';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@testops.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';
const sfx = Date.now().toString(36);
let failures = 0;

async function call(token, method, path, body, form) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(form || body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
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
async function expectStatus(label, expected, token, method, path, body, form) {
  const r = await call(token, method, path, body, form);
  check(`[${r.status}] ${label}`, r.status === expected, `(expected ${expected}) ${JSON.stringify(r.json)}`);
  return r;
}
const total = (r) => Number(r.headers.get('x-total-count'));
const ids = (items) => items.map((i) => i.id);

// ---------- setup: an admin, a project with a tester, and a separate project
const admin = (await ok(null, 'POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).accessToken;
const testerEmail = `crud-tester-${sfx}@test.local`;
const tester = (await ok(null, 'POST', '/auth/register', { email: testerEmail, displayName: 'CRUD Tester', password: 'TesterPass123' })).accessToken;
const ws = await ok(admin, 'POST', '/workspaces', { name: `CRUD ${sfx}`, slug: `crud-${sfx}` });
const P = `/projects/${(await ok(admin, 'POST', `/workspaces/${ws.id}/projects`, { key: 'CR', name: 'CRUD project' })).id}`;
const other = `/projects/${(await ok(admin, 'POST', `/workspaces/${ws.id}/projects`, { key: 'OT', name: 'Other project' })).id}`;
await ok(admin, 'POST', `/workspaces/${ws.id}/members`, { email: testerEmail, role: 'MEMBER' });
await ok(admin, 'POST', `${P}/members`, { email: testerEmail, role: 'TESTER' });

// ---------- pagination
console.log('--- Pagination and filters ---');
for (let i = 1; i <= 5; i++) await ok(admin, 'POST', `${P}/milestones`, { name: `Release ${i}` });
const page1 = await call(admin, 'GET', `${P}/milestones?limit=2&offset=0`);
const page2 = await call(admin, 'GET', `${P}/milestones?limit=2&offset=2`);
const page3 = await call(admin, 'GET', `${P}/milestones?limit=2&offset=4`);
check('list stays a plain array', Array.isArray(page1.json));
check('X-Total-Count counts all items', total(page1) === 5 && total(page3) === 5, `${total(page1)}`);
check('pages hold 2, 2 and 1 items', page1.json.length === 2 && page2.json.length === 2 && page3.json.length === 1);
const walked = [...ids(page1.json), ...ids(page2.json), ...ids(page3.json)];
check('pages neither repeat nor skip items', new Set(walked).size === 5);
const all = await call(admin, 'GET', `${P}/milestones`);
check('without limit everything is returned', all.json.length === 5 && total(all) === 5);
check('filter q narrows the list and the total', (await call(admin, 'GET', `${P}/milestones?q=release 3`)).json.length === 1);
await expectStatus('limit 0 is rejected', 400, admin, 'GET', `${P}/milestones?limit=0`);
await expectStatus('limit above 500 is rejected', 400, admin, 'GET', `${P}/milestones?limit=501`);
await expectStatus('negative offset is rejected', 400, admin, 'GET', `${P}/milestones?offset=-1`);
await expectStatus('unknown query parameter is rejected', 400, admin, 'GET', `${P}/milestones?nope=1`);
check('CORS exposes X-Total-Count', (await fetch(`${BASE}/auth/config`, { headers: { origin: 'http://example.test' } })).headers.get('access-control-expose-headers')?.includes('X-Total-Count'));

// ---------- bulk case creation
console.log('--- Bulk test cases ---');
const suite = await ok(admin, 'POST', `${P}/suites`, { name: 'Bulk suite' });
const bulk = await call(admin, 'POST', `${P}/cases/bulk`, {
  cases: [
    { title: 'Login works', suiteId: suite.id, priority: 'HIGH', steps: [{ action: 'Open page', expectedResult: 'Form shown' }] },
    { title: 'Login rejects a wrong password', suiteId: suite.id, priority: 'LOW', automationStatus: 'AUTOMATED' },
    { title: 'Logout works', priority: 'LOW' },
  ],
});
check(`[${bulk.status}] bulk create returns the cases`, bulk.status === 201 && bulk.json.count === 3 && bulk.json.cases[0].steps.length === 1, JSON.stringify(bulk.json));
const casesBefore = total(await call(admin, 'GET', `${P}/cases`));
await expectStatus('bulk with a foreign suite is rejected', 404, admin, 'POST', `${P}/cases/bulk`, {
  cases: [{ title: 'Fine' }, { title: 'Bad suite', suiteId: (await ok(admin, 'POST', `${other}/suites`, { name: 'Foreign' })).id }],
});
check('a failed bulk create creates nothing', total(await call(admin, 'GET', `${P}/cases`)) === casesBefore);
await expectStatus('bulk with no cases is rejected', 400, admin, 'POST', `${P}/cases/bulk`, { cases: [] });
await expectStatus('a viewer-level user cannot bulk create', 403, (await ok(null, 'POST', '/auth/register', { email: `crud-out-${sfx}@test.local`, displayName: 'Outsider', password: 'OutsiderPass123' })).accessToken, 'POST', `${P}/cases/bulk`, { cases: [{ title: 'x' }] });
const [caseA, caseB, caseC] = bulk.json.cases;
check('filter by priority', ids((await call(admin, 'GET', `${P}/cases?priority=LOW`)).json).includes(caseB.id) && total(await call(admin, 'GET', `${P}/cases?priority=HIGH`)) === 1);
check('filter by automation status', total(await call(admin, 'GET', `${P}/cases?automationStatus=AUTOMATED`)) === 1);
check('filter by text', ids((await call(admin, 'GET', `${P}/cases?q=wrong password`)).json).join() === caseB.id);
check('filter by suite', total(await call(admin, 'GET', `${P}/cases?suiteId=${suite.id}`)) === 2);
await expectStatus('invalid enum filter is rejected', 400, admin, 'GET', `${P}/cases?priority=URGENT`);

// ---------- requirements
console.log('--- Requirements ---');
const req = await ok(admin, 'POST', `${P}/requirements`, { title: 'Users can sign in' });
await ok(admin, 'POST', `${P}/requirements/${req.id}/cases`, { testCaseIds: [caseA.id, caseB.id] });
const reqCases = await call(admin, 'GET', `${P}/requirements/${req.id}/cases?limit=1`);
check('linked cases of a requirement are listed and paged', reqCases.status === 200 && reqCases.json.length === 1 && total(reqCases) === 2, JSON.stringify(reqCases.json));
check('requirements can be searched', total(await call(admin, 'GET', `${P}/requirements?q=sign in`)) === 1 && total(await call(admin, 'GET', `${P}/requirements?q=nothing`)) === 0);
await expectStatus('linked cases of a foreign requirement are not listed', 404, admin, 'GET', `${other}/requirements/${req.id}/cases`);

// ---------- requirement coverage
console.log('--- Requirement coverage (FR-022) ---');
const { cases: [busy, failing, retried, fixedLater, neverRun] } = await ok(admin, 'POST', `${P}/cases/bulk`, {
  cases: ['busy', 'failing', 'retried', 'fixed later', 'never run'].map((name) => ({ title: `Coverage: ${name}` })),
});
const covered = await ok(admin, 'POST', `${P}/requirements`, { title: 'Checkout is covered' });
await ok(admin, 'POST', `${P}/requirements/${covered.id}/cases`, { testCaseIds: ids([busy, failing, retried, fixedLater, neverRun]) });
const uncovered = await ok(admin, 'POST', `${P}/requirements`, { title: 'Refunds are covered' });
const older = await ok(admin, 'POST', `${P}/runs`, { title: 'Coverage history', testCaseIds: ids([failing, retried, fixedLater]) });
for (const [testCase, status] of [[failing, 'FAILED'], [retried, 'FAILED'], [retried, 'PASSED'], [fixedLater, 'FAILED']]) {
  await ok(admin, 'POST', `${P}/runs/${older.id}/results`, { testCaseId: testCase.id, status });
}
const newer = await ok(admin, 'POST', `${P}/runs`, { title: 'Coverage nightly', testCaseIds: ids([busy, fixedLater]) });
await ok(admin, 'POST', `${P}/runs/${newer.id}/results`, { testCaseId: fixedLater.id, status: 'PASSED' });
// More recent results for one case than the report used to read for a whole requirement (200).
await ok(admin, 'POST', `${P}/runs/${newer.id}/results/bulk`, { results: Array.from({ length: 220 }, () => ({ testCaseId: busy.id, status: 'PASSED' })) });
const coverage = await ok(admin, 'GET', `${P}/requirements/coverage`);
const breakdown = coverage.find((r) => r.requirementId === covered.id)?.lastResultStatusBreakdown ?? {};
check('a failing case stays visible next to a frequently run one', breakdown.FAILED === 1, JSON.stringify(breakdown));
check('each case counts with its latest attempt in its latest run', breakdown.PASSED === 3, JSON.stringify(breakdown));
check('a case that never ran is not counted as executed', Object.values(breakdown).reduce((a, b) => a + b, 0) === 4
  && coverage.find((r) => r.requirementId === covered.id)?.caseCount === 5, JSON.stringify(breakdown));
const empty = coverage.find((r) => r.requirementId === uncovered.id);
check('a requirement without cases has no coverage', empty?.hasCoverage === false && empty.caseCount === 0
  && Object.keys(empty.lastResultStatusBreakdown).length === 0, JSON.stringify(empty));

// ---------- suites and milestones
console.log('--- Suites and milestones ---');
check('get one suite', (await ok(admin, 'GET', `${P}/suites/${suite.id}`)).name === 'Bulk suite');
await expectStatus('a suite of another project is not found', 404, admin, 'GET', `${other}/suites/${suite.id}`);
const ms = (await call(admin, 'GET', `${P}/milestones?q=release 1`)).json[0];
check('get one milestone', (await ok(admin, 'GET', `${P}/milestones/${ms.id}`)).name === 'Release 1');
check('update a milestone', (await ok(admin, 'PATCH', `${P}/milestones/${ms.id}`, { name: 'Release 1.0', dueDate: '2030-01-31' })).name === 'Release 1.0');
await expectStatus('a milestone of another project is not found', 404, admin, 'GET', `${other}/milestones/${ms.id}`);
const plan = await ok(admin, 'POST', `${P}/plans`, { title: 'Release plan', testCaseIds: [caseA.id, caseB.id], milestoneId: ms.id });
const msRun = await ok(admin, 'POST', `${P}/runs`, { title: 'Milestone run', planId: plan.id, milestoneId: ms.id });
check('filter plans and runs by milestone', total(await call(admin, 'GET', `${P}/plans?milestoneId=${ms.id}`)) === 1 && total(await call(admin, 'GET', `${P}/runs?milestoneId=${ms.id}`)) === 1);
await expectStatus('a tester cannot delete a milestone', 403, tester, 'DELETE', `${P}/milestones/${ms.id}`);
await expectStatus('an admin deletes a milestone', 204, admin, 'DELETE', `${P}/milestones/${ms.id}`);
check('its plan and run are kept without a milestone',
  (await ok(admin, 'GET', `${P}/plans/${plan.id}`)).milestoneId === null && (await ok(admin, 'GET', `${P}/runs/${msRun.id}`)).milestoneId === null);
await expectStatus('the milestone is gone', 404, admin, 'GET', `${P}/milestones/${ms.id}`);

// ---------- results: update, delete, project-wide list
console.log('--- Results ---');
const run = await ok(admin, 'POST', `${P}/runs`, { title: 'Result run', testCaseIds: [caseA.id, caseB.id, caseC.id] });
const submit = (testCaseId, status) => ok(admin, 'POST', `${P}/runs/${run.id}/results`, { testCaseId, status, source: 'AUTOMATION' });
const failed = await submit(caseA.id, 'FAILED');
const passed = await submit(caseA.id, 'PASSED');
await submit(caseB.id, 'BLOCKED');
const runCaseStatus = async (caseId) => (await ok(admin, 'GET', `${P}/runs/${run.id}`)).runCases?.find((rc) => rc.testCaseId === caseId)?.status;
const fixed = await call(admin, 'PATCH', `${P}/runs/${run.id}/results/${passed.id}`, { status: 'SKIPPED', comment: 'Environment was down', durationMs: 1200 });
check(`[${fixed.status}] update a result`, fixed.status === 200 && fixed.json.status === 'SKIPPED' && fixed.json.comment === 'Environment was down' && fixed.json.durationMs === 1200, JSON.stringify(fixed.json));
check('updating the latest attempt updates the case status', (await runCaseStatus(caseA.id)) === 'SKIPPED', await runCaseStatus(caseA.id));
await expectStatus('an invalid status is rejected', 400, admin, 'PATCH', `${P}/runs/${run.id}/results/${passed.id}`, { status: 'GREAT' });
await expectStatus('a result of another run is not found', 404, admin, 'PATCH', `${P}/runs/${msRun.id}/results/${passed.id}`, { comment: 'x' });
const byRun = await call(admin, 'GET', `${P}/results?runId=${run.id}`);
check('project-wide results list with total', byRun.status === 200 && total(byRun) === 3 && byRun.json[0].runCase?.runId === run.id, JSON.stringify(byRun.json[0]));
check('filter results by status', total(await call(admin, 'GET', `${P}/results?runId=${run.id}&status=BLOCKED`)) === 1);
check('filter results by test case', total(await call(admin, 'GET', `${P}/results?testCaseId=${caseA.id}`)) === 2);
check('latestOnly hides earlier attempts', total(await call(admin, 'GET', `${P}/results?runId=${run.id}&latestOnly=true`)) === 2);
check('filter results by date', total(await call(admin, 'GET', `${P}/results?from=2999-01-01T00:00:00Z`)) === 0 && total(await call(admin, 'GET', `${P}/results?to=2999-01-01T00:00:00Z`)) >= 3);
await expectStatus('results of another project stay hidden', 200, admin, 'GET', `${other}/results`);
check('...and are empty', total(await call(admin, 'GET', `${other}/results?runId=${run.id}`)) === 0);
await expectStatus('a tester cannot delete a result', 403, tester, 'DELETE', `${P}/runs/${run.id}/results/${passed.id}`);
await expectStatus('an admin deletes the latest result', 204, admin, 'DELETE', `${P}/runs/${run.id}/results/${passed.id}`);
check('the previous attempt becomes the latest and sets the case status', (await runCaseStatus(caseA.id)) === 'FAILED' && (await ok(admin, 'GET', `${P}/runs/${run.id}/results/${failed.id}`)).isLatest === true, await runCaseStatus(caseA.id));
await expectStatus('deleting the only attempt', 204, admin, 'DELETE', `${P}/runs/${run.id}/results/${failed.id}`);
check('with no attempts left the case is untested again', (await runCaseStatus(caseA.id)) === 'UNTESTED', await runCaseStatus(caseA.id));

// ---------- attachments: list, delete, file cleanup
console.log('--- Attachments ---');
const resB = (await call(admin, 'GET', `${P}/results?runId=${run.id}&status=BLOCKED`)).json[0];
const upload = async (token, name) => {
  const form = new FormData();
  form.append('files', new Blob(['log line\n'], { type: 'text/plain' }), name);
  return call(token, 'POST', `${P}/results/${resB.id}/attachments`, undefined, form);
};
const byAdmin = (await upload(admin, 'admin.log')).json[0];
const byTester = (await upload(tester, 'tester.log')).json[0];
const files = await call(admin, 'GET', `${P}/attachments?resultId=${resB.id}`);
check('attachments are listed', files.status === 200 && total(files) === 2, JSON.stringify(files.json));
check('the storage path is never exposed', files.json.every((f) => !('storageKey' in f)));
check('filter attachments by name', total(await call(admin, 'GET', `${P}/attachments?q=TESTER`)) === 1);
check('attachments of another project stay hidden', total(await call(admin, 'GET', `${other}/attachments`)) === 0);
await expectStatus('a tester cannot delete an admin upload', 403, tester, 'DELETE', `${P}/attachments/${byAdmin.id}`);
await expectStatus('a tester deletes their own upload', 204, tester, 'DELETE', `${P}/attachments/${byTester.id}`);
await expectStatus('its download is gone', 404, admin, 'GET', `${P}/attachments/${byTester.id}`);
await expectStatus('an attachment of another project is not found', 404, admin, 'DELETE', `${other}/attachments/${byAdmin.id}`);
await expectStatus('an admin deletes any upload', 204, admin, 'DELETE', `${P}/attachments/${byAdmin.id}`);

// ---------- runs and defects: delete
console.log('--- Deleting runs and defects ---');
const defect = await ok(admin, 'POST', `${P}/defects`, { title: 'Crash on logout', severity: 'HIGH', resultIds: [resB.id] });
await ok(admin, 'POST', `${P}/defects`, { title: 'Typo on the login page', severity: 'LOW' });
await ok(admin, 'PATCH', `${P}/defects/${defect.id}`, { status: 'IN_PROGRESS' });
check('filter defects by status', total(await call(admin, 'GET', `${P}/defects?status=IN_PROGRESS`)) === 1 && total(await call(admin, 'GET', `${P}/defects?status=OPEN`)) === 1);
check('filter defects by severity and text', total(await call(admin, 'GET', `${P}/defects?severity=HIGH`)) === 1 && total(await call(admin, 'GET', `${P}/defects?q=typo`)) === 1);
check('filter runs by status and text', total(await call(admin, 'GET', `${P}/runs?status=OPEN&q=result`)) === 1 && total(await call(admin, 'GET', `${P}/runs?status=COMPLETED`)) === 0);
await expectStatus('a tester cannot delete a defect', 403, tester, 'DELETE', `${P}/defects/${defect.id}`);
await expectStatus('an admin deletes a defect', 204, admin, 'DELETE', `${P}/defects/${defect.id}`);
check('a deleted defect leaves its result', (await ok(admin, 'GET', `${P}/runs/${run.id}/results/${resB.id}`)).id === resB.id);
await expectStatus('the defect is gone', 404, admin, 'GET', `${P}/defects/${defect.id}`);
await expectStatus('a tester cannot delete a run', 403, tester, 'DELETE', `${P}/runs/${run.id}`);
await expectStatus('a run of another project is not found', 404, admin, 'DELETE', `${other}/runs/${run.id}`);
await expectStatus('an admin deletes a run', 204, admin, 'DELETE', `${P}/runs/${run.id}`);
await expectStatus('the run is gone', 404, admin, 'GET', `${P}/runs/${run.id}`);
check('its results are gone too', total(await call(admin, 'GET', `${P}/results?runId=${run.id}`)) === 0);

// ---------- projects, system fields
console.log('--- Projects and system fields ---');
const mine = await call(tester, 'GET', '/projects');
check('a member lists only the projects they belong to, across workspaces',
  mine.status === 200 && mine.json.length === 1 && mine.json[0].id === P.split('/')[2] && mine.json[0].workspace.id === ws.id, JSON.stringify(mine.json));
const adminProjects = await call(admin, 'GET', `/projects?workspaceId=${ws.id}`);
check('a workspace admin lists every project of the workspace', total(adminProjects) === 2);
check('projects can be searched by key', total(await call(admin, 'GET', `/projects?workspaceId=${ws.id}&q=ot`)) === 1);
const fields = await call(tester, 'GET', '/system-fields');
check('system fields list the allowed values',
  fields.status === 200 && fields.json.result.status.includes('PASSED') && fields.json.testCase.priority.includes('HIGH') && fields.json.roles.project.includes('TESTER'), JSON.stringify(fields.json));
await expectStatus('system fields require sign-in', 401, null, 'GET', '/system-fields');

// ---------- workspace: delete
console.log('--- Deleting a workspace ---');
await expectStatus('a member cannot delete the workspace', 403, tester, 'DELETE', `/workspaces/${ws.id}`, { confirmName: ws.name });
await expectStatus('the name must match to confirm', 400, admin, 'DELETE', `/workspaces/${ws.id}`, { confirmName: 'wrong' });
await expectStatus('a workspace admin deletes the workspace', 204, admin, 'DELETE', `/workspaces/${ws.id}`, { confirmName: ws.name });
// Membership is checked before existence, so a deleted workspace looks like one the user can't open.
await expectStatus('the workspace is gone', 403, admin, 'GET', `/workspaces/${ws.id}`);
check('its projects are gone too', (await call(admin, 'GET', `${P}`)).status >= 400);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
