// API completeness smoke test: pagination and filters on list endpoints, the get/update/delete
// endpoints that complete each resource's CRUD, bulk case creation, project-wide listings, archived
// projects and the cleanup of attachment files. Runs against a running stack and creates its own data:
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
const testerInvitation = await ok(admin, 'POST', `/workspaces/${ws.id}/invitations`, { email: testerEmail, role: 'MEMBER' });
await ok(tester, 'POST', `/invitations/${testerInvitation.token}/accept`);
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
// Each linked case with its latest result and the run it is in, for the list under a requirement.
const perCase = new Map((coverage.find((r) => r.requirementId === covered.id)?.cases ?? []).map((c) => [c.testCaseId, c.latestResult]));
check('coverage lists every linked case', perCase.size === 5, JSON.stringify([...perCase.keys()]));
const fixedLatest = perCase.get(fixedLater.id);
const newerRun = await ok(admin, 'GET', `${P}/runs/${newer.id}`);
check("...with each case's latest result and its run",
  fixedLatest?.status === 'PASSED' && fixedLatest.runId === newer.id && fixedLatest.runTitle === 'Coverage nightly'
    && fixedLatest.runCaseId === newerRun.runCases.find((rc) => rc.testCaseId === fixedLater.id)?.id
    && perCase.get(failing.id)?.status === 'FAILED' && perCase.get(retried.id)?.status === 'PASSED', JSON.stringify(fixedLatest));
check('...and none for a case that never ran', perCase.get(neverRun.id) === null);
const empty = coverage.find((r) => r.requirementId === uncovered.id);
check('a requirement without cases has no coverage', empty?.hasCoverage === false && empty.caseCount === 0
  && Object.keys(empty.lastResultStatusBreakdown).length === 0, JSON.stringify(empty));

// ---------- requirements chosen in the case form
console.log('--- Cases linked to requirements when saved ---');
const linkedCase = await ok(admin, 'POST', `${P}/cases`, { title: 'Pay with a saved card', requirementIds: [covered.id, uncovered.id] });
const linksOf = async (r) => (await ok(admin, 'GET', `${P}/requirements/${r.id}`)).cases.map((c) => c.testCase.id);
check('a new case can be linked to requirements',
  linkedCase.requirements?.length === 2 && (await linksOf(covered)).includes(linkedCase.id) && (await linksOf(uncovered)).includes(linkedCase.id),
  JSON.stringify(linkedCase.requirements));
await ok(admin, 'PATCH', `${P}/cases/${linkedCase.id}`, { requirementIds: [uncovered.id] });
check('an edit replaces the links', !(await linksOf(covered)).includes(linkedCase.id) && (await linksOf(uncovered)).includes(linkedCase.id));
await ok(admin, 'PATCH', `${P}/cases/${linkedCase.id}`, { title: 'Pay with a stored card' });
check('...and an edit without requirementIds keeps them', (await linksOf(uncovered)).includes(linkedCase.id));
const listedCase = (await ok(admin, 'GET', `${P}/cases`)).find((c) => c.id === linkedCase.id);
check('the case list names the linked requirements', listedCase?.requirements?.[0]?.requirement?.title === 'Refunds are covered', JSON.stringify(listedCase?.requirements));
await ok(admin, 'PATCH', `${P}/cases/${linkedCase.id}`, { requirementIds: [] });
check('an empty list removes every link', !(await linksOf(uncovered)).includes(linkedCase.id));
const foreignReq = await ok(admin, 'POST', `${other}/requirements`, { title: 'Another project' });
await expectStatus("a requirement of another project can't be linked", 404, admin, 'POST', `${P}/cases`, { title: 'Cross link', requirementIds: [foreignReq.id] });
await expectStatus('...on an edit either', 404, admin, 'PATCH', `${P}/cases/${linkedCase.id}`, { requirementIds: [foreignReq.id] });

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
const demoIds = new Set((await ok(tester, 'GET', '/workspaces')).filter((w) => w.isDemo).map((w) => w.id));
const mine = await call(tester, 'GET', '/projects');
// The DEMO workspace's projects are listed for everyone; the rest are the tester's own.
const own = (mine.json ?? []).filter((p) => !demoIds.has(p.workspace.id));
check('a member lists only the projects they belong to, across workspaces',
  mine.status === 200 && own.length === 1 && own[0].id === P.split('/')[2] && own[0].workspace.id === ws.id, JSON.stringify(mine.json));
