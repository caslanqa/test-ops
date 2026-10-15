// Result ingestion smoke test: the CI flow with an API token, bulk uploads of realistic size,
// all-or-nothing uploads, idempotent re-sends, parallel CI jobs and completed runs
// (FR-034, FR-035, FR-043, FR-074, FR-075), and manual execution with step results, the Invalid status
// and time spent (FR-040). Runs against a running stack and creates its own data:
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

// ---------- blank externalTestId
console.log('--- Blank externalTestId ---');
const blank = await newRun('Blank keys');
for (const key of ['', '   ']) {
  const a = await expectStatus(`externalTestId ${JSON.stringify(key)} is accepted`, 201, ci, 'POST', `${P}/runs/${blank.id}/results`, { testCaseId: cases[13].id, status: 'PASSED', externalTestId: key });
  const b = await expectStatus(`...and again for the same case (no 409)`, 201, ci, 'POST', `${P}/runs/${blank.id}/results`, { testCaseId: cases[13].id, status: 'FAILED', externalTestId: key });
  check('...each is its own attempt without a key', a.json?.id !== b.json?.id && a.json?.externalTestId === null && b.json?.externalTestId === null, JSON.stringify([a.json, b.json]));
}
const blankBulk = await expectStatus('a bulk upload with blank keys repeated for one case', 201, ci, 'POST', `${P}/runs/${blank.id}/results/bulk`, {
  results: [{ testCaseId: cases[14].id, status: 'PASSED', externalTestId: '' }, { testCaseId: cases[14].id, status: 'FAILED', externalTestId: '' }],
});
check('...stores two attempts', blankBulk.json?.results?.length === 2 && blankBulk.json.results[0].id !== blankBulk.json.results[1].id);

// ---------- request size and field caps
console.log('--- Request size and field caps ---');
const big = 'x'.repeat(150 * 1024);
await expectStatus('a >100 KB login body is rejected', 413, null, 'POST', '/auth/login', { email: `${big}@test.local`, password: 'x' });
await expectStatus('a >100 KB register body is rejected', 413, null, 'POST', '/auth/register', { email: 'a@test.local', displayName: big, password: 'x' });
await expectStatus('a >100 KB body on another authenticated route is rejected', 413, ci, 'POST', `${P}/runs/${blank.id}/results`, { testCaseId: cases[0].id, status: 'PASSED', comment: big });
check('...while the large bulk upload above was accepted', bulk.status === 201);
const capRun = await newRun('Caps');
const one = { testCaseId: cases[15].id, status: 'FAILED' };
await expectStatus('a comment of 10,000 characters is accepted', 201, ci, 'POST', `${P}/runs/${capRun.id}/results`, { ...one, comment: 'c'.repeat(10_000) });
await expectStatus('a longer comment is rejected', 400, ci, 'POST', `${P}/runs/${capRun.id}/results`, { ...one, comment: 'c'.repeat(10_001) });
const steps = (n) => Array.from({ length: n }, (_, i) => ({ stepPosition: i, status: 'PASSED' }));
await expectStatus('200 step results are accepted', 201, ci, 'POST', `${P}/runs/${capRun.id}/results`, { ...one, stepResults: steps(200) });
await expectStatus('201 step results are rejected', 400, ci, 'POST', `${P}/runs/${capRun.id}/results`, { ...one, stepResults: steps(201) });
await expectStatus('a step comment over 2,000 characters is rejected', 400, ci, 'POST', `${P}/runs/${capRun.id}/results`, { ...one, stepResults: [{ stepPosition: 0, status: 'FAILED', comment: 'c'.repeat(2_001) }] });
await expectStatus('the caps apply inside a bulk upload', 400, ci, 'POST', `${P}/runs/${capRun.id}/results/bulk`, { results: [{ ...one, stepResults: steps(201) }] });
const capped = await ok(ci, 'POST', `${P}/runs/${capRun.id}/results`, one);
await expectStatus('a corrected comment over the cap is rejected', 400, ci, 'PATCH', `${P}/runs/${capRun.id}/results/${capped.id}`, { comment: 'c'.repeat(10_001) });

