# Shop E2E example: a customer-style Playwright framework for the Demo Project

Date: 2026-10-26. Branch: `feat/shop-e2e-example` (from `feat/playwright-testops-reporter`, which holds the reporter).

## Goal

Write a small but realistic Playwright framework, `examples/shop-e2e`, that tests the Bean & Leaf shop and
reports into the **Demo Project** (key `DEMO`, Default Workspace) of a TestOps server. The project starts
with no cases. Using the framework from that empty state exercises everything the reporter branch
built, the way a new user meets it:

- creating cases, then linking tests to them by title (`testops-sync --link`);
- syncing titles and automation status (`testops-sync --apply`);
- a run the reporter creates itself, and a run TestOps starts through the CI webhook;
- step results, artifacts, retries, known-defect links.

A GitHub Actions workflow lets TestOps start the framework in CI: a run started in TestOps calls the
project's webhook, GitHub dispatches the workflow, the workflow runs the run's cases and reports into that
run.

## Scope

In:

- `examples/shop-e2e`: config, page objects, fixtures, 12 tests, case definitions, a script that creates
  the cases, a script that picks the cases of a dispatch, README.
- `.github/workflows/shop-e2e.yml`.
- A one-line guard in `.github/workflows/demo-shop.yml` (see CI).
- A verification of the whole flow on the local stack, and fixes in `packages/reporter` for what it finds,
  each with a failing test first.

Out: changes to the shop or to `examples/demo-shop` tests; a committed script that asserts results; a
Playwright config shared with `demo-shop`; changes to the TestOps app. The verification is done by hand
and reported, with throw-away scripts that are not committed.

## Decisions

1. **The shop is reused, not copied.** `webServer` runs `node ../demo-shop/server.mjs`, which serves
   `../demo-shop/app`. The framework listens on port 4174 (`PORT` overrides) so it never clashes with the
   `demo-shop` suite on 4173.
2. **Tests carry no TestOps IDs in git.** IDs belong to one TestOps server, so committing them would tie
   the example to one instance. They are written into a checkout by `testops-sync --link --apply`: by the
   user on their machine, and by the CI job before it selects tests.
3. **Same package source as `demo-shop`.** `@testops/reporter` is `file:../../packages/reporter`, so CI
   and local runs use the reporter from the same commit. `@playwright/test` is pinned to 1.63.0 like
   `demo-shop`.
4. **Failures are opt-in.** The default run is green with and without TestOps, so push and PR CI stay
   green. Two switches turn on the failures needed to see failure artifacts and retries:
   `SHOP_E2E_STRICT=1` makes the known-bug test a real failure (otherwise `test.fail(true, …)`), and
   `SHOP_E2E_FLAKY=1` makes the first attempt of one test fail on purpose. Both are documented as
   verification switches, and the test code says why they exist.
5. **Config ties artifacts to the reporter setting.** `screenshot`, `video` and `trace` are
   `retain-on-failure` by default and `on` when `TESTOPS_ATTACHMENTS=all`, so that setting has files to
   upload.
6. **TestOps events reach one workflow per project.** The server always sends `testops.run.started`, so a
   repository with two workflows listening to it gets both on every dispatch. `shop-e2e.yml` runs a
   dispatch only when `client_payload.project.id == vars.SHOP_E2E_PROJECT_ID`; `demo-shop.yml` gets the
   opposite guard (`!=`), so it ignores dispatches for that project and behaves as before when the
   variable is unset.

## Layout

```
examples/shop-e2e/
  package.json            scripts: test, typecheck, cases (create-cases), pick (pick-from-dispatch)
  playwright.config.ts    webServer, retries 1, reporters list + html + @testops/reporter
  tsconfig.json
  src/pages/              CatalogPage, CartPage, CheckoutPage
  src/fixtures.ts         test.extend: catalog, cart, checkout page objects
  tests/                  catalog, cart, discounts, checkout .spec.ts
  cases/cases.json        suites, case titles, case steps
  scripts/create-cases.mjs
  scripts/pick-from-dispatch.mjs
  README.md
```

## Tests and what each one exercises

| Test (title = case title unless noted) | Exercises |
|---|---|
| the catalog lists every product with its price | plain pass, link by title |
| searching narrows the catalog | plain pass |
| adding products updates the cart badge and the totals | `test.step()` titles equal to the case steps: step results |
| changing the quantity updates the totals | plain pass |
| removing the last product empties the cart | plain pass |
| orders from €40 ship for free | plain pass |
| a valid code takes 10% off | plain pass |
| an unknown code is rejected | plain pass |
| a discount code applies only once | known bug: `test.fail(!strict)`; with strict it fails with screenshot, video, trace, log; linked to a defect title |
| pays by card and shows the order number | steps, and `testInfo.attach()` of the order number as a custom attachment |
| a declined card shows an error and keeps the cart | plain pass |
| pays with PayPal | `test.skip`: Skipped with a reason |

`SHOP_E2E_FLAKY=1` makes the first attempt of "a declined card shows an error and keeps the cart" throw,
so the retry decides the result and only that last attempt is reported.

Two title situations for the link and sync steps, both in `cases/cases.json`:

- one case has an older title than its test ("Customer pays by card"): `--link` does not pair it and
  lists the test as unmatched; the user adds the ID by hand, and `testops-sync --apply` renames the case to
  the test's title;
