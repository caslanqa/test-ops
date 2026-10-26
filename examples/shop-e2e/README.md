# Shop E2E: a Playwright framework that reports to TestOps

A small Playwright framework, built the way a team would build one: page objects, fixtures, tests that
carry no TestOps IDs in git, and a CI job that TestOps can start. It tests the Bean & Leaf shop of the
[demo-shop](../demo-shop/README.md) example and reports into a TestOps project, for example the **Demo
Project**. It exercises what [`@testops/reporter`](../../packages/reporter/README.md) does: linking tests
to cases, syncing titles, runs, steps, artifacts and retries.

`demo-shop` is the other way round: its per-user demo gets its case IDs from a webhook. Here you do what
a new project would do: create the cases, link the tests to them, then run.

| Path | What it is |
|---|---|
| `src/pages/` | Page objects: `CatalogPage`, `CartPage`, `CheckoutPage` |
| `src/fixtures.ts` | `test` with the page objects as fixtures, and `expect` |
| `tests/` | 12 tests |
| `cases/cases.json` | The suites, cases (with steps) and defect that `npm run cases` creates |
| `scripts/create-cases.mjs` | Creates the cases in a TestOps project |
| `scripts/pick-from-dispatch.mjs` | Chooses the tests a TestOps dispatch asks for |

The shop itself is the one in `../demo-shop` (`app/` and `server.mjs`); Playwright starts it on port
4174 (`PORT` changes it).

## Run the tests

```bash
cd examples/shop-e2e
npm ci
npx playwright install chromium
npm test
```

Without TestOps settings the reporter sends nothing; results stay in the terminal and in
`playwright-report/`. The default run is green: 11 tests pass and PayPal is skipped.

Two switches turn on failures on purpose, so you can see what TestOps shows for them:

| Variable | Effect |
|---|---|
| `SHOP_E2E_STRICT=1` | "a discount code applies only once" fails for real, as the shop's known bug makes it. By default it is expected to fail, so the run stays green. |
| `SHOP_E2E_FLAKY=1` | The first attempt of "a declined card shows an error and keeps the cart" fails; the retry passes, and only the retry is reported. |

`TESTOPS_ATTACHMENTS=all` makes Playwright record a screenshot, video and trace for every test, not only
for failures, so the reporter has files to upload for passing tests too.

## Report to TestOps

1. **Create an API token** under **Account → API tokens**. One token does everything here: it creates
   cases, links tests, syncs titles and reports results. A token has the rights of the account that made
   it, so there is no role to set; the account only has to be a Tester or Admin in the project (a project
   or workspace admin already is).
2. **Find the project ID** in the address of the project (`/projects/<project id>/…`).
3. **Create the cases** in the project. It is safe to run again, also after step 5 renamed the cases: it
   finds each case by its `shop-e2e:<key>` tag and adds only what is missing:

   ```bash
   export TESTOPS_URL=http://localhost:8080/api/v1 TESTOPS_TOKEN=<token> TESTOPS_PROJECT_ID=<project id>
   npm run cases
   ```

4. **Link the tests to the cases.** The tests have no IDs yet. This lists the pairs it would make, then
   writes `testops('<id>')` into the tests whose title is exactly one case's title:

   ```bash
   npx testops-sync --link
   npx testops-sync --link --apply
   ```

   Two cases are left for you on purpose. **Customer pays by card** is the older title of the test "pays
   by card and shows the order number", and **An unknown code is rejected** exists twice (in Discounts and
   in Regression), so the test is ambiguous. Add `testops('<case id>')` as the second argument of those
   tests by hand; `npm run cases` printed the IDs. To link the known-bug test to its defect, give it the
   defect's title too: `testops('<case id>', 'A discount code can be applied more than once')`.
5. **Sync the case titles and automation status:**

   ```bash
   npx testops-sync --apply
   ```

   Every linked case now carries the title of its test (lower case, like the tests) and is **Automated**.
6. **Run the tests and report:**

   ```bash
   npm test
   ```

   The reporter prints the address of the new run. Try it again with `SHOP_E2E_STRICT=1
   SHOP_E2E_FLAKY=1 TESTOPS_ATTACHMENTS=all npm test` to see a failed result with its screenshot, video,
   trace and logs, a defect link, and a flaky test reported once.

Keep the `testops()` calls out of your commits if you link in a clone you share: the IDs belong to one
TestOps project. CI does this linking itself (below).

## What the tests show

| Test | Shows |
|---|---|
| the catalog lists every product with its price, searching narrows the catalog | plain results |
| adding products updates the cart badge and the totals | step results: its `test.step()` titles equal the case's steps |
| pays by card and shows the order number | steps, and a file added with `testInfo.attach()` |
| a discount code applies only once | a failed result with artifacts, linked to a defect (strict mode) |
| a declined card shows an error and keeps the cart | retries: only the last attempt is reported (flaky mode) |
| pays with PayPal | a skipped result with its reason |

## Let TestOps start the CI job

A run started in TestOps can send its automated cases to GitHub Actions and get the results back in the
same run, next to the manual ones. [`shop-e2e.yml`](../../.github/workflows/shop-e2e.yml) does the CI
side: on `repository_dispatch` it links the tests to the project's cases by title, syncs their metadata,
runs only the cases of the run (`scripts/pick-from-dispatch.mjs` builds the `--grep`), and reports into
the run. On pushes and pull requests it only runs the tests.

1. **Point the project's webhook at GitHub.** In TestOps, under **Integrations → CI webhook**, set the URL
   to `https://api.github.com/repos/OWNER/REPO/dispatches` and add the headers
   `Authorization: Bearer <GitHub token>` and `Accept: application/vnd.github+json` (a fine-grained token
   for the repository with Contents set to read and write).
2. **Add the repository secret** `TESTOPS_TOKEN`, the same kind of API token as above. The job uses it
   to link, sync and report. (To keep reporting to the narrower Automation role, use the separate
   `TESTOPS_SYNC_TOKEN` of the reporter's own docs; this workflow does not need it.)
3. **Add the repository variable** `SHOP_E2E_PROJECT_ID`, the TestOps project ID. The server sends the
   same event for every project, so the workflow runs a dispatch only for this project, and
   [`demo-shop.yml`](../../.github/workflows/demo-shop.yml) ignores it.
4. **Start a run.** In the project's plan, set the cases CI should run to **Automation** and start the
   run. The TestOps address must be reachable from GitHub's runners.

Keep each test's title equal to its case's title (ignoring case and spacing). A test whose title no case
has, or two cases have, is not linked in CI and so does not run for a dispatch.