const adminProjects = await call(admin, 'GET', `/projects?workspaceId=${ws.id}`);
check('a workspace admin lists every project of the workspace', total(adminProjects) === 2);
check('projects can be searched by key', total(await call(admin, 'GET', `/projects?workspaceId=${ws.id}&q=ot`)) === 1);
const fields = await call(tester, 'GET', '/system-fields');
check('system fields list the allowed values',
  fields.status === 200 && fields.json.result.status.includes('PASSED') && fields.json.testCase.priority.includes('HIGH') && fields.json.roles.project.includes('TESTER'), JSON.stringify(fields.json));
await expectStatus('system fields require sign-in', 401, null, 'GET', '/system-fields');

// ---------- plans → runs: fields, order, archived cases and assignments (FR-030, FR-032)
console.log('--- Plans and runs ---');
const testerId = (await ok(tester, 'GET', '/auth/me')).id;
const c1 = await ok(admin, 'POST', `${P}/cases`, { title: 'Plan case 1' });
const c2 = await ok(admin, 'POST', `${P}/cases`, { title: 'Plan case 2' });
const c3 = await ok(admin, 'POST', `${P}/cases`, { title: 'Plan case 3' });
const release2 = await ok(admin, 'POST', `${P}/milestones`, { name: 'Release 2' });
const release2Plan = await ok(admin, 'POST', `${P}/plans`, {
  title: 'Release 2 regression', milestoneId: release2.id, environment: 'staging', configuration: 'chrome',
  testCaseIds: [c2.id, c1.id], assigneeId: testerId,
});
await ok(admin, 'POST', `${P}/plans/${release2Plan.id}/cases`, { testCaseIds: [c3.id] });
const planNow = await ok(admin, 'GET', `${P}/plans/${release2Plan.id}`);
check('a release2Plan keeps its case order, added cases go last',
  planNow.items.map((i) => i.testCaseId).join() === [c2.id, c1.id, c3.id].join(), JSON.stringify(planNow.items.map((i) => i.testCaseId)));
check('the case-ids endpoint returns the release2Plan order',
  (await ok(admin, 'GET', `${P}/plans/${release2Plan.id}/case-ids`)).testCaseIds.join() === [c2.id, c1.id, c3.id].join());
check('a release2Plan can assign its cases', planNow.items.filter((i) => i.assigneeId === testerId).length === 2);
await expectStatus('a single release2Plan case can be assigned', 200, admin, 'PATCH', `${P}/plans/${release2Plan.id}/cases/${c3.id}`, { assigneeId: testerId });
await expectStatus('only people with access to the project can be assigned', 404, admin, 'PATCH', `${P}/plans/${release2Plan.id}/cases/${c3.id}`, { assigneeId: 'not-a-user' });
// Assigning every case of the plan at once while planning: all or none.
const planCaseIds = [c2.id, c1.id, c3.id];
const planAssignees = async () => (await ok(admin, 'GET', `${P}/plans/${release2Plan.id}`)).items.map((i) => i.assigneeId);
const unassignedAll = await call(admin, 'PATCH', `${P}/plans/${release2Plan.id}/cases`, { testCaseIds: planCaseIds, assigneeId: null });
check(`[${unassignedAll.status}] every case of a plan can be unassigned at once`,
  unassignedAll.status === 200 && unassignedAll.json.count === 3 && (await planAssignees()).every((a) => a === null), JSON.stringify(unassignedAll.json));