// ---------- parallel plan item adds
console.log('--- Parallel plan item adds ---');
const plan = await ok(ci, 'POST', `${P}/plans`, { title: 'Parallel plan' });
const adds = await Promise.all(cases.slice(0, 8).map((c) => call(ci, 'POST', `${P}/plans/${plan.id}/cases`, { testCaseIds: [c.id] })));
check('parallel adds all succeed', adds.every((r) => r.status === 201), JSON.stringify(adds.map((r) => r.status)));
const planItems = (await ok(ci, 'GET', `${P}/plans/${plan.id}`)).items;
check('...and get distinct positions', planItems.length === 8 && new Set(planItems.map((i) => i.position)).size === 8, JSON.stringify(planItems.map((i) => i.position)));
const parallelNew = await newRun('Parallel new cases');
const adders = await Promise.all(cases.slice(40, 48).map((c) => call(ci, 'POST', `${P}/runs/${parallelNew.id}/results`, { testCaseId: c.id, status: 'PASSED' })));
check('parallel results adding new cases to a run all succeed', adders.every((r) => r.status === 201), JSON.stringify(adders.map((r) => r.status)));
const runItems = (await ok(ci, 'GET', `${P}/runs/${parallelNew.id}`)).runCases;
check('...and the added cases get distinct positions', runItems.length === 8 && new Set(runItems.map((i) => i.position)).size === 8, JSON.stringify(runItems.map((i) => i.position)));

// ---------- manual execution: step results, invalid, time spent, attempts
console.log('--- Manual execution ---');
const manual = await newRun('Manual execution', { source: 'MANUAL', testCaseIds: [cases[48].id, cases[49].id] });
const stepped = await ok(ci, 'POST', `${P}/runs/${manual.id}/results`, {
  testCaseId: cases[48].id,
  status: 'FAILED',
  source: 'MANUAL',
  durationMs: 4000,
  stepResults: [
    { stepPosition: 1, status: 'FAILED', comment: 'The total shows 0.00' },
    { stepPosition: 0, status: 'PASSED' },
  ],
});
check('a manual result keeps its step results', stepped.stepResults?.length === 2, JSON.stringify(stepped.stepResults));
const listed = (await runResults(manual.id)).find((r) => r.id === stepped.id);
check(
  'the project results list includes step results in step order',
  listed?.stepResults?.map((s) => s.stepPosition).join(',') === '0,1' && listed.stepResults[1].comment === 'The total shows 0.00',
  JSON.stringify(listed?.stepResults),
);
// A step's own files, as the run case panel uploads them after saving the result.
const stepForm = new FormData();
stepForm.append('files', new Blob(['total: 0.00\n'], { type: 'text/plain' }), 'step-2.log');
const failedStep = stepped.stepResults.find((s) => s.stepPosition === 1);
const stepUpload = await fetch(`${BASE}${P}/step-results/${failedStep.id}/attachments`, {
  method: 'POST',
  headers: { authorization: `Bearer ${ci}` },
  body: stepForm,
});
const stepFiles = await stepUpload.json();
check(`[${stepUpload.status}] a step result takes files`, stepUpload.status === 201 && stepFiles.length === 1, JSON.stringify(stepFiles));
check('the upload answer hides the storage path', stepFiles.every((f) => !('storageKey' in f)), JSON.stringify(stepFiles));
const withFiles = (await runResults(manual.id)).find((r) => r.id === stepped.id);
check(
  'the results list includes the files of the result and of each step',
  Array.isArray(withFiles?.attachments) && withFiles.stepResults[1].attachments?.map((f) => f.fileName).join() === 'step-2.log'
    && withFiles.stepResults[0].attachments?.length === 0,
  JSON.stringify(withFiles?.stepResults),
);
check('...without storage paths', !JSON.stringify(withFiles).includes('storageKey'));
const single = await ok(ci, 'GET', `${P}/runs/${manual.id}/results/${stepped.id}`);
check(
  'a single result includes its step files, without storage paths',
  single.stepResults.find((s) => s.stepPosition === 1)?.attachments?.length === 1 && !JSON.stringify(single).includes('storageKey'),
  JSON.stringify(single.stepResults),
);
const invalid = await call(ci, 'POST', `${P}/runs/${manual.id}/results`, { testCaseId: cases[48].id, status: 'INVALID', source: 'MANUAL', durationMs: 1500 });
check(`[${invalid.status}] Invalid is a result status`, invalid.status === 201 && invalid.json.status === 'INVALID', JSON.stringify(invalid.json));
check('an Invalid result sets the case status', (await caseStatus(manual.id, cases[48].id)) === 'INVALID');
const manualRun = await ok(ci, 'GET', `${P}/runs/${manual.id}`);
const steppedCase = manualRun.runCases.find((rc) => rc.testCaseId === cases[48].id);
const untouched = manualRun.runCases.find((rc) => rc.testCaseId === cases[49].id);
check('a run case counts its attempts', steppedCase?.attemptCount === 2 && untouched?.attemptCount === 0, JSON.stringify({ steppedCase, untouched }));
check('a run case sums the time of its attempts', steppedCase?.durationMs === 5500 && untouched?.durationMs === null, `${steppedCase?.durationMs} ${untouched?.durationMs}`);
check('the run sums the time of its cases', manualRun.durationMs === 5500, `${manualRun.durationMs}`);
check('the run progress counts Invalid', manualRun.progress.INVALID === 1, JSON.stringify(manualRun.progress));
const invalidFilter = await call(ci, 'GET', `${P}/results?runId=${manual.id}&status=INVALID`);
check('results filter by Invalid', invalidFilter.status === 200 && total(invalidFilter) === 1, `${invalidFilter.status} ${total(invalidFilter)}`);

