// Result ingestion smoke test: the CI flow with an API token, bulk uploads of realistic size,
// all-or-nothing uploads, idempotent re-sends, parallel CI jobs and completed runs
// (FR-034, FR-035, FR-043, FR-074, FR-075). Runs against a running stack and creates its own data:
//   docker compose up -d --wait
//   node tests/smoke/results.mjs
// Signs up its own user, so it needs SELF_REGISTRATION=true (the default). BASE changes the target.
const BASE = process.env.BASE ?? 'http://localhost:8080/api/v1';
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
const total = (r) => Number(r.headers.get('x-total-count'));
const ids = (items) => items.map((i) => i.id);
const oneToN = (numbers) => [...numbers].sort((a, b) => a - b).every((n, i) => n === i + 1);
// Map.groupBy needs Node 21; CI runs Node 20.
const byTestCase = (results) => {
  const groups = new Map();
  for (const r of results) groups.set(r.runCase.testCaseId, [...(groups.get(r.runCase.testCaseId) ?? []), r]);
  return groups;
};

// ---------- setup: a fresh workspace admin with an API token, as a CI job would use it
const session = (await ok(null, 'POST', '/auth/register', { email: `results-${sfx}@test.local`, displayName: 'CI Bot', password: 'CiBotPass123' })).accessToken;
const ws = await ok(session, 'POST', '/workspaces', { name: `Results ${sfx}`, slug: `results-${sfx}` });
const P = `/projects/${(await ok(session, 'POST', `/workspaces/${ws.id}/projects`, { key: 'RES', name: 'Results' })).id}`;
const other = `/projects/${(await ok(session, 'POST', `/workspaces/${ws.id}/projects`, { key: 'OTH', name: 'Other' })).id}`;
const ci = (await ok(session, 'POST', '/api-tokens', { name: 'CI' })).token;
const { cases } = await ok(ci, 'POST', `${P}/cases/bulk`, {
  cases: Array.from({ length: 50 }, (_, i) => ({ title: `Checkout scenario ${i + 1}`, automationStatus: 'AUTOMATED' })),
});
const newRun = (title, extra = {}) => ok(ci, 'POST', `${P}/runs`, { title, source: 'CI', ...extra });
const runResults = async (runId, query = '') => (await call(ci, 'GET', `${P}/results?runId=${runId}${query}`)).json;
const caseStatus = async (runId, caseId) => (await ok(ci, 'GET', `${P}/runs/${runId}`)).runCases.find((rc) => rc.testCaseId === caseId)?.status;

// ---------- bulk upload size
console.log('--- Bulk upload size (FR-074) ---');
// A typical failure message with a short stack trace, about 1 KB.
const failure = 'AssertionError: expected the order total to equal 129.90\n'
  + '    at CheckoutPage.verifyTotal (tests/checkout.spec.ts:88:13)\n'.repeat(14);
const nightly = await newRun('Nightly regression');
const upload = Array.from({ length: 500 }, (_, i) => ({
  testCaseId: cases[i % cases.length].id,
  status: i % 7 === 0 ? 'FAILED' : 'PASSED',
  source: 'AUTOMATION',
  externalTestId: `checkout.spec.ts > scenario ${i + 1}`,
  comment: failure,
  durationMs: 1200 + i,
}));
const size = Math.round(JSON.stringify({ results: upload }).length / 1024);
const bulk = await call(ci, 'POST', `${P}/runs/${nightly.id}/results/bulk`, { results: upload });
check(`[${bulk.status}] 500 results with ~1 KB failure messages (${size} KB) are accepted`, bulk.status === 201 && bulk.json?.count === 500, JSON.stringify(bulk.json).slice(0, 200));
const stored = await runResults(nightly.id);
check('every item became a result', stored.length === 500, `${stored.length}`);
const byCase = byTestCase(stored);
check('attempts are numbered 1..n per case', [...byCase.values()].every((rs) => oneToN(rs.map((r) => r.attemptNumber))));
check('each case has exactly one latest attempt', [...byCase.values()].every((rs) => rs.filter((r) => r.isLatest).length === 1));
const nightlyLatest = byCase.get(cases[0].id)?.find((r) => r.isLatest);
check('the case status follows its latest attempt', !!nightlyLatest && (await caseStatus(nightly.id, cases[0].id)) === nightlyLatest.status);