await expectStatus('a case outside the plan makes the whole assignment fail', 404, admin, 'PATCH', `${P}/plans/${release2Plan.id}/cases`, { testCaseIds: [c1.id, caseA.id], assigneeId: testerId });
check('...and changes nothing', (await planAssignees()).every((a) => a === null));
await expectStatus('a tester assigns every case of the plan at once', 200, tester, 'PATCH', `${P}/plans/${release2Plan.id}/cases`, { testCaseIds: planCaseIds, assigneeId: testerId });
check('...to that person', (await planAssignees()).every((a) => a === testerId));
await ok(admin, 'DELETE', `${P}/cases/${c3.id}`); // archived after it was planned
const fromPlan = await ok(admin, 'POST', `${P}/runs`, { title: 'Release 2 run', planId: release2Plan.id });
check('a run from a release2Plan takes its milestone, environment and configuration',
  fromPlan.milestoneId === release2.id && fromPlan.environment === 'staging' && fromPlan.configuration === 'chrome', JSON.stringify(fromPlan));
const fromPlanCases = [...fromPlan.runCases].sort((a, b) => a.position - b.position);
check('...lists the cases in release2Plan order and leaves archived ones out',
  fromPlanCases.map((rc) => rc.testCaseId).join() === [c2.id, c1.id].join(), JSON.stringify(fromPlanCases.map((rc) => rc.testCaseId)));
check('...and takes over the assignments', fromPlanCases.every((rc) => rc.assigneeId === testerId));
// How each case runs in a run: as the case is defined, unless the run says otherwise (this run only).
check('...and its cases run as they are defined (manual here)', fromPlanCases.every((rc) => rc.executionMode === 'MANUAL'), JSON.stringify(fromPlanCases.map((rc) => rc.executionMode)));
const chosenModes = await ok(admin, 'POST', `${P}/runs`, { title: 'Release 2 mixed', planId: release2Plan.id, automatedCaseIds: [c1.id] });
check('a run can choose which cases automation runs',
  chosenModes.runCases.find((rc) => rc.testCaseId === c1.id)?.executionMode === 'AUTOMATED'
    && chosenModes.runCases.every((rc) => rc.testCaseId === c1.id || rc.executionMode === 'MANUAL'), JSON.stringify(chosenModes.runCases.map((rc) => rc.executionMode)));
check('...without changing the case', (await ok(admin, 'GET', `${P}/cases/${c1.id}`)).automationStatus !== 'AUTOMATED');
await expectStatus('automatedCaseIds can only name cases of the run', 400, admin, 'POST', `${P}/runs`, { title: 'Bad modes', planId: release2Plan.id, automatedCaseIds: [caseA.id] });
const automatedCase = await ok(admin, 'POST', `${P}/cases`, { title: 'Checkout from CI', automationStatus: 'AUTOMATED' });
const adHocModes = await ok(admin, 'POST', `${P}/runs`, { title: 'Ad hoc modes', testCaseIds: [automatedCase.id, c1.id] });
check('an automated case runs as automated by default',
  adHocModes.runCases.find((rc) => rc.testCaseId === automatedCase.id)?.executionMode === 'AUTOMATED'
    && adHocModes.runCases.find((rc) => rc.testCaseId === c1.id)?.executionMode === 'MANUAL');
const overridden = await ok(admin, 'POST', `${P}/runs`, { title: 'Prod check', planId: release2Plan.id, environment: 'production' });
check('values in the request win over the release2Plan', overridden.environment === 'production' && overridden.configuration === 'chrome');
const adHoc = await ok(admin, 'POST', `${P}/runs`, { title: 'Ad hoc', testCaseIds: [c2.id, c1.id, c2.id] });
check('an ad hoc run keeps the given order and ignores repeats',
  [...adHoc.runCases].sort((a, b) => a.position - b.position).map((rc) => rc.testCaseId).join() === [c2.id, c1.id].join());
