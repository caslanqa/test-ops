# Demo shop: tests from the browser to TestOps

The example behind TestOps' built-in **DEMO workspace**. It contains:

- a small web shop, **Bean & Leaf**;
- Playwright tests for the shop;
- the `@testops/reporter` npm package, which sends test results to TestOps.

Every TestOps user gets the shop's project in a DEMO workspace of their own, as its admin. The server makes it from [`apps/api/src/demo/demo-shop.json`](../../apps/api/src/demo/demo-shop.json), so there is nothing to set up (see [Demo workspace](../../README.md#demo-workspace)). The project shows:

- the cases and the requirements they cover;
- a release plan;
- a manual run a tester has partly done;
- an automated run of these tests;
- the defects linked to their failures.

```
 app/ (the shop) ◄── tests/*.spec.ts (Playwright)
                          │  @testops/reporter
                          ▼
             TestOps API: a run, one result per test,
             screenshots of failures, links to known defects
                          │
                          ▼
     Bean & Leaf shop project
     cases (tagged demo-ref:<key> for the per-user fixture) · requirements · plan · runs · defects
```

| Path | What it is |
|---|---|
| `app/` | The shop: products, a cart with discount codes and free shipping from €40, and a card checkout with test cards. It is three static files with no build step. It has one bug on purpose: a discount code can be applied twice. |
| `server.mjs` | Serves the shop on port 4173. It has no dependencies; Playwright starts it. |
| `tests/` | 13 Playwright tests. Each one reports the TestOps case UUID supplied by the demo webhook. |
| `packages/reporter/` | The npm package: a framework-neutral reporting core and its Playwright adapter. |
| `testops/seed.mjs` | Builds the same project in your own account, so you can send results to it. |

## Install in a Playwright project

In your own Playwright project, install the package:

```bash
npm install --save-dev @testops/reporter
```

Add it to `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export default defineConfig({
  reporter: [['list'], ['html', { open: 'never' }], [require.resolve('@testops/reporter')]],
});
```

For a CommonJS config, pass `require.resolve('@testops/reporter')` in the reporter list.

Link a test to a TestOps case with the UUID shown in that case's details. In this per-user demo,
the webhook supplies the fresh UUIDs and `demoTestops` passes them to the package helper; normal
projects can pass their case IDs directly to `testops()`:

```ts
import { test } from '@playwright/test';
import { testops } from '@testops/reporter';

test('checkout works', testops('550e8400-e29b-41d4-a716-446655440000'), async ({ page }) => {
  // ...
});
```

The demo adapter uses `demo-ref:<key>` only to pair each user's generated case UUID from the webhook
payload with the fixture test. The result reporter still submits the TestOps UUID.

The demo in this repository installs the same package from `packages/reporter/`; published
projects use the npm registry package shown above.

## Run the tests

```bash
cd examples/demo-shop
npm ci
npx playwright install chromium
npm test
```

Without TestOps settings the reporter does nothing, and the results stay in the terminal and in `playwright-report/`.

The test "a discount code applies only once" fails because of the deliberate bug. It is marked `test.fail()`, so the run stays green while the bug is known.

## Send the results to your TestOps

The results can go to the shop's project in your DEMO workspace.

1. **Start TestOps.** From the repository root, run `pnpm start`. You can also use any TestOps server.
2. **Create an API token.** Sign in, open **Account → API tokens**, and create one.
3. **Find the project.** Open **DEMO → Bean & Leaf shop**; the project id is in the address (`/projects/<project id>/…`).

   On a server with `DEMO_WORKSPACE=false`, build the project yourself instead:

   ```bash
   TESTOPS_URL=http://localhost:8080/api/v1 TESTOPS_TOKEN=<token> npm run seed
   ```

   It creates the workspace *Demo shop* with the project, and prints its id. Running it again is safe.
4. **Run the tests with the reporter:**

   ```bash
   TESTOPS_URL=http://localhost:8080/api/v1 TESTOPS_TOKEN=<token> TESTOPS_PROJECT_ID=<project id> npm test
   ```

   The reporter prints the address of the new run:
   - the run is a completed CI run;
   - each result shows its source and duration;
   - "A discount code applies only once" is Failed and linked to the defect *A discount code can be applied more than once*;
   - PayPal is Skipped.

### Reporter settings