// ---------- all or nothing
console.log('--- All or nothing ---');
const atomic = await newRun('Atomic upload');
await expectStatus('an upload with an unknown case is rejected', 404, ci, 'POST', `${P}/runs/${atomic.id}/results/bulk`, {
  results: [
    { testCaseId: cases[0].id, status: 'PASSED' },
    { testCaseId: 'no-such-case', status: 'PASSED' },
    { testCaseId: cases[1].id, status: 'FAILED' },
  ],
});
const foreign = await ok(session, 'POST', `${other}/cases`, { title: 'Case of another project' });
await expectStatus('an upload with a case of another project is rejected', 404, ci, 'POST', `${P}/runs/${atomic.id}/results/bulk`, {
  results: [{ testCaseId: cases[0].id, status: 'PASSED' }, { testCaseId: foreign.id, status: 'PASSED' }],
});
check('rejected uploads write nothing', total(await call(ci, 'GET', `${P}/results?runId=${atomic.id}`)) === 0
  && (await ok(ci, 'GET', `${P}/runs/${atomic.id}`)).runCases.length === 0);

// ---------- idempotent re-sends
console.log('--- Idempotent re-sends (FR-075) ---');
const retried = await newRun('Retried upload');
const batch = cases.slice(0, 5).map((c, i) => ({ testCaseId: c.id, status: 'FAILED', externalTestId: `retry.spec.ts > test ${i}` }));
const first = await ok(ci, 'POST', `${P}/runs/${retried.id}/results/bulk`, { results: batch });
const again = await ok(ci, 'POST', `${P}/runs/${retried.id}/results/bulk`, { results: batch.map((r) => ({ ...r, status: 'PASSED' })) });
check('re-sending an upload updates the same results', ids(again.results).join() === ids(first.results).join()
  && again.results.every((r) => r.status === 'PASSED' && r.attemptNumber === 1 && r.isLatest));
check('...and adds no rows', total(await call(ci, 'GET', `${P}/results?runId=${retried.id}`)) === 5);
check('...and moves the case status', (await caseStatus(retried.id, cases[0].id)) === 'PASSED');
const repeated = await ok(ci, 'POST', `${P}/runs/${retried.id}/results/bulk`, {
  results: [
    { testCaseId: cases[5].id, status: 'FAILED', externalTestId: 'repeated' },
    { testCaseId: cases[5].id, status: 'PASSED', externalTestId: 'repeated' },
  ],
});
check('a key repeated within one upload becomes one result', repeated.results[0].id === repeated.results[1].id
  && repeated.results[0].status === 'PASSED'
  && total(await call(ci, 'GET', `${P}/results?runId=${retried.id}&testCaseId=${cases[5].id}`)) === 1);
const older = cases[6].id;
await ok(ci, 'POST', `${P}/runs/${retried.id}/results`, { testCaseId: older, status: 'FAILED', externalTestId: 'attempt-1' });
await ok(ci, 'POST', `${P}/runs/${retried.id}/results`, { testCaseId: older, status: 'PASSED', externalTestId: 'attempt-2' });
const resent = await ok(ci, 'POST', `${P}/runs/${retried.id}/results`, { testCaseId: older, status: 'BLOCKED', externalTestId: 'attempt-1' });
check("re-sending an older attempt's key updates that attempt", resent.attemptNumber === 1 && resent.status === 'BLOCKED' && resent.isLatest === false, JSON.stringify(resent));
check('...and keeps the case status of the latest attempt', (await caseStatus(retried.id, older)) === 'PASSED');

// ---------- parallel CI jobs
console.log('--- Parallel CI jobs (FR-034, FR-043) ---');
const sharded = await newRun('Sharded run');
const N = 12;
const target = cases[10].id;
const parallel = await Promise.all(Array.from({ length: N }, (_, i) =>
  call(ci, 'POST', `${P}/runs/${sharded.id}/results`, { testCaseId: target, status: i % 2 ? 'PASSED' : 'FAILED', source: 'AUTOMATION' })));