await expectStatus('an ad hoc run cannot include an archived case', 400, admin, 'POST', `${P}/runs`, { title: 'x', testCaseIds: [c1.id, c3.id] });
const adHocCase = adHoc.runCases[0];
await expectStatus('a tester can take a case in a run', 200, tester, 'PATCH', `${P}/runs/${adHoc.id}/cases/${adHocCase.id}`, { assigneeId: testerId });
await expectStatus('...and give it back', 200, tester, 'PATCH', `${P}/runs/${adHoc.id}/cases/${adHocCase.id}`, { assigneeId: null });
const assignedRuns = await ok(tester, 'GET', `${P}/runs?assigneeId=${testerId}`);
check('runs can be filtered to the ones with cases assigned to someone',
  assignedRuns.some((r) => r.id === fromPlan.id) && !assignedRuns.some((r) => r.id === adHoc.id), JSON.stringify(assignedRuns.map((r) => r.title)));
// Someone who left the project is not assigned in new runs.
const testerMembership = (await ok(admin, 'GET', `${P}/members`)).find((m) => m.user.email === testerEmail);
await ok(admin, 'DELETE', `${P}/members/${testerMembership.id}`);
const afterLeaving = await ok(admin, 'POST', `${P}/runs`, { title: 'After leaving', planId: release2Plan.id });
check('an assignee who left the project is not assigned in new runs', afterLeaving.runCases.every((rc) => rc.assigneeId === null));
await ok(admin, 'POST', `${P}/members`, { email: testerEmail, role: 'TESTER' });

// ---------- archive and restore: cases, requirements, plans
console.log('--- Archiving and restoring ---');
const arCase = await ok(admin, 'POST', `${P}/cases`, { title: 'To archive' });
const arReq = await ok(admin, 'POST', `${P}/requirements`, { title: 'To archive' });
const arPlan = await ok(admin, 'POST', `${P}/plans`, { title: 'To archive', testCaseIds: [arCase.id] });
const archivable = [
  ['case', `${P}/cases`, arCase.id],
  ['requirement', `${P}/requirements`, arReq.id],
  ['plan', `${P}/plans`, arPlan.id],
];
for (const [label, list, id] of archivable) {
  await ok(tester, 'DELETE', `${list}/${id}`);
  const hidden = !(await ok(tester, 'GET', list)).some((x) => x.id === id);
  const shown = (await ok(tester, 'GET', `${list}?includeArchived=true`)).some((x) => x.id === id && x.archivedAt);
  check(`an archived ${label} leaves the list and shows with includeArchived`, hidden && shown);
}
await expectStatus('an archived plan starts no runs', 400, admin, 'POST', `${P}/runs`, { title: 'x', planId: arPlan.id });
for (const [label, list, id] of archivable) {
  const restored = await expectStatus(`a tester restores the ${label}`, 200, tester, 'POST', `${list}/${id}/restore`);
  check(`...which is back in the list`, restored.json?.archivedAt === null && (await ok(tester, 'GET', list)).some((x) => x.id === id));
}
await expectStatus('a restored plan starts runs again', 201, admin, 'POST', `${P}/runs`, { title: 'After restore', planId: arPlan.id });

// Restoring needs the same roles as archiving, and stays inside the project.
const rCase = await ok(admin, 'POST', `${P}/cases`, { title: 'Restore guard' });
const rReq = await ok(admin, 'POST', `${P}/requirements`, { title: 'Restore guard' });
const rPlan = await ok(admin, 'POST', `${P}/plans`, { title: 'Restore guard', testCaseIds: [rCase.id] });
const restorable = [
  ['case', `${P}/cases`, rCase.id],
  ['requirement', `${P}/requirements`, rReq.id],
  ['plan', `${P}/plans`, rPlan.id],
];
for (const [, list, id] of restorable) await ok(admin, 'DELETE', `${list}/${id}`);
// The tester is re-roled in turn (this avoids registering more accounts, which the sign-in rate limit counts).
const guardMember = (await ok(admin, 'GET', `${P}/members`)).find((m) => m.user.email === testerEmail);
for (const role of ['VIEWER', 'AUTOMATION']) {
  await ok(admin, 'PATCH', `${P}/members/${guardMember.id}`, { role });
  for (const [label, list, id] of restorable) {
    await expectStatus(`${role.toLowerCase()}: cannot restore the ${label}`, 403, tester, 'POST', `${list}/${id}/restore`);
  }
}
await ok(admin, 'PATCH', `${P}/members/${guardMember.id}`, { role: 'TESTER' });
for (const [label, list, id] of restorable) {
  await expectStatus(`the ${label} of another project is not found`, 404, admin, 'POST', `${list.replace(P, other)}/${id}/restore`);
}
check('...and nothing was restored by the refused calls',
  (await ok(admin, 'GET', `${P}/cases?includeArchived=true`)).find((c) => c.id === rCase.id)?.archivedAt !== null);