// Correcting the latest result from the run case panel: the form sends null for an emptied field.
await ok(ci, 'PATCH', `${P}/runs/${manual.id}/results/${invalid.json.id}`, { comment: 'Wrong test data' });
const cleared = await call(ci, 'PATCH', `${P}/runs/${manual.id}/results/${invalid.json.id}`, { status: 'BLOCKED', comment: null, durationMs: null });
check(
  `[${cleared.status}] null clears a result's comment and time`,
  cleared.status === 200 && cleared.json.status === 'BLOCKED' && cleared.json.comment === null && cleared.json.durationMs === null,
  JSON.stringify(cleared.json),
);
check("...and the latest attempt's new status sets the case status", (await caseStatus(manual.id, cases[48].id)) === 'BLOCKED');

// Run again: the case waits for another attempt, its history stays, the next result replaces Retest.
const manualCase = (await ok(ci, 'GET', `${P}/runs/${manual.id}`)).runCases;
const withResult = manualCase.find((rc) => rc.testCaseId === cases[48].id);
const noResult = manualCase.find((rc) => rc.testCaseId === cases[49].id);
const retest = await call(ci, 'POST', `${P}/runs/${manual.id}/cases/${withResult.id}/retest`);
check(`[${retest.status}] Run again sets the case to Retest`, retest.status === 200 && retest.json.status === 'RETEST', JSON.stringify(retest.json));
const again2 = await call(ci, 'POST', `${P}/runs/${manual.id}/cases/${withResult.id}/retest`);
check(`[${again2.status}] Run again twice is harmless`, again2.status === 200 && again2.json.status === 'RETEST');
await expectStatus('a case without a result has nothing to run again', 400, ci, 'POST', `${P}/runs/${manual.id}/cases/${noResult.id}/retest`);
await expectStatus('Run again on a case of another run is not found', 404, ci, 'POST', `${P}/runs/${nightly.id}/cases/${withResult.id}/retest`);
const afterRetest = await ok(ci, 'GET', `${P}/runs/${manual.id}`);
check('the run counts Retest and keeps the attempts', afterRetest.progress.RETEST === 1 && afterRetest.runCases.find((rc) => rc.id === withResult.id).attemptCount === 2, JSON.stringify(afterRetest.progress));
await ok(ci, 'POST', `${P}/runs/${manual.id}/results`, { testCaseId: cases[48].id, status: 'PASSED', source: 'MANUAL' });
check('the next result replaces Retest', (await caseStatus(manual.id, cases[48].id)) === 'PASSED');

// Team stats: each case once, for the author of its latest result or, while it waits, its assignee;
// time adds up every attempt of the person.
const team = await ok(ci, 'GET', `${P}/runs/${manual.id}/team-stats`);
const person = team.find((r) => r.kind === 'PERSON');
check('team stats: a case counts for whoever recorded its latest result',
  person?.name === 'CI Bot' && person.caseCount === 1 && person.counts.PASSED === 1, JSON.stringify(team));
