# Demo shop: tests from the browser to TestOps

The example behind TestOps' built-in **DEMO workspace**. It contains:

- a small web shop, **Bean & Leaf**;
- Playwright tests for the shop;
- a reporter that sends the test results to TestOps.

Every TestOps user gets the shop's project in a DEMO workspace of their own, as its admin. The server makes it from [`apps/api/src/demo/demo-shop.json`](../../apps/api/src/demo/demo-shop.json), so there is nothing to set up (see [Demo workspace](../../README.md#demo-workspace)). The project shows:

- the cases and the requirements they cover;
- a release plan;
- a manual run a tester has partly done;
- an automated run of these tests;
- the defects linked to their failures.

```
 app/ (the shop) ◄── tests/*.spec.ts (Playwright)
                          │  testops/reporter.ts
                          ▼
             TestOps API: a run, one result per test,
             screenshots of failures, links to known defects
                          │
                          ▼
     Bean & Leaf shop project
     cases (tagged e2e:<key>) · requirements · plan · runs · defects
```

| Path | What it is |
|---|---|
| `app/` | The shop: products, a cart with discount codes and free shipping from €40, and a card checkout with test cards. It is three static files with no build step. It has one bug on purpose: a discount code can be applied twice. |
| `server.mjs` | Serves the shop on port 4173. It has no dependencies; Playwright starts it. |
| `tests/` | 13 Playwright tests. Each one names its TestOps case with `testops('<key>')`. |
| `testops/reporter.ts` | The Playwright reporter that sends results to TestOps. |
| `testops/seed.mjs` | Builds the same project in your own account, so you can send results to it. |

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
| `TESTOPS_PROJECT_ID` | The project the results go to |
| `TESTOPS_RUN_ID` | Optional: report into this run, which TestOps started, instead of making a new one. Only its cases set to Automation get results, and the run stays open for the manual ones. |
| `TESTOPS_RUN_TITLE` | Optional. Default: `Playwright – <branch> @ <commit>` on GitHub Actions, `Playwright – local` elsewhere |
| `TESTOPS_ENVIRONMENT` | Optional. Default: `CI` on CI, `local` elsewhere |

### Let TestOps start CI

A run started from a plan can send its automated cases to CI and get their results back in the same run, next to the manual ones.

1. **Point the project's webhook at GitHub.** In TestOps, under **Integrations**:
   - set the webhook URL to `https://api.github.com/repos/OWNER/REPO/dispatches`;
   - add the headers `Authorization: Bearer <GitHub token>` and `Accept: application/vnd.github+json`. The token is a fine-grained token for that repository, with Contents set to read and write.
2. **Give CI a TestOps token.** In the repository, add the secret `TESTOPS_TOKEN`, an API token of someone who can record results in the project.
3. **Start on the dispatch.** Use a workflow that starts on `repository_dispatch` with type `testops.run.started`, like [demo-shop.yml](../../.github/workflows/demo-shop.yml). It:
   - runs only the run's cases (`--grep` built from `client_payload.automation_keys`; each test is tagged `@<key>`);
   - sets `TESTOPS_URL`, `TESTOPS_PROJECT_ID` and `TESTOPS_RUN_ID` from the payload.
4. **Start a run.** Start a run from a plan and choose which cases are Automation. TestOps calls the webhook, CI runs those tests, and their results appear in the run. The run also gets a link to the CI job.

### Linking tests to cases

A test names its case with an annotation, and the reporter looks for the case tagged `e2e:<key>`:

```ts
test('pays by card and shows the order number', testops('checkout-card'), async ({ page }) => { … });
```

The link is a tag rather than a title or an id, so either side can be renamed and the link works on any server. A test without a matching case is listed at the end and left out, because TestOps does not create cases from results yet.

`testops('<key>', '<defect title>')` also links a failure of the test to that open defect.

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