// A plan whose cases are all archived has no active cases: it lists none and starts no run.
const onlyArchivedPlan = await ok(admin, 'POST', `${P}/plans`, { title: 'Only archived', testCaseIds: [rCase.id] });
const listedPlan = (await ok(admin, 'GET', `${P}/plans`)).find((p) => p.id === onlyArchivedPlan.id);
check('a plan counts its active cases only', listedPlan?._count.items === 0, JSON.stringify(listedPlan?._count));
const noActive = await expectStatus('a plan with only archived cases starts no run', 400, admin, 'POST', `${P}/runs`, { title: 'x', planId: onlyArchivedPlan.id });
check('...and the answer says why', /no active test cases/.test(noActive.json?.message ?? ''), JSON.stringify(noActive.json));
await expectStatus('an empty plan starts no run', 400, admin, 'POST', `${P}/runs`, { title: 'x', planId: (await ok(admin, 'POST', `${P}/plans`, { title: 'Empty' })).id });
await ok(admin, 'POST', `${P}/cases/${rCase.id}/restore`);
check('restoring its case makes the plan count it again',
  (await ok(admin, 'GET', `${P}/plans`)).find((p) => p.id === onlyArchivedPlan.id)?._count.items === 1);
await expectStatus('...and start a run', 201, admin, 'POST', `${P}/runs`, { title: 'Back again', planId: onlyArchivedPlan.id });

// PATCH with null clears an optional field; leaving it out keeps it.
const full = await ok(admin, 'POST', `${P}/cases`, { title: 'Clearable', description: 'text', preconditions: 'before' });
const cleared = await ok(admin, 'PATCH', `${P}/cases/${full.id}`, { description: null });
check('null clears a case description and leaves the rest', cleared.description === null && cleared.preconditions === 'before', JSON.stringify(cleared));
const clearableReq = await ok(admin, 'POST', `${P}/requirements`, { title: 'Clearable', externalRef: 'SHOP-1', description: 'text' });
const clearedReq = await ok(admin, 'PATCH', `${P}/requirements/${clearableReq.id}`, { externalRef: null });
check('null clears a requirement reference and leaves the rest', clearedReq.externalRef === null && clearedReq.description === 'text', JSON.stringify(clearedReq));
const clearablePlan = await ok(admin, 'POST', `${P}/plans`, { title: 'Clearable', description: 'text', environment: 'staging' });
const clearedPlan = await ok(admin, 'PATCH', `${P}/plans/${clearablePlan.id}`, { environment: null });
check('null clears a plan environment and leaves the rest', clearedPlan.environment === null && clearedPlan.description === 'text', JSON.stringify(clearedPlan));

// Deleting a suite keeps its sub-suites and cases and moves them to the top level.
const parentSuite = await ok(admin, 'POST', `${P}/suites`, { name: 'Doomed parent' });
const childSuite = await ok(admin, 'POST', `${P}/suites`, { name: 'Surviving child', parentId: parentSuite.id });
const looseCase = await ok(admin, 'POST', `${P}/cases`, { title: 'Surviving case', suiteId: parentSuite.id });
await expectStatus('a suite with sub-suites and cases is deleted', 200, admin, 'DELETE', `${P}/suites/${parentSuite.id}`);
check('its sub-suite moves to the top level', (await ok(admin, 'GET', `${P}/suites/${childSuite.id}`)).parentId === null);
check('its case is kept without a suite', (await ok(admin, 'GET', `${P}/cases/${looseCase.id}`)).suiteId === null);

