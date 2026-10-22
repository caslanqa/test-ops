// Builds the Bean & Leaf project in your own TestOps account, so you can send the Playwright
// results there (npm test with the TestOps settings). Every TestOps server already shows the same
// project, read-only, in its built-in DEMO workspace; this script makes a copy you can write to.
//
//   TESTOPS_URL=http://localhost:8080/api/v1 TESTOPS_TOKEN=<API token> npm run seed
//
// It creates the workspace "Demo shop" (TESTOPS_WORKSPACE_SLUG, default "demo-shop") and its
// project, suites, cases with steps (automated ones tagged demo-ref:<key> for the demo adapter),
// requirements, a milestone, a plan, a manual run with results and the defects. The data comes from
// the same file the server uses for its DEMO workspace. Re-running is safe: whatever exists is
// found by name and only what is missing is added.
import data from '../../../apps/api/src/demo/demo-shop.json' with { type: 'json' };

const API = process.env.TESTOPS_URL?.trim().replace(/\/+$/, '');
const TOKEN = process.env.TESTOPS_TOKEN?.trim();
const SLUG = process.env.TESTOPS_WORKSPACE_SLUG?.trim() || 'demo-shop';
if (!API || !TOKEN) {
  console.error('Set TESTOPS_URL (e.g. http://localhost:8080/api/v1) and TESTOPS_TOKEN (an API token).');
  process.exit(1);
}

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : undefined;
}

/** The item of `list` whose `field` is `value`, or a new one from `create`. */
async function ensure(kind, list, field, value, create) {
  const found = list.find((item) => item[field] === value);
  if (found) return found;
  const created = await create();
  console.log(`  + ${kind}: ${value}`);
  return created;
}

console.log(`TestOps at ${API}`);
const workspace = await ensure('workspace', await call('GET', '/workspaces'), 'slug', SLUG, () =>
  call('POST', '/workspaces', { name: 'Demo shop', slug: SLUG }));
const project = await ensure('project', await call('GET', `/workspaces/${workspace.id}/projects`), 'key', data.project.key, () =>
  call('POST', `/workspaces/${workspace.id}/projects`, data.project));
const P = `/projects/${project.id}`;

const suites = await call('GET', `${P}/suites`);
const cases = await call('GET', `${P}/cases`);
const caseIds = new Map();
for (const suite of data.suites) {
  const { id: suiteId } = await ensure('suite', suites, 'name', suite.name, () =>
    call('POST', `${P}/suites`, { name: suite.name, description: suite.description }));
  for (const c of suite.cases) {
    const testCase = await ensure('case', cases, 'title', c.title, () =>
      call('POST', `${P}/cases`, {
        suiteId,
        title: c.title,
        preconditions: c.preconditions,
        description: c.description,
        priority: c.priority ?? 'MEDIUM',
        type: c.type ?? 'FUNCTIONAL',
        automationStatus: c.automationStatus ?? 'AUTOMATED',
        tags: c.key ? [`demo-ref:${c.key}`, suite.name.toLowerCase()] : [suite.name.toLowerCase()],
        steps: c.steps,
      }));
    caseIds.set(c.key ?? c.title, testCase.id);
  }
}

const requirements = await call('GET', `${P}/requirements`);
for (const r of data.requirements) {
  if (requirements.some((item) => item.title === r.title)) continue;
  const created = await call('POST', `${P}/requirements`, { title: r.title, externalRef: r.externalRef });
  await call('POST', `${P}/requirements/${created.id}/cases`, { testCaseIds: r.cases.map((ref) => caseIds.get(ref)) });
  console.log(`  + requirement: ${r.title}`);
}

const dueDate = new Date(Date.now() + data.milestone.dueInDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
const milestone = await ensure('milestone', await call('GET', `${P}/milestones`), 'name', data.milestone.name, () =>
  call('POST', `${P}/milestones`, { name: data.milestone.name, dueDate }));
await ensure('plan', await call('GET', `${P}/plans`), 'title', data.plan.title, () =>
  call('POST', `${P}/plans`, { ...data.plan, milestoneId: milestone.id, testCaseIds: [...caseIds.values()] }));

// The manual run, partly done; the automated runs come from npm test.
const manual = data.manualRun;
let manualRun = (await call('GET', `${P}/runs`)).find((r) => r.title === manual.title);
const manualResults = new Map();
if (!manualRun) {
  manualRun = await call('POST', `${P}/runs`, {
    title: manual.title,
    description: manual.description,
    milestoneId: milestone.id,
    environment: manual.environment,
    build: manual.build,
    testCaseIds: manual.cases.map((title) => caseIds.get(title)),
  });
  console.log(`  + run: ${manual.title}`);
  for (const { case: title, ...result } of manual.results) {
    const saved = await call('POST', `${P}/runs/${manualRun.id}/results`, { testCaseId: caseIds.get(title), source: 'MANUAL', ...result });
    manualResults.set(title, saved.id);
  }
}

// Defects; failures of the manual run are linked to them, CI failures by the reporter.
const defects = await call('GET', `${P}/defects`);
for (const d of data.defects) {
  await ensure('defect', defects, 'title', d.title, () =>
    call('POST', `${P}/defects`, {
      title: d.title,
      description: d.description,
      severity: d.severity,
      tags: d.tags,
      resultIds: d.results.filter((link) => link.run === 'manual').map((link) => manualResults.get(link.case)).filter(Boolean),
    }));
}

const web = API.replace(/\/api\/v\d+$/, '');
console.log(`
The Demo shop project is ready: ${web}/projects/${project.id}/cases

  TESTOPS_PROJECT_ID=${project.id}
      Use it with TESTOPS_URL and TESTOPS_TOKEN to send the Playwright results here:
      TESTOPS_URL=${API} TESTOPS_TOKEN=<token> TESTOPS_PROJECT_ID=${project.id} npm test
`);