- two cases share the title "an unknown code is rejected" (one in the Discounts suite, one in a
  Regression suite, as a copied case would): `--link` reports the title as ambiguous and writes nothing
  for that test, so it is linked by hand like the renamed one.

## Setting up the project (`create-cases.mjs`)

`TESTOPS_URL`, `TESTOPS_TOKEN` (an API token of a project Tester or Admin) and `TESTOPS_PROJECT_ID` are
read. For each suite and case of `cases/cases.json` it creates what is missing: suites are found by name and
a case by its `shop-e2e:<key>` tag, not by title, because `testops-sync` renames cases to their tests'
titles and a title repeats on purpose. A new case has steps and automation status `TO_BE_AUTOMATED`. So
re-running is safe, also after a sync, and it prints the case IDs.
It also creates the defect "A discount code can be applied more than once", which the known-bug test names.
It never creates the workspace or the project: the Demo Project is the target.

## CI: `.github/workflows/shop-e2e.yml`

Triggers, as in `demo-shop.yml`: `repository_dispatch` (`testops.run.started`), `push` to `master` and
`pull_request` for `examples/shop-e2e/**`, `examples/demo-shop/app/**`, `examples/demo-shop/server.mjs`,
`packages/reporter/**` and the workflow file, and `workflow_dispatch`. Concurrency per ref.

Job `playwright`, working directory `examples/shop-e2e`:

1. checkout, Node 22 with the npm cache on `examples/shop-e2e/package-lock.json`, `npm ci`, typecheck,
   `npx playwright install --with-deps chromium`;
2. for a dispatch only: `npx testops-sync --link --apply`, so the checkout's tests carry the IDs of this
   TestOps project;
3. for a dispatch only: `npx testops-sync --apply` with `TESTOPS_SYNC_TOKEN`;
4. for a dispatch only: `node scripts/pick-from-dispatch.mjs "$GITHUB_EVENT_PATH"` writes the `--grep`
   (`@testops-(<id>|<id>)(\s|$)`, or `(?!)` when the run has no automated case IDs) to `$GITHUB_OUTPUT`;
5. `npx playwright test`, with `--grep` on a dispatch. For a dispatch the env is `TESTOPS_URL` from
   `client_payload.api_url`, `TESTOPS_PROJECT_ID` from `client_payload.project.id`, `TESTOPS_RUN_ID` from
   `client_payload.run.id`, `TESTOPS_TOKEN` from the secret; on push and pull request none are set and the
   reporter stays silent;
6. upload `playwright-report` (14 days), also after a failure.

The selection is a script, not inline `jq`, so the same code runs in CI and in the local verification.
Needed in the repository: secrets `TESTOPS_TOKEN` (Automation) and `TESTOPS_SYNC_TOKEN` (Tester or Admin),
variable `SHOP_E2E_PROJECT_ID`, and the project's webhook pointing at the repository's dispatches
endpoint (see the README).

`demo-shop.yml` gets `if: github.event_name != 'repository_dispatch' || github.event.client_payload.project.id != vars.SHOP_E2E_PROJECT_ID`
on its job, and its concurrency group is keyed by run id for dispatches (as in `shop-e2e.yml`): a dispatch
for the other project skips the job but would still join the per-ref group and could cancel a running
`demo-shop` run. Nothing else in it changes.

## Verification on the local stack

Done by hand after the framework exists; results are reported to the user, and anything the reporter gets
wrong is fixed in `packages/reporter` with a failing test first.

1. `create-cases` fills the empty Demo Project; check suites, cases, steps in the web app.
2. `testops-sync` and `--link` as dry runs, then `--link --apply`, then add the one ID by hand and
   `testops-sync --apply`; check what was written, what was listed as unmatched and ambiguous, and the
   renamed case.
3. `npm test` with no run ID: a new run, statuses, step results, duration, skipped reason.
4. Again with `SHOP_E2E_STRICT=1 SHOP_E2E_FLAKY=1 TESTOPS_ATTACHMENTS=all`: failed result with screenshot,
   video, trace and log, a defect link, only the last attempt of the flaky test, the custom attachment;
   history of a case shows both runs.
5. The CI path without GitHub: the Demo Project's webhook (set in the Integrations page, with the local
   server allowed to call private addresses, `WEBHOOK_ALLOW_PRIVATE_NETWORKS=true`) points at a throw-away
   local receiver that saves the payload and the signature. A plan run with cases set to Automation is
   started; the saved payload is fed through steps 2 to 5 of the job, locally, with `GITHUB_EVENT_PATH`;
   results land in the run TestOps started and the run stays open for manual cases. This also exercises
   the Integrations page built on `feat/integrations-tabs`.
6. Clean up: the tests' IDs written by `--link` are reverted with git (they stay out of the commits).

Not verifiable here: an actual GitHub Actions run. It needs the repository secrets and variable, a
public TestOps URL the runner can reach, and a GitHub token in the webhook headers. The workflow is
checked with `actionlint` when it is installed, and its logic is covered by step 5.

## Risks and limits

- Dispatches from the Demo Project reach `shop-e2e.yml` only after the repository variable is set;
  until then, they are ignored by it and handled by `demo-shop.yml` as before.
- `--link` writes IDs into the runner's checkout, never into git; the job's later steps depend on that
  write, so a title mismatch between a test and its case means that test does not run in CI. This is
  the reporter's documented behaviour; the README tells users to keep titles equal.
- The flaky and strict switches are for verification. If they are left on in CI, the job is red or
  flaky on purpose.