// ---------- invalid input and parallel requests get 4xx, not 500
console.log('--- Invalid input and races ---');
const vSuite = await ok(admin, 'POST', `${P}/suites`, { name: 'Validation' });
const vCase = await ok(admin, 'POST', `${P}/cases`, { title: 'Validation case' });
const vRun = await ok(admin, 'POST', `${P}/runs`, { title: 'Validation run', testCaseIds: [vCase.id] });
const tooBig = 3_000_000_000;
await expectStatus('an empty parent suite ID is rejected', 400, admin, 'POST', `${P}/suites`, { name: 'x', parentId: '' });
await expectStatus('an empty suite ID on a case is rejected', 400, admin, 'POST', `${P}/cases`, { title: 'x', suiteId: '' });
await expectStatus('an empty milestone ID on a run is rejected', 400, admin, 'POST', `${P}/runs`, { title: 'x', milestoneId: '', testCaseIds: [vCase.id] });
await expectStatus('an empty assignee is rejected instead of stored', 400, admin, 'POST', `${P}/defects`, { title: 'x', assigneeId: '' });
await expectStatus('a duration beyond the integer range is rejected', 400, admin, 'POST', `${P}/runs/${vRun.id}/results`, { testCaseId: vCase.id, status: 'PASSED', durationMs: tooBig });
await expectStatus('a negative duration is rejected', 400, admin, 'POST', `${P}/runs/${vRun.id}/results`, { testCaseId: vCase.id, status: 'PASSED', durationMs: -5 });
await expectStatus('a suite position beyond the integer range is rejected', 400, admin, 'PATCH', `${P}/suites/${vSuite.id}`, { position: tooBig });
const nul = await expectStatus('a NUL character in text is rejected', 400, admin, 'POST', `${P}/cases`, { title: 'a\u0000b' });
check('...with a message that says so', /NUL/.test(nul.json?.message ?? ''), JSON.stringify(nul.json));
await expectStatus('a NUL character in the URL is rejected', 400, admin, 'GET', '/projects/%00');
await expectStatus('an empty workspace name is rejected', 400, admin, 'PATCH', `/workspaces/${ws.id}`, { name: '' });
await expectStatus('a workspace name that is not text is rejected', 400, admin, 'PATCH', `/workspaces/${ws.id}`, { name: 123 });
await expectStatus('unknown workspace fields are rejected', 400, admin, 'PATCH', `/workspaces/${ws.id}`, { name: ws.name, foo: 1 });
check('a workspace can still be renamed', (await ok(admin, 'PATCH', `/workspaces/${ws.id}`, { name: `${ws.name} renamed` })).name === `${ws.name} renamed`);
await ok(admin, 'PATCH', `/workspaces/${ws.id}`, { name: ws.name }); // the deletion check below confirms with this name
const statuses = (responses) => responses.map((r) => r.status).sort().join(',');
const slugRace = await Promise.all(Array.from({ length: 5 }, () => call(admin, 'POST', '/workspaces', { name: 'Race', slug: `race-${sfx}` })));
check('parallel workspaces with one slug: one 201, the rest 409', statuses(slugRace) === '201,409,409,409,409', statuses(slugRace));
const keyRace = await Promise.all(Array.from({ length: 5 }, () => call(admin, 'POST', `/workspaces/${ws.id}/projects`, { key: 'RACE', name: 'Race' })));
check('parallel projects with one key: one 201, the rest 409', statuses(keyRace) === '201,409,409,409,409', statuses(keyRace));
const delRace = await Promise.all(Array.from({ length: 3 }, () => call(admin, 'DELETE', `${P}/suites/${vSuite.id}`)));
check('parallel deletes of one suite: one succeeds, the rest 404', statuses(delRace) === '200,404,404', statuses(delRace));
const raceWs = slugRace.find((r) => r.status === 201)?.json;
if (raceWs) await ok(admin, 'DELETE', `/workspaces/${raceWs.id}`, { confirmName: raceWs.name });