check(`${N} parallel results for a case not yet in the run all succeed`, parallel.every((r) => r.status === 201), JSON.stringify(parallel.map((r) => r.status)));
const raced = await runResults(sharded.id, `&testCaseId=${target}`);
check('attempt numbers are 1..n without duplicates', raced.length === N && oneToN(raced.map((r) => r.attemptNumber)), JSON.stringify(raced.map((r) => r.attemptNumber)));
const racedLatest = raced.filter((r) => r.isLatest);
check('exactly one latest attempt, the highest one', racedLatest.length === 1 && racedLatest[0].attemptNumber === N, `${racedLatest.length}`);
check('the case status follows it', (await caseStatus(sharded.id, target)) === racedLatest[0]?.status);
check('the case was added to the run once', (await ok(ci, 'GET', `${P}/runs/${sharded.id}`)).runCases.filter((rc) => rc.testCaseId === target).length === 1);
const sameKey = await Promise.all(Array.from({ length: N }, () =>
  call(ci, 'POST', `${P}/runs/${sharded.id}/results`, { testCaseId: cases[11].id, status: 'FAILED', externalTestId: 'flaky.spec.ts > pays by card' })));
check('parallel re-sends of one key all succeed', sameKey.every((r) => r.status === 201), JSON.stringify(sameKey.map((r) => r.status)));
check('...and leave a single result', total(await call(ci, 'GET', `${P}/results?runId=${sharded.id}&testCaseId=${cases[11].id}`)) === 1);
// Shards post the same cases in opposite orders: locking them in a fixed order avoids deadlocks.
const shardCases = cases.slice(20, 40);
const shards = await Promise.all([0, 1, 2, 3].map((shard) =>
  call(ci, 'POST', `${P}/runs/${sharded.id}/results/bulk`, {
    results: (shard % 2 ? [...shardCases].reverse() : shardCases).map((c) => ({ testCaseId: c.id, status: 'PASSED' })),
  })));
check('parallel bulk uploads over the same cases all succeed', shards.every((r) => r.status === 201), JSON.stringify(shards.map((r) => r.status)));
const shardResults = byTestCase(await runResults(sharded.id));
check('...with attempts 1..4 and one latest per case', shardCases.every((c) => {
  const rs = shardResults.get(c.id) ?? [];
  return rs.length === 4 && oneToN(rs.map((r) => r.attemptNumber)) && rs.filter((r) => r.isLatest).length === 1;
}));

// ---------- deleting attempts
console.log('--- Deleting attempts (FR-043) ---');
const corrected = await newRun('Corrected run', { testCaseIds: [cases[12].id] });
const tries = [];
for (const status of ['FAILED', 'FAILED', 'PASSED']) tries.push(await ok(ci, 'POST', `${P}/runs/${corrected.id}/results`, { testCaseId: cases[12].id, status }));
await expectStatus('delete the middle attempt', 204, ci, 'DELETE', `${P}/runs/${corrected.id}/results/${tries[1].id}`);
const next = await ok(ci, 'POST', `${P}/runs/${corrected.id}/results`, { testCaseId: cases[12].id, status: 'BLOCKED' });
check('the next attempt continues after the highest number', next.attemptNumber === 4, `${next.attemptNumber}`);

// ---------- completed runs
console.log('--- Completed runs (FR-035) ---');
await expectStatus('complete the run', 201, ci, 'POST', `${P}/runs/${corrected.id}/complete`);
await expectStatus('a completed run rejects a result', 403, ci, 'POST', `${P}/runs/${corrected.id}/results`, { testCaseId: cases[12].id, status: 'PASSED' });
await expectStatus('...and a bulk upload', 403, ci, 'POST', `${P}/runs/${corrected.id}/results/bulk`, { results: [{ testCaseId: cases[12].id, status: 'PASSED' }] });
await expectStatus('a project admin reopens it', 201, ci, 'POST', `${P}/runs/${corrected.id}/reopen`);
await expectStatus('the reopened run accepts results again', 201, ci, 'POST', `${P}/runs/${corrected.id}/results`, { testCaseId: cases[12].id, status: 'PASSED' });

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