| Variable | Purpose |
|---|---|
| `TESTOPS_URL` | API base, e.g. `https://testops.example.com/api/v1` |
| `TESTOPS_TOKEN` | API token of someone who can record results in the project (Admin, Tester or Automation) |
| `TESTOPS_SYNC_TOKEN` | Tester/Admin API token used by `testops-sync --apply` to update case titles and automation status |
| `TESTOPS_PROJECT_ID` | The project the results go to |
| `TESTOPS_RUN_ID` | Optional: report into this run, which TestOps started, instead of making a new one. Only its cases set to Automation get results, and the run stays open for the manual ones. |
| `TESTOPS_RUN_TITLE` | Optional. Default: `Playwright – <branch> @ <commit>` on GitHub Actions, `Playwright – local` elsewhere |
| `TESTOPS_ENVIRONMENT` | Optional. Default: `CI` on CI, `local` elsewhere |
| `TESTOPS_CI_URL` | Optional. Overrides the CI job URL detected from GitHub Actions, GitLab CI, CircleCI or Buildkite. |
| `TESTOPS_ATTACHMENTS` | Optional: `failed` (default), `all` or `none`. Which tests get their artifacts (screenshots, video, trace, logs) uploaded. |

### Let TestOps start CI

A run started from a plan can send its automated cases to CI and get their results back in the same run, next to the manual ones.

1. **Point the project's webhook at GitHub.** In TestOps, under **Integrations**:
   - set the webhook URL to `https://api.github.com/repos/OWNER/REPO/dispatches`;
   - add the headers `Authorization: Bearer <GitHub token>` and `Accept: application/vnd.github+json`. The token is a fine-grained token for that repository, with Contents set to read and write.
2. **Give CI a TestOps token.** In the repository, add the secret `TESTOPS_TOKEN`, an API token of someone who can record results in the project.
3. **Start on the dispatch.** Use a workflow that starts on `repository_dispatch` with type `testops.run.started`, like [demo-shop.yml](../../.github/workflows/demo-shop.yml). It:
   - runs only the run's cases (`--grep` built from `client_payload.automation_case_ids`; each test is tagged with its TestOps ID);
   - sets `TESTOPS_URL`, `TESTOPS_PROJECT_ID` and `TESTOPS_RUN_ID` from the payload;
   - runs `npx testops-sync --apply` to update mapped case titles and automation status. Set `TESTOPS_SYNC_TOKEN` to a Tester/Admin token; keep `TESTOPS_TOKEN` as the Automation result-reporting token.
4. **Start a run.** In the plan's case list, set the cases CI should run to **Automation**, then start a run from the plan. TestOps calls the webhook, CI runs those tests, and their results appear in the run. The run also gets a link to the CI job.

### Linking tests to cases

A test names its case with the Test ID shown in the TestOps case details:

```ts
test('pays by card and shows the order number', testops('550e8400-e29b-41d4-a716-446655440000'), async ({ page }) => { … });
```

The reporter submits the exact TestOps case ID, so the test and case titles may change independently. A test without a TestOps ID annotation is listed at the end and left out; results never create new test cases.

`testops('<test-case-uuid>', '<defect title>')` also links a failure of the test to that open defect.

Steps written with `test.step()` are reported against the case's steps. A step is matched by its title, so
it must read the same as the case step (case and spacing don't matter). The "Adding products updates the cart
badge and the totals" test in [`tests/cart.spec.ts`](tests/cart.spec.ts) shows it: its two steps are the two
steps of the matching case.

### Keep test cases in sync

`testops-sync` discovers tests with `playwright test --list`; it does not execute them. It compares
their titles and automation status with the TestOps cases referenced by ID. By default it prints a
dry run. To apply changed titles and set those cases to **Automated**, run this before the test job:

```bash
npx testops-sync --apply
```

`npx testops-sync --link` also pairs tests that have no ID with cases of the same title, and `--link --apply`
writes the IDs into the test files; see the package README for the rules.

It leaves descriptions, steps, tags, requirements and all unannotated cases untouched. Use
`TESTOPS_SYNC_TOKEN` with a Tester or Admin role for write access; the regular reporter can continue
using a dedicated Automation token.

Results map as follows:

| Playwright | TestOps |
|---|---|
| passed | Passed. A pass on a retry says "Passed on retry N". |
| failed or timed out | Failed, with the error message and the failure screenshots |
| `test.fail()` that fails | Failed, with the comment "Known issue: …" |
| skipped | Skipped, with the reason |

The run is completed after the upload. If the upload fails, the Playwright run fails, so CI doesn't hide it.

## Changing the demo

Every DEMO workspace is made from [`demo-shop.json`](../../apps/api/src/demo/demo-shop.json):
- To add a case, requirement or defect, add it there. Demos made after the change have it; existing ones belong to their users and stay as they are.
- To keep the automated run in step with a changed test, update the file's `automatedRun` from a real run.
