// Creates the cases of this framework in an existing TestOps project, for example the Demo Project.
//
//   TESTOPS_URL=http://localhost:8080/api/v1 TESTOPS_TOKEN=<API token> TESTOPS_PROJECT_ID=<id> npm run cases
//
// The token needs the Tester or Admin role in the project. Suites, cases and the defect come from
// cases/cases.json. What exists is left alone, so running it again adds only what is missing: suites and
// the defect are found by name, and a case by its shop-e2e:<key> tag, not by title, because
// testops-sync renames cases to the titles of their tests (and a title repeats on purpose). The project
// must exist; it is never created here.
import { readFile } from 'node:fs/promises';

const API = process.env.TESTOPS_URL?.trim().replace(/\/+$/, '');
const TOKEN = process.env.TESTOPS_TOKEN?.trim();
const PROJECT = process.env.TESTOPS_PROJECT_ID?.trim();
if (!API || !TOKEN || !PROJECT) {
  console.error('Set TESTOPS_URL (e.g. http://localhost:8080/api/v1), TESTOPS_TOKEN (an API token) and TESTOPS_PROJECT_ID.');
  process.exit(1);
}
const data = JSON.parse(await readFile(new URL('../cases/cases.json', import.meta.url), 'utf8'));

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

const P = `/projects/${PROJECT}`;
const suites = await call('GET', `${P}/suites`);
const cases = await call('GET', `${P}/cases`);
const defects = await call('GET', `${P}/defects`);

for (const suite of data.suites) {
  let found = suites.find((s) => s.name === suite.name);
  if (!found) {
    found = await call('POST', `${P}/suites`, { name: suite.name, description: suite.description });
    console.log(`+ suite: ${suite.name}`);
  }
  for (const c of suite.cases) {
    const tag = `shop-e2e:${c.key}`;
    let testCase = cases.find((x) => x.tags?.includes(tag));
    if (!testCase) {
      testCase = await call('POST', `${P}/cases`, {
        suiteId: found.id,
        title: c.title,
        priority: c.priority ?? 'MEDIUM',
        type: c.type ?? 'FUNCTIONAL',
        automationStatus: 'TO_BE_AUTOMATED',
        tags: [tag],
        steps: c.steps,
      });
      console.log(`+ case: ${c.title}`);
    }
    console.log(`${testCase.id}  ${suite.name} / ${c.title}`);
  }
}

for (const d of data.defects) {
  if (defects.some((x) => x.title === d.title)) continue;
  await call('POST', `${P}/defects`, d);
  console.log(`+ defect: ${d.title}`);
}
