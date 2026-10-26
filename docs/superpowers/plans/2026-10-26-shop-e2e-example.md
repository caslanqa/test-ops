# Shop E2E Example Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer-style Playwright framework (`examples/shop-e2e`) for the Bean & Leaf shop that reports into the Demo Project, with a GitHub Actions workflow TestOps can start, and a verified end-to-end run of the reporter branch's features.

**Architecture:** The shop is reused from `examples/demo-shop` (served by its `server.mjs`). The framework has page objects, fixtures and 12 tests with no TestOps IDs in git. Cases are created in the Demo Project by a script; IDs are written into a checkout by `testops-sync --link --apply`. CI selects a dispatch's cases with a small tested script.

**Tech Stack:** Playwright 1.63.0, TypeScript 5.9.3, Node 22 (CI), `@testops/reporter` from `file:../../packages/reporter`, `node:test` for the script test, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-26-shop-e2e-example-design.md`

## Global Constraints

- Repo content (code, comments, docs, commits) is English. The reference tool is never named; say "the reference tool" if it must be mentioned.
- Shop port 4174 (`PORT` overrides). `@playwright/test` 1.63.0, `@types/node` 22.18.8, `typescript` 5.9.3 (same as `examples/demo-shop`).
- `@testops/reporter` is `file:../../packages/reporter`.
- No TestOps IDs in committed tests. The default run is green with and without TestOps settings.
- Verification switches: `SHOP_E2E_STRICT=1` (known-bug test really fails), `SHOP_E2E_FLAKY=1` (first attempt of one test throws).
- `screenshot`, `video`, `trace`: `retain-on-failure`, or `on` when `TESTOPS_ATTACHMENTS=all`.
- Case automation status at creation: `TO_BE_AUTOMATED`. The target project is the Demo Project: the script never creates a workspace or project.
- A dispatch runs in `shop-e2e.yml` only when `client_payload.project.id == vars.SHOP_E2E_PROJECT_ID`; `demo-shop.yml` gets the `!=` guard.
- Commit only `examples/shop-e2e/**`, `.github/workflows/shop-e2e.yml`, `.github/workflows/demo-shop.yml`, and the spec and plan docs if the user says so. Never `apps/web/**` (uncommitted integrations work) or `.vscode/`. Never use `git add -A`.
- Parallel Bash calls share one shell: use absolute paths and no `cd` in parallel calls.

## Review Focus

- A dispatch payload with no `automation_case_ids` must run no test (`(?!)`), not all of them. Pinned in Task 6.
- Non-UUID values in `automation_case_ids` must never reach the grep or the shell. Pinned in Task 6.
- Running `create-cases` twice must not duplicate suites, cases or the defect. Checked in Task 5.
- Without `TESTOPS_*` settings the reporter must make no network call, so push and PR CI stay green offline. Checked in Task 1.
- A dispatch for another project must not start `shop-e2e.yml`, and one for the e2e project must not start `demo-shop.yml`. Checked by `actionlint` where available and by Task 7's expression review; a real run is out of reach locally.
- Tests written with fixtures (`async ({ catalog, cart }) => …`) must be editable by `--link --apply`. Checked in Task 9.

---

### Task 1: Project skeleton and catalog tests

**Files:**
- Create: `examples/shop-e2e/package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`, `playwright.config.ts`
- Create: `examples/shop-e2e/src/pages/CatalogPage.ts`, `src/fixtures.ts`
- Create: `examples/shop-e2e/tests/catalog.spec.ts`

**Interfaces:**
- Produces: `class CatalogPage` (`constructor(page: Page)`, `goto(): Promise<void>`, `titles: Locator` (the level-2 headings), `product(name: string): Locator`, `search(text: string): Promise<void>` (fills the "Search products" field), `addToCart(name: string, times?: number): Promise<void>` (clicks "Add <name> to cart"), `cartBadge: Locator` (`#cart-count`), `emptyResult: Locator` (the "No products match your search." text)).
- Produces: `src/fixtures.ts` exports `test` (Playwright `test.extend` with fixtures `catalog: CatalogPage`, later `cart`, `checkout`) and `expect`. Tests import both from `../src/fixtures`.

- [ ] **Step 1: Write the project files.** `package.json`: name `testops-shop-e2e`, `private`, `type: module`, scripts `test` (`playwright test`), `typecheck` (`tsc --noEmit`), `cases` (`node scripts/create-cases.mjs`), `pick` (`node scripts/pick-from-dispatch.mjs`), `test:scripts` (`node --test scripts`); devDependencies as in Global Constraints plus the reporter. `tsconfig.json` as demo-shop's, `include`: `playwright.config.ts`, `src`, `tests`. `.gitignore`: `node_modules/`, `test-results/`, `playwright-report/`. `playwright.config.ts`: `testDir ./tests`, `fullyParallel`, `forbidOnly` in CI, `retries: 1`, reporters `list`, `html` (open never) and `require.resolve('@testops/reporter')` via `createRequire` (as demo-shop), `use.baseURL http://localhost:${port}` with `port = Number(process.env.PORT ?? 4174)`, `screenshot`/`video`/`trace` as in Global Constraints, one `chromium` project, `webServer` `{ command: 'node ../demo-shop/server.mjs', url, reuseExistingServer: !process.env.CI, env: { PORT: String(port) } }`.
- [ ] **Step 2: Write the failing tests** in `tests/catalog.spec.ts`: "the catalog lists every product with its price" and "searching narrows the catalog", same assertions and values as `examples/demo-shop/tests/catalog.spec.ts`, but through `catalog` (the page object) and no `demoTestops`. A `beforeEach` calls `catalog.goto()`.
- [ ] **Step 3: Run to verify it fails.** `cd /Users/cihanaslan/Development_Projects/test-ops/examples/shop-e2e && npm install && npx playwright install chromium && npm test`. Expected: FAIL, `Cannot find module '../src/fixtures'` (or `CatalogPage`).
- [ ] **Step 4: Implement `CatalogPage` and `src/fixtures.ts`** as in Interfaces.
- [ ] **Step 5: Verify green and quiet.** `npm run typecheck && npm test`. Expected: 2 passed, no `testops` output. `env | grep TESTOPS` is empty in this shell; if the reporter prints anything or opens a connection, that is a finding. Then `TESTOPS_ATTACHMENTS=all npm test`. Expected: `test-results/` holds `video.webm` and a trace for the passing tests. `git status --short examples/shop-e2e` lists no `node_modules`, `test-results` or `playwright-report`.
- [ ] **Step 6: Commit.** `git add examples/shop-e2e && git commit -m "feat(shop-e2e): add the Playwright framework skeleton with catalog tests"`.

### Task 2: Cart tests

**Files:**
- Create: `examples/shop-e2e/src/pages/CartPage.ts`, `tests/cart.spec.ts`
- Modify: `examples/shop-e2e/src/fixtures.ts` (add `cart`)

**Interfaces:**
- Consumes: `CatalogPage.addToCart`, `CatalogPage.cartBadge`, fixtures `test`/`expect` (Task 1).
- Produces: `class CartPage` (`constructor(page: Page)`, `goto(): Promise<void>` (`/#/cart`), `openFromHeader(): Promise<void>` (clicks the link named /Cart/), `summary(name: 'subtotal' | 'discount' | 'shipping' | 'total'): Locator` (by test id), `setQuantity(product: string, quantity: number): Promise<void>` (fills "Quantity of <product>" and presses Tab), `remove(product: string): Promise<void>` (button "Remove <product>"), `applyCode(code: string): Promise<void>` (fills "Discount code", clicks "Apply"), `emptyMessage: Locator` ("Your cart is empty."), `codeAccepted: Locator` (role status filtered by "applied"), `codeError: Locator` (role alert)). Fixture `cart: CartPage`.

- [ ] **Step 1: Write the failing tests** in `tests/cart.spec.ts`, four tests with the titles and values of `examples/demo-shop/tests/cart.spec.ts`: "adding products updates the cart badge and the totals" (two `test.step()` calls titled exactly "Add Espresso beans twice and a Ceramic mug" and "Open the cart", the second using `cart.openFromHeader()`), "changing the quantity updates the totals", "removing the last product empties the cart", "orders from €40 ship for free". Through page objects, no `demoTestops`.
- [ ] **Step 2: Run to verify it fails.** `npx playwright test tests/cart.spec.ts`. Expected: FAIL, `cart` fixture or `CartPage` missing.
- [ ] **Step 3: Implement `CartPage` and add the `cart` fixture.**
- [ ] **Step 4: Run.** `npm run typecheck && npm test`. Expected: 6 passed.
- [ ] **Step 5: Commit.** `git add examples/shop-e2e && git commit -m "feat(shop-e2e): add cart tests with steps"`.

### Task 3: Discount tests and the strict switch

**Files:**
- Create: `examples/shop-e2e/tests/discounts.spec.ts`

**Interfaces:**
- Consumes: `CartPage.applyCode`, `codeAccepted`, `codeError`, `summary` (Task 2); `CatalogPage.addToCart` (Task 1).
- Produces: nothing for later tasks. The known-bug test's title is "a discount code applies only once".

- [ ] **Step 1: Write the tests.** `beforeEach`: go to the catalog, add "Filter coffee, 500 g", open the cart page. Tests: "a valid code takes 10% off" (WELCOME10; status text `Code WELCOME10 applied: 10% off.`; discount `−€1.45`; total `€17.95`), "an unknown code is rejected" (SAVE50; alert text `This discount code isn't valid.`; no discount row), "a discount code applies only once" (WELCOME10 twice; expect the discount to stay `−€1.45` with a 1000 ms timeout). The third test calls `test.fail(!process.env.SHOP_E2E_STRICT, 'the same code can be applied twice')` as its first line, with a comment saying the shop has this bug on purpose and what the switch is for.
- [ ] **Step 2: Run default and strict.** `npm test`: Expected 9 passed (the known-bug test counts as passed because it is expected to fail). `SHOP_E2E_STRICT=1 npx playwright test tests/discounts.spec.ts`: Expected exactly 1 failed, "a discount code applies only once", and `test-results/` holds its `test-failed-1.png`, `video.webm` and `trace.zip` (this is the RED proof for the switch).
- [ ] **Step 3: Commit.** `git add examples/shop-e2e && git commit -m "feat(shop-e2e): add discount tests and a strict switch for the known bug"`.

### Task 4: Checkout tests, the attachment and the flaky switch

**Files:**
- Create: `examples/shop-e2e/src/pages/CheckoutPage.ts`, `tests/checkout.spec.ts`
- Modify: `examples/shop-e2e/src/fixtures.ts` (add `checkout`)

**Interfaces:**
- Consumes: `CatalogPage.addToCart`, `cartBadge` (Task 1).
- Produces: `class CheckoutPage` (`constructor(page: Page)`, `goto(): Promise<void>` (`/#/checkout`), `fillCard(card: string, options?: { email?: string }): Promise<void>` (name "Ada Lovelace", email default `ada@example.com`, expiry `12/30`, CVC `123`), `pay(): Promise<void>` (clicks the button named /Pay/), `thankYou(name: string): Locator` (heading `Thank you, <name>!`), `orderLine: Locator` (text matching `/Order #\d+ is confirmed\. You paid €14\.80\./`), `declined: Locator` (role alert)). Fixture `checkout: CheckoutPage`.

- [ ] **Step 1: Write the tests.** `beforeEach`: catalog, add "Espresso beans, 250 g", `checkout.goto()`. "pays by card and shows the order number": two `test.step()` calls titled exactly "Fill in the card details" and "Pay by card"; after payment it reads the order number from `orderLine` and calls `testInfo.attach('order-number', { body: <the number>, contentType: 'text/plain' })`. "a declined card shows an error and keeps the cart": card `4000 0000 0000 0002`; alert `Your card was declined. Try another card.`; badge `1`; its first line is `if (process.env.SHOP_E2E_FLAKY && testInfo.retry === 0) throw new Error('flaky on purpose: the first attempt fails so the retry decides the result')`. "pays with PayPal": `test.skip(true, "PayPal isn't available in the demo shop yet")`.
- [ ] **Step 2: Run to verify it fails, then implement.** `npx playwright test tests/checkout.spec.ts` fails on the missing fixture; add `CheckoutPage` and the fixture.
- [ ] **Step 3: Run default and flaky.** `npm run typecheck && npm test`: Expected 11 passed, 1 skipped. `SHOP_E2E_FLAKY=1 npx playwright test tests/checkout.spec.ts`: Expected "1 flaky" for the declined-card test, the rest passed.
- [ ] **Step 4: Commit.** `git add examples/shop-e2e && git commit -m "feat(shop-e2e): add checkout tests with an attachment and a flaky switch"`.

### Task 5: Case definitions and the create-cases script

**Files:**
- Create: `examples/shop-e2e/cases/cases.json`, `scripts/create-cases.mjs`

**Interfaces:**
- Produces: `cases/cases.json` = `{ suites: [{ name, description?, cases: [{ title, priority, type, steps: [{ action, expectedResult }] }] }], defects: [{ title, description, severity, tags }] }`.
- `scripts/create-cases.mjs`: reads `TESTOPS_URL`, `TESTOPS_TOKEN`, `TESTOPS_PROJECT_ID`; exits 1 with a message when one is missing; finds suites by `name`, cases by `title` and defects by `title`, creates only what is missing (`POST /projects/{id}/suites`, `/cases` with `suiteId`, `automationStatus: 'TO_BE_AUTOMATED'`, `/defects`), and prints `<case id>  <title>` for every case. Same `call`/`ensure` style as `examples/demo-shop/testops/seed.mjs`.

- [ ] **Step 1: Write `cases.json`.** Suites Catalog (2 cases), Cart (4), Discounts (3), Checkout (3), Regression (1). Case titles are the tests' titles in sentence case ("The catalog lists every product with its price"), except: the checkout card case is "Customer pays by card" (older title, so `--link` leaves it for hand-linking), and Regression holds a second case titled "An unknown code is rejected" (ambiguous with the Discounts one). The steps of the cart-add case have `action` "Add Espresso beans twice and a Ceramic mug" and "Open the cart"; of the card case "Fill in the card details" and "Pay by card"; the other cases get one or two steps with a short `action` and `expectedResult`. One defect: title "A discount code can be applied more than once", severity `HIGH`, tags `["discounts"]`, a one-sentence description.
- [ ] **Step 2: Write the script**, then run it against the local stack. Get a token and the Demo Project's ID through the API (login as `admin@testops.local`, create an API token; list `/workspaces` and its projects, the one with key `DEMO`). `TESTOPS_URL=http://localhost:8080/api/v1 TESTOPS_TOKEN=… TESTOPS_PROJECT_ID=… npm run cases`. Expected: 13 cases printed, `+ suite`/`+ case`/`+ defect` lines on the first run.
- [ ] **Step 3: Run it again.** Expected: no `+` lines; `GET /projects/{id}/cases` still returns 13 cases, `/suites` 5, `/defects` 1. Run with `TESTOPS_TOKEN` unset: Expected exit 1 and the message.
- [ ] **Step 4: Commit.** `git add examples/shop-e2e && git commit -m "feat(shop-e2e): add case definitions and a script that creates them"`.

### Task 6: Dispatch picker (tested)

**Files:**
- Create: `examples/shop-e2e/scripts/pick-from-dispatch.mjs`, `scripts/pick-from-dispatch.test.mjs`

**Interfaces:**
- Produces: `export function pickGrep(payload: { automation_case_ids?: unknown }): string`: keeps the entries of `automation_case_ids` that are strings matching the UUID pattern `^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$` and returns `@testops-(<id>|<id>)(\s|$)`, or `(?!)` when none is left or the field is absent or not an array. CLI: `node scripts/pick-from-dispatch.mjs <event file>` reads the GitHub event JSON, calls `pickGrep(event.client_payload)` and appends `grep=<value>` to the file named by `GITHUB_OUTPUT`, or prints it when that variable is unset.

- [ ] **Step 1: Write the failing tests** (`node:test`, importing `pickGrep`): two valid ids give `@testops-(<a>|<b>)(\s|$)`; an absent field gives `(?!)`; an empty array gives `(?!)`; a payload with `"x') || rm -rf /"`, `42` and one valid id keeps only the valid id; a field that is a string, not an array, gives `(?!)`; the CLI with a temp event file and `GITHUB_OUTPUT` appends the line.
- [ ] **Step 2: Run to verify it fails.** `npm run test:scripts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `pickGrep` and the CLI. The CLI runs only when the file is the entry point (`process.argv[1]` equals this file), so the test can import it.
- [ ] **Step 4: Run.** `npm run test:scripts`. Expected: all pass. `npm run typecheck` still passes (the script is `.mjs`, outside `include`).
- [ ] **Step 5: Commit.** `git add examples/shop-e2e && git commit -m "feat(shop-e2e): add the dispatch picker with tests"`.

### Task 7: Workflows

**Files:**
- Create: `.github/workflows/shop-e2e.yml`
- Modify: `.github/workflows/demo-shop.yml` (the job's `if`)

**Interfaces:**
- Consumes: `npm run typecheck`, `npm run test:scripts`, `scripts/pick-from-dispatch.mjs` (Task 6).

- [ ] **Step 1: Write `shop-e2e.yml`** following `.github/workflows/demo-shop.yml` (same action versions, concurrency, permissions `contents: read`, header comment explaining the dispatch path and the repository variable). Triggers and the job steps are as the spec's CI section: paths, `repository_dispatch` `testops.run.started`, `workflow_dispatch`. Job `playwright` has `if: github.event_name != 'repository_dispatch' || github.event.client_payload.project.id == vars.SHOP_E2E_PROJECT_ID`. Steps: checkout, Node 22 with the cache, `npm ci`, typecheck, `npm run test:scripts`, Chromium install, then for dispatch only: link (`npx testops-sync --link --apply` with `TESTOPS_URL` from `client_payload.api_url`, `TESTOPS_PROJECT_ID` from `client_payload.project.id`, `TESTOPS_SYNC_TOKEN`), sync (`npx testops-sync --apply`, same env), pick (`id: pick`, `node scripts/pick-from-dispatch.mjs "$GITHUB_EVENT_PATH"`), then the test step (`--grep` on dispatch, env as in the spec), then the report upload with `if: ${{ !cancelled() }}`.
- [ ] **Step 2: Add the guard to `demo-shop.yml`**: `if: github.event_name != 'repository_dispatch' || github.event.client_payload.project.id != vars.SHOP_E2E_PROJECT_ID` on the `playwright` job, and one comment line saying why. Nothing else changes.
- [ ] **Step 3: Validate.** `actionlint .github/workflows/shop-e2e.yml .github/workflows/demo-shop.yml` if `actionlint` is installed (`command -v actionlint`); otherwise `npx -y yaml-lint .github/workflows/shop-e2e.yml .github/workflows/demo-shop.yml`. Expected: no errors. Read both `if` expressions once more: for an unset variable, a dispatch is ignored by `shop-e2e.yml` and run by `demo-shop.yml`; for a matching project, the reverse.
- [ ] **Step 4: Commit.** `git add .github/workflows/shop-e2e.yml .github/workflows/demo-shop.yml && git commit -m "ci(shop-e2e): run the e2e framework from push, pull request and TestOps dispatch"`.

### Task 8: README

**Files:**
- Create: `examples/shop-e2e/README.md`

- [ ] **Step 1: Write the README** (English): what this is and how it differs from `demo-shop`; layout; running the tests; the two switches; the first-run flow in order (create the project's cases with `npm run cases`, `npx testops-sync --link` dry run, `--link --apply`, hand-link what is listed as unmatched or ambiguous, `npx testops-sync --apply`, `npm test` with the `TESTOPS_*` variables); the tests and what each shows (the spec's table, shortened); the CI section (repository secrets `TESTOPS_TOKEN`, `TESTOPS_SYNC_TOKEN`, variable `SHOP_E2E_PROJECT_ID`, the webhook URL and headers as in demo-shop's README, why the variable exists, why a title mismatch means the test does not run in CI). Link `../demo-shop/README.md` and `../../packages/reporter/README.md` instead of repeating their reference tables.
- [ ] **Step 2: Check.** Every command in the README was run in Tasks 1 to 6, or is one of the `testops-sync` commands that Task 9 runs. Search the file for the name of the reference tool: Expected: none.
- [ ] **Step 3: Commit.** `git add examples/shop-e2e/README.md && git commit -m "docs(shop-e2e): document the framework and its first-run flow"`.

### Task 9: Verify the flow on the local stack

Not a code task: the output is a findings list for the user. Scratch files go in the session scratchpad, never in the repo. Start with `git status --short` so the later cleanup can be checked against it.

**Files:**
- Modify: `packages/reporter/**` only for a confirmed defect, test first, one commit per fix (`fix(reporter): …`). A fix that needs more than about 50 lines or a design choice: stop and ask the user.

- [ ] **Step 1: Link.** From `examples/shop-e2e` with `TESTOPS_URL`, `TESTOPS_TOKEN` (Automation or Tester), `TESTOPS_SYNC_TOKEN`, `TESTOPS_PROJECT_ID` set against the local stack: `npx testops-sync` (dry), `npx testops-sync --link`, then `--link --apply`. Expected: the exact-title tests get `testops('<id>')` written, including those declared with fixtures; "pays by card…" is listed as unmatched or only suggested, and "an unknown code is rejected" as ambiguous; no other file changes. Add the missing IDs by hand (the duplicate case's Discounts ID; the card case's ID); add the defect title as the second argument of the known-bug test's `testops()` call.
- [ ] **Step 2: Sync.** `npx testops-sync --apply`. Expected: the card case is renamed to the test's title, the linked cases become Automated, nothing else changes.
- [ ] **Step 3: Run without a run ID.** `npm test` with the `TESTOPS_*` variables. Expected: a new completed run in the Demo Project, 11 passed and 1 skipped with the skip reason, step results on the two cases with steps, durations.
- [ ] **Step 4: Run with failures.** `SHOP_E2E_STRICT=1 SHOP_E2E_FLAKY=1 TESTOPS_ATTACHMENTS=all npm test`. Expected: a second run; the known-bug test Failed with screenshot, video, trace and logs and linked to the defect; only the last attempt of the declined-card test; the `order-number` attachment; every case's history shows both runs.
- [ ] **Step 5: CI path without GitHub.** Restart the app container with `WEBHOOK_ALLOW_PRIVATE_NETWORKS=true`, run a scratch receiver that saves each request's body and `x-testops-signature-256`, and set the Demo Project's webhook to it in the Integrations page (webhook tab). Put the cases to run into a plan with execution mode Automation and start the run. Feed the saved body through the job's steps by hand with `GITHUB_EVENT_PATH` and `GITHUB_OUTPUT`: link, sync, `node scripts/pick-from-dispatch.mjs`, then `npx playwright test --grep "<picked>"` with `TESTOPS_RUN_ID` and the `TESTOPS_*` variables taken from the payload as the workflow does. Expected: the results land in the run TestOps started, only its cases ran, the run stays open for manual cases. Check the signature with the webhook's secret.
- [ ] **Step 6: Clean up.** `git checkout -- examples/shop-e2e/tests` (drops the written IDs), restore the app container's environment, delete the scratch receiver, and confirm `git status --short` matches the starting list.
- [ ] **Step 7: Report.** Findings to the user in Turkish: what worked, every defect found and its fix commit, and what could not be verified (the real GitHub Actions run).
