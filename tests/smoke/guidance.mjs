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

console.log(failures === 0 ? '\nAll guidance checks passed.' : `\n${failures} guidance check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
