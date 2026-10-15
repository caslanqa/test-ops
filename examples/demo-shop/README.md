# Demo shop: tests from the browser to TestOps

A complete example of test management with TestOps. It contains:

- a small web shop, **Bean & Leaf**;
- Playwright tests for the shop;
- a reporter that sends the test results to TestOps;
- a script that builds the matching **DEMO workspace**;
- a GitHub Actions workflow that runs the tests every day.

On the public demo server every signed-in user can open the DEMO workspace and look around, read-only. It shows:

- the cases;
- the requirements they cover;
- a release plan;
- a manual run a tester has partly done;
- an automated run from each CI run;
- the defects that link them together.

```
 app/ (the shop) ◄── tests/*.spec.ts (Playwright)
                          │  testops/reporter.ts
                          ▼
             TestOps API: a run, one result per test,
             screenshots of failures, links to known defects
                          │
                          ▼
     DEMO workspace ─ Bean & Leaf shop project
     cases (tagged e2e:<key>) · requirements · plan · runs · defects
```

| Path | What it is |
|---|---|
| `app/` | The shop: products, a cart with discount codes and free shipping from €40, and a card checkout with test cards. It is three static files with no build step. It has one bug on purpose: a discount code can be applied twice. |
| `server.mjs` | Serves the shop on port 4173. It has no dependencies; Playwright starts it. |
| `tests/` | 13 Playwright tests. Each one names its TestOps case with `testops('<key>')`. |
| `testops/reporter.ts` | The Playwright reporter that sends results to TestOps. |
| `testops/seed.mjs` | Builds the DEMO workspace through the API: suites, cases with steps, requirements, a milestone, a plan, a manual run and defects. It is safe to run again. |
| `../../.github/workflows/demo-shop.yml` | Runs the tests on CI and reports them to the demo. |

## Run the tests

```bash
cd examples/demo-shop
npm ci
npx playwright install chromium
npm test
```

Without TestOps settings the reporter does nothing, and the results stay in the terminal and in `playwright-report/`.

The test "a discount code applies only once" fails because of the deliberate bug. It is marked `test.fail()`, so the run stays green while the bug is known.

## Send the results to TestOps

1. **Start TestOps.** From the repository root, run `pnpm start`. You can also use any TestOps server.
2. **Create an API token.** Sign in, open **Account → API tokens**, and create one.
3. **Build the workspace:**

   ```bash
   TESTOPS_URL=http://localhost:8080/api/v1 TESTOPS_TOKEN=<token> npm run seed
   ```

   It prints the workspace id (`DEMO_WORKSPACE_ID`) and the project id (`TESTOPS_PROJECT_ID`).
4. **Run the tests with the reporter:**

   ```bash
   TESTOPS_URL=http://localhost:8080/api/v1 TESTOPS_TOKEN=<token> TESTOPS_PROJECT_ID=<project id> npm test
   ```

   The reporter prints the address of the new run. In TestOps, open **Runs** in the Bean & Leaf shop project to see it:
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
| `TESTOPS_RUN_TITLE` | Optional. Default: `Playwright – <branch> @ <commit>` on GitHub Actions, `Playwright – local` elsewhere |
| `TESTOPS_ENVIRONMENT` | Optional. Default: `CI` on CI, `local` elsewhere |

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

## Set up the public demo

These steps are for whoever runs the demo server.

1. **Create a demo account.** Sign up a dedicated account, for example "TestOps Demo". It owns the workspace, and its name appears in the member lists. Visitors don't see member email addresses. Create an API token for it.
2. **Build the workspace.** Run `npm run seed` against the server with that token.
3. **Show it to everyone.** Set `DEMO_WORKSPACE_ID=<printed id>` in the server's environment, then redeploy. Every signed-in user now sees the DEMO workspace, read-only. See [Demo workspace](../../README.md#demo-workspace).
4. **Connect GitHub.** In the repository settings, add:
   - the variables `TESTOPS_DEMO_URL` and `TESTOPS_DEMO_PROJECT_ID`;
   - the secret `TESTOPS_DEMO_TOKEN`.

   The [demo-shop workflow](../../.github/workflows/demo-shop.yml) then reports on master, every morning and when started by hand. Pull requests run the tests without reporting.