// ---------- archived projects: read-only until restored
console.log('--- Archived projects ---');
const pid = P.split('/')[2];
const keptCase = await ok(tester, 'POST', `${P}/cases`, { title: 'Kept case' });
const keptRun = await ok(admin, 'POST', `${P}/runs`, { title: 'Kept run', testCaseIds: [keptCase.id] });
await ok(admin, 'POST', `${P}/runs/${keptRun.id}/share`, { enabled: true });
const lateArchived = await ok(tester, 'POST', `${P}/cases`, { title: 'Archived before the project' });
await ok(tester, 'DELETE', `${P}/cases/${lateArchived.id}`);
await expectStatus('a tester cannot archive the project', 403, tester, 'DELETE', P);
const archived = await expectStatus('a project admin archives the project', 200, admin, 'DELETE', P);
check('archiving again keeps the date', (await ok(admin, 'DELETE', P)).archivedAt === archived.json?.archivedAt && !!archived.json?.archivedAt);
const listed = (items) => items.some((p) => p.id === pid);
check('an archived project leaves the project lists',
  !listed(await ok(admin, 'GET', `/workspaces/${ws.id}/projects`)) && !listed(await ok(tester, 'GET', '/projects')));
const archivedList = await call(admin, 'GET', `/workspaces/${ws.id}/projects?archived=true`);
check('archived projects can be listed', archivedList.status === 200 && archivedList.json.length === 1 && archivedList.json[0].id === pid, JSON.stringify(archivedList.json));
check('its data can still be read',
  (await call(tester, 'GET', `${P}/cases`)).status === 200 && (await call(tester, 'GET', `${P}/runs/${keptRun.id}`)).status === 200
  && !!(await ok(tester, 'GET', P)).archivedAt);
const blocked = await expectStatus('no new cases', 409, tester, 'POST', `${P}/cases`, { title: 'x' });
check('the answer says the project is archived', /archived/.test(blocked.json?.message ?? ''), JSON.stringify(blocked.json));
await expectStatus('no restoring in an archived project', 409, admin, 'POST', `${P}/cases/${lateArchived.id}/restore`);
await expectStatus('no edits to existing cases', 409, tester, 'PATCH', `${P}/cases/${keptCase.id}`, { title: 'Changed' });
await expectStatus('no results, also from CI', 409, tester, 'POST', `${P}/runs/${keptRun.id}/results/bulk`, { results: [{ testCaseId: keptCase.id, status: 'PASSED' }] });
await expectStatus('no new runs', 409, admin, 'POST', `${P}/runs`, { title: 'x', testCaseIds: [keptCase.id] });
await expectStatus('no new suites', 409, admin, 'POST', `${P}/suites`, { name: 'x' });
await expectStatus('no renaming', 409, admin, 'PATCH', P, { name: 'Renamed' });
await expectStatus('no new public links', 409, admin, 'POST', `${P}/runs/${keptRun.id}/share`, { enabled: true });
await expectStatus('a public link can still be turned off', 201, admin, 'POST', `${P}/runs/${keptRun.id}/share`, { enabled: false });
const testerMember = (await ok(admin, 'GET', `${P}/members`)).find((m) => m.user.email === testerEmail);
await expectStatus('members can still be managed', 200, admin, 'PATCH', `${P}/members/${testerMember.id}`, { role: 'VIEWER' });
const keyTaken = await expectStatus('a new project cannot take its key', 409, admin, 'POST', `/workspaces/${ws.id}/projects`, { key: 'CR', name: 'Again' });
check('...and the answer points to the archived project', /archived/i.test(keyTaken.json?.message ?? ''), JSON.stringify(keyTaken.json));
await expectStatus('a tester cannot restore it', 403, tester, 'POST', `${P}/restore`);
const restored = await expectStatus('a project admin restores it', 200, admin, 'POST', `${P}/restore`);
check('a restored project is listed and writable again',
  restored.json?.archivedAt === null && listed(await ok(admin, 'GET', `/workspaces/${ws.id}/projects`))
  && (await call(admin, 'POST', `${P}/cases`, { title: 'After restore' })).status === 201);

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