check("...with every one of that person's attempts and their time", person?.resultCount === 3 && person.durationMs === 4000, JSON.stringify(person));
const waiting = team.find((r) => r.kind === 'UNASSIGNED');
check('...and a case without a result counts as unassigned', waiting?.caseCount === 1 && waiting.counts.UNTESTED === 1 && waiting.resultCount === 0, JSON.stringify(waiting));
const ciTeam = await ok(ci, 'GET', `${P}/runs/${nightly.id}/team-stats`);
check('automated results count for Automation, not for the token owner',
  ciTeam.length === 1 && ciTeam[0].kind === 'AUTOMATION' && ciTeam[0].caseCount === cases.length && ciTeam[0].resultCount === 500, JSON.stringify(ciTeam.map((r) => [r.kind, r.caseCount, r.resultCount])));
await expectStatus('team stats of a run of another project are not found', 404, ci, 'GET', `${other}/runs/${manual.id}/team-stats`);

// Bulk actions on the run page: one request for several cases, all or none.
const bulkRun = await newRun('Bulk actions', { source: 'MANUAL', testCaseIds: cases.slice(30, 34).map((c) => c.id) });
const bulkCases = (await ok(ci, 'GET', `${P}/runs/${bulkRun.id}`)).runCases;
const bulkIds = bulkCases.map((rc) => rc.id);
const me = (await ok(ci, 'GET', '/auth/me')).id;
const assigned = await call(ci, 'PATCH', `${P}/runs/${bulkRun.id}/cases`, { runCaseIds: bulkIds.slice(0, 3), assigneeId: me });
const afterAssign = (await ok(ci, 'GET', `${P}/runs/${bulkRun.id}`)).runCases;
check(`[${assigned.status}] several cases are assigned at once`,
  assigned.status === 200 && assigned.json.count === 3 && afterAssign.filter((rc) => rc.assigneeId === me).length === 3, JSON.stringify(assigned.json));
await expectStatus('a case of another run makes the whole assignment fail', 404, ci, 'PATCH', `${P}/runs/${bulkRun.id}/cases`, { runCaseIds: [bulkIds[3], withResult.id], assigneeId: me });
check('...and changes nothing', (await ok(ci, 'GET', `${P}/runs/${bulkRun.id}`)).runCases.find((rc) => rc.id === bulkIds[3]).assigneeId === null);
await ok(ci, 'PATCH', `${P}/runs/${bulkRun.id}/cases`, { runCaseIds: bulkIds, assigneeId: null });
check('null unassigns them all', (await ok(ci, 'GET', `${P}/runs/${bulkRun.id}`)).runCases.every((rc) => rc.assigneeId === null));
await expectStatus('an empty list is rejected', 400, ci, 'PATCH', `${P}/runs/${bulkRun.id}/cases`, { runCaseIds: [], assigneeId: null });
await ok(ci, 'POST', `${P}/runs/${bulkRun.id}/results/bulk`, {
  results: cases.slice(30, 33).map((c) => ({ testCaseId: c.id, status: 'FAILED', source: 'MANUAL' })),
});
await expectStatus('Run again on a case without a result makes the whole request fail', 400, ci, 'POST', `${P}/runs/${bulkRun.id}/cases/retest`, { runCaseIds: bulkIds });
check('...and changes nothing', ((await ok(ci, 'GET', `${P}/runs/${bulkRun.id}`)).progress.RETEST ?? 0) === 0);
const retested = await call(ci, 'POST', `${P}/runs/${bulkRun.id}/cases/retest`, { runCaseIds: bulkIds.slice(0, 3) });
const afterRetest2 = await ok(ci, 'GET', `${P}/runs/${bulkRun.id}`);
check(`[${retested.status}] several cases are set to retest at once`,
  retested.status === 200 && afterRetest2.progress.RETEST === 3 && afterRetest2.runCases.filter((rc) => rc.attemptCount === 1).length === 3, JSON.stringify(afterRetest2.progress));
await ok(session, 'POST', `${P}/runs/${bulkRun.id}/complete`);
await expectStatus('Run again on several cases of a completed run is refused', 403, ci, 'POST', `${P}/runs/${bulkRun.id}/cases/retest`, { runCaseIds: bulkIds.slice(0, 1) });
await ok(session, 'POST', `${P}/runs/${manual.id}/complete`);
await expectStatus('Run again on a completed run is refused', 403, ci, 'POST', `${P}/runs/${manual.id}/cases/${withResult.id}/retest`);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
