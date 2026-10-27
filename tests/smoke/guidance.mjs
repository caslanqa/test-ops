// AI guidance smoke test: the tables and rules under the guidance feature, then (from task 2 on) its API. Runs
// against a running stack and creates its own data:
//   docker compose up -d --wait && docker compose exec -T app node prisma/seed.js
//   node tests/smoke/guidance.mjs
// Requires SELF_REGISTRATION=true (the default). The target can be changed with BASE, ADMIN_EMAIL and
// ADMIN_PASSWORD; database facts are read with `docker compose exec postgres psql`.
//
// The rule (docs/superpowers/specs/2026-10-27-ai-guidance-design.md): a guidance belongs to exactly one
// workspace or project; a toggle names exactly one target; every version keeps its steps; the token budget is
// 0 to 200000.
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE ?? 'http://localhost:8080/api/v1';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@testops.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';
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
const psql = (sql) =>
  execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'testops', '-d', 'testops', '-At', '-c', sql], {
    encoding: 'utf8',
    // The error text is read from the thrown error when a statement is meant to fail; it isn't echoed.
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

/** The error text of a statement the database refused, or null when it was accepted. */
function refusal(sql) {
  try {
    psql(sql);
    return null;
  } catch (error) {
    return String(error.stderr ?? error.message);
  }
}
/** The statement must be refused, and by the named constraint: "relation does not exist" is not a refusal. */
function checkRefused(label, sql, constraint) {
  const message = refusal(sql);
  check(label, message !== null && message.includes(constraint), message === null ? 'the statement was accepted' : message.trim());
}
function checkAccepted(label, sql) {
  const message = refusal(sql);
  check(label, message === null, message?.trim());
}
const count = (table, where) => Number(psql(`SELECT count(*) FROM ${table} WHERE ${where}`));
const q = (value) => (value === null ? 'NULL' : `'${value}'`);
const STEPS = (...names) => `ARRAY[${names.map((n) => `'${n}'`).join(',')}]::"AiGuidanceStep"[]`;
let nextId = 0;
const uid = (label) => `smoke-${sfx}-${label}-${nextId++}`;

const guidanceSql = ({ id, workspaceId = null, projectId = null, steps = STEPS('DESIGN'), kind = 'TEAM_RULE' }) =>
  `INSERT INTO ai_guidance (id, "workspaceId", "projectId", title, body, kind, steps, "sourceKind", "createdById", "updatedById", "updatedAt")
   VALUES (${q(id)}, ${q(workspaceId)}, ${q(projectId)}, 't', 'b', '${kind}', ${steps}, 'WRITTEN', 'smoke', 'smoke', now())`;
const versionSql = ({ guidanceId, version, steps = STEPS('DESIGN') }) =>
  `INSERT INTO ai_guidance_versions (id, "guidanceId", version, title, body, kind, steps, priority, "editedById")
   VALUES (${q(uid('v'))}, ${q(guidanceId)}, ${version}, 't', 'b', 'TEAM_RULE', ${steps}, 500, 'smoke')`;
const toggleSql = ({ workspaceId = null, projectId = null, guidanceId = null, builtinKey = null }) =>
  `INSERT INTO ai_guidance_toggles (id, "workspaceId", "projectId", "guidanceId", "builtinKey", enabled, "updatedAt")
   VALUES (${q(uid('t'))}, ${q(workspaceId)}, ${q(projectId)}, ${q(guidanceId)}, ${q(builtinKey)}, false, now())`;

const admin = (await ok(null, 'POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).accessToken;

console.log('--- Setup ---');
const ws = await ok(admin, 'POST', '/workspaces', { name: 'Guidance test', slug: `gd-${sfx}` });
const project = await ok(admin, 'POST', `/workspaces/${ws.id}/projects`, { key: 'GD', name: 'Guidance project' });
const ws2 = await ok(admin, 'POST', '/workspaces', { name: 'Guidance test 2', slug: `gd2-${sfx}` });
const project2 = await ok(admin, 'POST', `/workspaces/${ws.id}/projects`, { key: 'GD2', name: 'Guidance project 2' });
const adminId = psql(`SELECT id FROM users WHERE email = '${ADMIN_EMAIL}'`);

console.log('--- Tables: a guidance belongs to exactly one owner ---');
const g = { workspace: uid('gw'), project: uid('gp') };
checkRefused('a guidance with both owners is refused', guidanceSql({ id: uid('both'), workspaceId: ws.id, projectId: project.id }), 'ai_guidance_one_owner');
checkRefused('a guidance with no owner is refused', guidanceSql({ id: uid('none') }), 'ai_guidance_one_owner');
checkRefused('a guidance without steps is refused', guidanceSql({ id: uid('nosteps'), workspaceId: ws.id, steps: 'ARRAY[]::"AiGuidanceStep"[]' }), 'ai_guidance_steps_not_empty');
checkRefused('a guidance with an unknown kind is refused', guidanceSql({ id: uid('kind'), workspaceId: ws.id, kind: 'OTHER' }), 'invalid input value for enum "AiGuidanceKind"');
checkRefused('a guidance with an unknown step is refused', guidanceSql({ id: uid('step'), workspaceId: ws.id, steps: `ARRAY['LATER']::"AiGuidanceStep"[]` }), 'invalid input value for enum "AiGuidanceStep"');
checkAccepted('a workspace guidance is accepted', guidanceSql({ id: g.workspace, workspaceId: ws.id }));
checkAccepted('a project guidance is accepted', guidanceSql({ id: g.project, projectId: project.id, steps: STEPS('REVIEW', 'CODEGEN') }));
check(
  'a new guidance is on, at priority 500 and version 1',
  psql(`SELECT enabled || ',' || priority || ',' || version FROM ai_guidance WHERE id = ${q(g.workspace)}`) === 'true,500,1',
);
check('a new guidance keeps its steps', psql(`SELECT array_to_string(steps, ',') FROM ai_guidance WHERE id = ${q(g.project)}`) === 'REVIEW,CODEGEN');

console.log('--- Tables: versions ---');
checkAccepted('a first version is accepted', versionSql({ guidanceId: g.workspace, version: 1 }));
checkRefused('the same version twice is refused', versionSql({ guidanceId: g.workspace, version: 1 }), 'ai_guidance_versions_guidanceId_version_key');
checkAccepted('the next version is accepted', versionSql({ guidanceId: g.workspace, version: 2 }));
checkRefused('a version without steps is refused', versionSql({ guidanceId: g.workspace, version: 3, steps: 'ARRAY[]::"AiGuidanceStep"[]' }), 'ai_guidance_versions_steps_not_empty');
checkRefused('a version of no guidance is refused', versionSql({ guidanceId: uid('ghost'), version: 1 }), 'ai_guidance_versions_guidanceId_fkey');

console.log('--- Tables: toggles name one owner and one target ---');
checkRefused('a toggle with both owners is refused', toggleSql({ workspaceId: ws.id, projectId: project.id, builtinKey: 'x' }), 'ai_guidance_toggles_one_owner');
checkRefused('a toggle with no owner is refused', toggleSql({ builtinKey: 'x' }), 'ai_guidance_toggles_one_owner');
checkRefused('a toggle with both targets is refused', toggleSql({ projectId: project.id, guidanceId: g.workspace, builtinKey: 'x' }), 'ai_guidance_toggles_one_target');
checkRefused('a toggle with no target is refused', toggleSql({ projectId: project.id }), 'ai_guidance_toggles_one_target');
checkAccepted('a project toggle of a built-in is accepted', toggleSql({ projectId: project.id, builtinKey: 'playwright-e2e' }));
checkRefused('the same toggle twice is refused', toggleSql({ projectId: project.id, builtinKey: 'playwright-e2e' }), 'ai_guidance_toggles_target');
checkAccepted('the same built-in under another owner is accepted', toggleSql({ workspaceId: ws.id, builtinKey: 'playwright-e2e' }));
checkAccepted('a project toggle of a workspace guidance is accepted', toggleSql({ projectId: project.id, guidanceId: g.workspace }));
checkRefused('that toggle twice is refused', toggleSql({ projectId: project.id, guidanceId: g.workspace }), 'ai_guidance_toggles_target');
checkAccepted('the same guidance toggled for another project is accepted', toggleSql({ projectId: project2.id, guidanceId: g.workspace }));
checkRefused('a toggle of no guidance is refused', toggleSql({ projectId: project.id, guidanceId: uid('ghost') }), 'ai_guidance_toggles_guidanceId_fkey');

console.log('--- Tables: the token budget ---');
psql(
  `INSERT INTO ai_settings (id, "workspaceId", provider, model, "updatedAt") VALUES (${q(uid('s'))}, ${q(ws2.id)}, 'OPENAI_COMPATIBLE', 'm', now())`,
);
const budget = (value) => `UPDATE ai_settings SET "guidanceBudgetTokens" = ${value} WHERE "workspaceId" = ${q(ws2.id)}`;
check('the budget of a new setting is 6000', psql(`SELECT "guidanceBudgetTokens" FROM ai_settings WHERE "workspaceId" = ${q(ws2.id)}`) === '6000');
checkAccepted('a budget of 0 (no limit) is accepted', budget(0));
checkAccepted('a budget of 200000 is accepted', budget(200000));
checkRefused('a budget of -1 is refused', budget(-1), 'ai_settings_guidance_budget_range');
checkRefused('a budget of 200001 is refused', budget(200001), 'ai_settings_guidance_budget_range');

console.log('--- Tables: what a run keeps ---');
const runId = uid('run');
checkAccepted(
  'a run keeps its guidance snapshot',
  `INSERT INTO ai_workflow_runs (id, type, "projectId", "createdById", input, "providerSnapshot", guidance)
   VALUES (${q(runId)}, 'REQUIREMENT_TO_CASES', ${q(project2.id)}, ${q(adminId)}, '{}', '{}', '{"mode":"EFFECTIVE"}')`,
);
check('...and reads it back', psql(`SELECT guidance->>'mode' FROM ai_workflow_runs WHERE id = ${q(runId)}`) === 'EFFECTIVE');
checkAccepted(
  'a step keeps the tokens of its guidance',
  `INSERT INTO ai_workflow_steps (id, "runId", name, "skillVersion", attempt, input, "guidanceTokens")
   VALUES (${q(uid('step'))}, ${q(runId)}, 'REVIEW', 1, 1, '{}', 120)`,
);
check('...and reads them back', psql(`SELECT "guidanceTokens" FROM ai_workflow_steps WHERE "runId" = ${q(runId)}`) === '120');

console.log('--- Tables: deleting an owner deletes what it owned ---');
check('before the deletes the project has a guidance to lose', count('ai_guidance', `"projectId" = ${q(project.id)}`) === 1);
psql(`DELETE FROM projects WHERE id = ${q(project.id)}`);
check('deleting a project deletes its guidance', count('ai_guidance', `id = ${q(g.project)}`) === 0);
check('...and the toggles it held', count('ai_guidance_toggles', `"projectId" = ${q(project.id)}`) === 0);
check('...but not the workspace guidance it had switched off', count('ai_guidance', `id = ${q(g.workspace)}`) === 1);
psql(`DELETE FROM projects WHERE id = ${q(project2.id)}`);
check('deleting a project deletes the runs and steps it kept', count('ai_workflow_runs', `id = ${q(runId)}`) === 0);
check('...and the toggle that switched a workspace guidance off for it', count('ai_guidance_toggles', `"projectId" = ${q(project2.id)}`) === 0);
psql(`DELETE FROM workspaces WHERE id = ${q(ws.id)}`);
check('deleting a workspace deletes its guidance', count('ai_guidance', `"workspaceId" = ${q(ws.id)}`) === 0);
check('...its versions', count('ai_guidance_versions', `"guidanceId" = ${q(g.workspace)}`) === 0);
check('...and its toggles', count('ai_guidance_toggles', `"workspaceId" = ${q(ws.id)}`) === 0);
psql(`DELETE FROM workspaces WHERE id = ${q(ws2.id)}`);
check('deleting a workspace deletes its AI setting with the budget', count('ai_settings', `"workspaceId" = ${q(ws2.id)}`) === 0);

// ---------------------------------------------------------------------------------------------------------------
// The API. Its own workspace A (with two projects), a project in a second workspace B, and one account per role.
// ---------------------------------------------------------------------------------------------------------------
const PASSWORD = 'GuidanceSmoke123';
const ghost = '00000000-0000-4000-8000-000000000000';
async function expectStatus(label, expected, token, method, path, body) {
  const r = await call(token, method, path, body);
  check(`[${r.status}] ${label}`, r.status === expected, `(expected ${expected}) ${r.text}`);
  return r;
}

console.log('--- API: setup ---');
const wsA = await ok(admin, 'POST', '/workspaces', { name: 'Guidance API', slug: `gda-${sfx}` });
const projA = await ok(admin, 'POST', `/workspaces/${wsA.id}/projects`, { key: 'GA', name: 'Guidance API project' });
const projA2 = await ok(admin, 'POST', `/workspaces/${wsA.id}/projects`, { key: 'GB', name: 'Guidance API project 2' });
const projLim = await ok(admin, 'POST', `/workspaces/${wsA.id}/projects`, { key: 'GL', name: 'Limit project' });
const wsB = await ok(admin, 'POST', '/workspaces', { name: 'Guidance API other', slug: `gdb-${sfx}` });
const projB = await ok(admin, 'POST', `/workspaces/${wsB.id}/projects`, { key: 'GC', name: 'Other project' });

/** An account that joined workspace A by invitation, with `projectRole` in project A (the role comes from the permissions API). */
async function makeUser(label, projectRole) {
  const email = `${label}-${sfx}@gd.test`;
  const invitation = await ok(admin, 'POST', `/workspaces/${wsA.id}/invitations`, { email, role: 'MEMBER' });
  const session = await ok(null, 'POST', '/auth/register', { email, displayName: label, password: PASSWORD, inviteToken: invitation.token });
  await ok(admin, 'PUT', `/workspaces/${wsA.id}/permissions/projects/${projA.id}/users/${session.user.id}`, { role: projectRole });
  return { label, id: session.user.id, token: session.accessToken };
}
const pa = await makeUser('pa', 'ADMIN');
const tester = await makeUser('tester', 'TESTER');
const automation = await makeUser('automation', 'AUTOMATION');
const viewer = await makeUser('viewer', 'VIEWER');
const outsider = {
  label: 'outsider',
  token: (await ok(null, 'POST', '/auth/register', { email: `outsider-${sfx}@gd.test`, displayName: 'outsider', password: PASSWORD })).accessToken,
};
const apiToken = (await ok(admin, 'POST', '/api-tokens', { name: 'guidance smoke' })).token;

const WG = `/workspaces/${wsA.id}/ai/guidance`;
const PG = `/projects/${projA.id}/ai/guidance`;
const PG2 = `/projects/${projA2.id}/ai/guidance`;
const PGL = `/projects/${projLim.id}/ai/guidance`;
const WGB = `/workspaces/${wsB.id}/ai/guidance`;
const PGB = `/projects/${projB.id}/ai/guidance`;
const MARK = `marker-${sfx}`;
const rule = (over = {}) => ({
  title: 'Name cases by behaviour',
  body: `Name every case after the behaviour it checks. ${MARK}`,
  kind: 'TEAM_RULE',
  steps: ['DESIGN'],
  ...over,
});
const tokens = (text) => Math.ceil(text.length / 4) + 30;

console.log('--- API: who may manage guidance ---');
const routesOf = (base) => [
  ['GET', base],
  ['POST', base, rule()],
  ['PATCH', `${base}/${ghost}`, { enabled: false }],
  ['DELETE', `${base}/${ghost}`],
  ['GET', `${base}/${ghost}/versions`],
  ['PUT', `${base}/toggles`, { builtinKey: 'playwright-e2e', enabled: true }],
];
for (const who of [tester, automation, viewer, outsider, { label: 'an API token', token: apiToken }]) {
  for (const base of [WG, PG]) {
    for (const [method, path, body] of routesOf(base)) {
      await expectStatus(`${who.label}: ${method} ${path.replace(ghost, ':id')}`, 403, who.token, method, path, body);
    }
  }
}
for (const [method, path, body] of routesOf(WG)) {
  await expectStatus(`a project admin: ${method} ${path.replace(ghost, ':id')} (workspace route)`, 403, pa.token, method, path, body);
}
await expectStatus('a project admin lists the guidance of their project', 200, pa.token, 'GET', PG);
await expectStatus('a project admin cannot list that of another project of the workspace they do not administer', 403, pa.token, 'GET', PG2);
await expectStatus('a workspace admin lists the guidance of any project of the workspace', 200, admin, 'GET', PG2);
await expectStatus('a workspace admin lists the workspace guidance', 200, admin, 'GET', WG);

console.log('--- API: writing guidance ---');
const made = await expectStatus('a workspace admin writes a workspace guidance', 201, admin, 'POST', WG, rule());
const gw = made.json;
check('...it is a workspace guidance, on, at priority 500, version 1', gw?.scope === 'WORKSPACE' && gw.enabled === true && gw.priority === 500 && gw.version === 1, made.text);
check('...written, not uploaded, with the tokens it will cost', gw?.sourceKind === 'WRITTEN' && gw.estimatedTokens === tokens(rule().body), made.text);
check('...with one version row', count('ai_guidance_versions', `"guidanceId" = ${q(gw.id)}`) === 1);
const madeP = await expectStatus('a project admin writes a project guidance', 201, pa.token, 'POST', PG, rule({ title: 'Project rule', steps: ['REVIEW', 'AUDIT'], priority: 700, sourceName: 'team.md', license: 'MIT', sourceKind: 'UPLOADED' }));
const gp = madeP.json;
check('...it is a project guidance with the fields given', gp?.scope === 'PROJECT' && gp.priority === 700 && gp.sourceKind === 'UPLOADED' && gp.sourceName === 'team.md' && gp.license === 'MIT', madeP.text);
check('...and keeps its steps', JSON.stringify(gp?.steps) === JSON.stringify(['REVIEW', 'AUDIT']), madeP.text);
await expectStatus('a workspace admin writes in a project', 201, admin, 'POST', PG2, rule({ title: 'Other project rule' }));

console.log('--- API: what is refused ---');
for (const [label, body] of [
  ['a title of 201 characters', rule({ title: 'x'.repeat(201) })],
  ['an empty title', rule({ title: '  ' })],
  ['a body of 20001 characters', rule({ body: 'x'.repeat(20001) })],
  ['an empty body', rule({ body: '' })],
  ['no steps', rule({ steps: [] })],
  ['an unknown step', rule({ steps: ['LATER'] })],
  ['a step twice', rule({ steps: ['DESIGN', 'DESIGN'] })],
  ['an unknown kind', rule({ kind: 'OTHER' })],
  ['a priority of 1001', rule({ priority: 1001 })],
  ['a priority of -1', rule({ priority: -1 })],
  ['a source address that is not http or https', rule({ sourceUrl: 'ftp://x' })],
  ['a summary of 501 characters', rule({ summary: 'x'.repeat(501) })],
  ['a field that does not exist', rule({ owner: 'someone' })],
]) {
  await expectStatus(`${label} is refused`, 400, admin, 'POST', WG, body);
}
const edge = await expectStatus('a title of 200 and a body of 20000 characters are accepted', 201, admin, 'POST', WG, rule({ title: 'x'.repeat(200), body: 'y'.repeat(20000), steps: ['REVIEW', 'DESIGN', 'AUDIT', 'CODEGEN'], priority: 1000 }));
await expectStatus('...and can be deleted again', 204, admin, 'DELETE', `${WG}/${edge.json?.id}`);

console.log('--- API: changing guidance and its versions ---');
const oldBody = rule().body;
const edited = await expectStatus('a body change is accepted', 200, admin, 'PATCH', `${WG}/${gw.id}`, { body: `A shorter rule. ${MARK}` });
check('...it makes version 2', edited.json?.version === 2, edited.text);
const history = await expectStatus('the history is readable', 200, admin, 'GET', `${WG}/${gw.id}/versions`);
check('...it holds both versions, newest first', Array.isArray(history.json) && history.json.map((v) => v.version).join() === '2,1', history.text);
check('...version 1 is the text as it was', history.json?.find((v) => v.version === 1)?.body === oldBody, history.text);
const onlyOff = await expectStatus('switching it off is accepted', 200, admin, 'PATCH', `${WG}/${gw.id}`, { enabled: false });
check('...it stays at version 2 and is off', onlyOff.json?.version === 2 && onlyOff.json.enabled === false, onlyOff.text);
await expectStatus('...and on again', 200, admin, 'PATCH', `${WG}/${gw.id}`, { enabled: true });
const attribution = await expectStatus('changing only the attribution is accepted', 200, admin, 'PATCH', `${WG}/${gw.id}`, { sourceName: 'rules.md', license: 'CC0' });
check('...it stays at version 2', attribution.json?.version === 2 && attribution.json.license === 'CC0', attribution.text);
const nothing = await expectStatus('an empty change is accepted', 200, admin, 'PATCH', `${WG}/${gw.id}`, {});
check('...it changes nothing', nothing.json?.version === 2, nothing.text);
const sameSteps = await expectStatus('the same steps in another order are accepted', 200, admin, 'PATCH', `${WG}/${gw.id}`, { steps: ['DESIGN'] });
check('...it stays at version 2', sameSteps.json?.version === 2, sameSteps.text);
const retitled = await expectStatus('a new title and steps are accepted', 200, admin, 'PATCH', `${WG}/${gw.id}`, { title: 'Name cases', steps: ['AUDIT', 'REVIEW'], priority: 900 });
check('...it makes version 3 with the steps in their usual order', retitled.json?.version === 3 && JSON.stringify(retitled.json.steps) === JSON.stringify(['REVIEW', 'AUDIT']), retitled.text);
check('...the tokens follow the body', retitled.json?.estimatedTokens === tokens(`A shorter rule. ${MARK}`), retitled.text);
await expectStatus('an invalid change is refused', 400, admin, 'PATCH', `${WG}/${gw.id}`, { steps: [] });
const keptV3 = await call(admin, 'GET', `${WG}/${gw.id}/versions`);
check('...and writes no version', keptV3.json?.length === 3, keptV3.text);
const refusedList = await call(admin, 'GET', WG);
check('the workspace list holds the guidance with its latest version', refusedList.json?.own?.find((g) => g.id === gw.id)?.version === 3, refusedList.text);

console.log('--- API: no more than 100 per owner ---');
const limitSql = (from, to) =>
  `INSERT INTO ai_guidance (id, "projectId", title, body, kind, steps, "sourceKind", "createdById", "updatedById", "updatedAt")
   SELECT 'lim-${sfx}-' || i, ${q(projLim.id)}, 't', 'b', 'TEAM_RULE', ARRAY['DESIGN']::"AiGuidanceStep"[], 'WRITTEN', 'smoke', 'smoke', now() FROM generate_series(${from}, ${to}) i`;
psql(limitSql(1, 99));
await expectStatus('the 100th guidance of a project is accepted', 201, admin, 'POST', PGL, rule());
await expectStatus('the 101st is refused', 409, admin, 'POST', PGL, rule());
await expectStatus('a project with fewer is not affected', 201, admin, 'POST', PG2, rule({ title: 'Another' }));

console.log('--- API: the workspace guidance a project inherits ---');
const view = await expectStatus('a project admin lists the project', 200, pa.token, 'GET', PG);
check('...its own guidance is there', view.json?.own?.some((g) => g.id === gp.id), view.text);
const inheritedRow = view.json?.inherited?.find((g) => g.id === gw.id);
check('...the workspace guidance is inherited and applies here', inheritedRow?.enabledHere === true && inheritedRow.scope === 'WORKSPACE', view.text);
check('...the built-in packs are not there yet', Array.isArray(view.json?.builtin) && view.json.builtin.length === 0, view.text);
const off = await expectStatus('a project admin switches an inherited guidance off for the project', 200, pa.token, 'PUT', `${PG}/toggles`, { guidanceId: gw.id, enabled: false });
check('...the answer says it is off', off.json?.enabled === false, off.text);
const after = await call(pa.token, 'GET', PG);
check('...the project shows it as not applying here', after.json?.inherited?.find((g) => g.id === gw.id)?.enabledHere === false, after.text);
const other = await call(admin, 'GET', PG2);
check('...another project of the workspace still has it', other.json?.inherited?.find((g) => g.id === gw.id)?.enabledHere === true, other.text);
const wsList = await call(admin, 'GET', WG);
check('...and the workspace list is unchanged', wsList.json?.own?.find((g) => g.id === gw.id)?.enabled === true, wsList.text);
await expectStatus('...and the switch can be turned on again', 200, pa.token, 'PUT', `${PG}/toggles`, { guidanceId: gw.id, enabled: true });
check('...the project applies it again', (await call(pa.token, 'GET', PG)).json?.inherited?.find((g) => g.id === gw.id)?.enabledHere === true);
check('...with one toggle row for the pair', count('ai_guidance_toggles', `"projectId" = ${q(projA.id)} AND "guidanceId" = ${q(gw.id)}`) === 1);
await call(admin, 'PATCH', `${WG}/${gw.id}`, { enabled: false });
check('a workspace guidance that is off applies nowhere', (await call(pa.token, 'GET', PG)).json?.inherited?.find((g) => g.id === gw.id)?.enabledHere === false);
await call(admin, 'PATCH', `${WG}/${gw.id}`, { enabled: true });

console.log('--- API: ids of another scope ---');
const gwB = (await ok(admin, 'POST', WGB, rule({ title: 'Workspace B rule' }))).id;
const gpB = (await ok(admin, 'POST', PGB, rule({ title: 'Project B rule' }))).id;
for (const [label, token, method, path, body] of [
  ['a toggle of a guidance of another workspace', pa.token, 'PUT', `${PG}/toggles`, { guidanceId: gwB, enabled: false }],
  ['a toggle of a project guidance', pa.token, 'PUT', `${PG}/toggles`, { guidanceId: gp.id, enabled: false }],
  ['a change of another workspace\'s guidance', admin, 'PATCH', `${WG}/${gwB}`, { enabled: false }],
  ['a delete of another workspace\'s guidance', admin, 'DELETE', `${WG}/${gwB}`],
  ['the history of another workspace\'s guidance', admin, 'GET', `${WG}/${gwB}/versions`],
  ['a change of another project\'s guidance', admin, 'PATCH', `${PG}/${gpB}`, { enabled: false }],
  ['a change of a workspace guidance through a project', admin, 'PATCH', `${PG}/${gw.id}`, { enabled: false }],
  ['a delete of a workspace guidance through a project', admin, 'DELETE', `${PG}/${gw.id}`],
  ['a change of a project guidance through the workspace', admin, 'PATCH', `${WG}/${gp.id}`, { enabled: false }],
  ['the history of a project guidance through the workspace', admin, 'GET', `${WG}/${gp.id}/versions`],
  ['a change of a project guidance through another project', admin, 'PATCH', `${PG2}/${gp.id}`, { enabled: false }],
]) {
  await expectStatus(`${label} answers not found`, 404, token, method, path, body);
}
check('...and nothing of workspace B changed', count('ai_guidance', `id = ${q(gwB)} AND enabled`) === 1);
await expectStatus('a toggle without a target is refused', 400, pa.token, 'PUT', `${PG}/toggles`, { enabled: false });
await expectStatus('a toggle with two targets is refused', 400, pa.token, 'PUT', `${PG}/toggles`, { guidanceId: gw.id, builtinKey: 'playwright-e2e', enabled: false });
await expectStatus('a toggle without enabled is refused', 400, pa.token, 'PUT', `${PG}/toggles`, { guidanceId: gw.id });
await expectStatus('a toggle of a guidance on a workspace route is refused', 400, admin, 'PUT', `${WG}/toggles`, { guidanceId: gw.id, enabled: false });
await expectStatus('a built-in key that is not a key is refused', 400, admin, 'PUT', `${WG}/toggles`, { builtinKey: 'not a key!', enabled: true });

console.log('--- API: removing guidance ---');
await ok(pa.token, 'PUT', `${PG}/toggles`, { guidanceId: gw.id, enabled: false });
await expectStatus('a project admin deletes a project guidance', 204, pa.token, 'DELETE', `${PG}/${gp.id}`);
check('...its versions go with it', count('ai_guidance_versions', `"guidanceId" = ${q(gp.id)}`) === 0);
await expectStatus('...and it is gone', 404, pa.token, 'DELETE', `${PG}/${gp.id}`);
await expectStatus('a workspace admin deletes a workspace guidance', 204, admin, 'DELETE', `${WG}/${gw.id}`);
check('...its versions and the toggles that switched it off go with it', count('ai_guidance_versions', `"guidanceId" = ${q(gw.id)}`) === 0 && count('ai_guidance_toggles', `"guidanceId" = ${q(gw.id)}`) === 0);

console.log('--- API: the audit log ---');
const audited = (action) =>
  count('audit_log', `action = '${action}' AND ("workspaceId" = ${q(wsA.id)} OR "projectId" IN (${q(projA.id)}, ${q(projA2.id)}))`);
for (const action of ['ai.guidance.created', 'ai.guidance.updated', 'ai.guidance.deleted', 'ai.guidance.toggled']) {
  check(`${action} is recorded`, audited(action) >= 1);
}
check('...with the title and version, never the text', count('audit_log', `action = 'ai.guidance.updated' AND metadata::text LIKE '%Name cases%'`) >= 1);
check('no guidance audit row holds the text of a guidance', count('audit_log', `action LIKE 'ai.guidance.%' AND metadata::text LIKE '%${MARK}%'`) === 0);

console.log(failures === 0 ? '\nAll guidance checks passed.' : `\n${failures} guidance check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
