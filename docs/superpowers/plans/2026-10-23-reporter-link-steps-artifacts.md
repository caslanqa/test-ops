# Reporter: case linking, step results, artifacts and run history — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@testops/reporter` appends one attempt per execution to a run, reports Playwright steps and all artifact types, and `testops-sync --link` writes case IDs into tests that have none.

**Architecture:** Pure logic goes into three new modules next to `core.js` (`match.js`, `artifacts.js`, `link.js`); `core.js` (client) and `reporter.js` (Playwright adapter) only wire them in. No backend change: everything uses existing endpoints.

**Tech Stack:** Node >=20 ESM, no new dependencies, `node --test` for tests, Playwright reporter API (peer `>=1.40`).

**Spec:** `docs/superpowers/specs/2026-10-23-reporter-link-steps-artifacts-design.md`

## Global Constraints

- Node `>=20`, ESM only, **no new dependency**; tests use `node:test` and `node:assert/strict`.
- All repo content is English (code, comments, docs, tests, commits, PR). Never name the reference tool the feature was modeled on; say "the reference tool" if it must be mentioned.
- No API or Prisma change. TestOps case IDs are UUIDs and stay the only case reference in code.
- `externalTestId` sent to the API is `<adapter externalTestId>:<executionId>`; `executionId` is one `crypto.randomUUID()` per client.
- Server limits to respect: 32 MB per file, 128 MB and 20 files per attachment request, 500 results per bulk request, 200 `stepResults` per result, step comment 2000 characters, result comment 10000 characters.
- Attachment extension allow list (server default): `png jpg jpeg gif webp bmp mp4 webm mov txt log md csv json har xml html htm pdf zip gz tgz tar`.
- Artifact and step problems warn with `console.warn('TestOps: …')` and never lose a result or fail the run.
- Every new runtime module must be listed in `packages/reporter/package.json` `files` and checked by the `build` script.
- Commands run from `packages/reporter` unless stated. Commit messages follow the repo style (`feat(reporter): …`).

## Review Focus

- The same test discovered under two Playwright projects (chromium and firefox) is linked once, not edited twice. (Task 6, 8)
- Several tests in one file are linked in one pass and CRLF files keep their line endings. (Task 7)
- A title with an escaped quote, non-ASCII characters, a template literal or a details object is never mangled: the file stays byte-identical and the test is reported. (Task 7)
- A TestOps case title shared by two cases, or a test title shared by two tests, never produces a link. (Task 6)
- A missing, oversize or disallowed-extension artifact, a failing upload and a failing `GET /cases` each warn and the result is still sent. (Task 2, 4)
- Temp files for body-only attachments and stdout/stderr are removed even when sending fails, and nothing is written for results the policy skips. (Task 5)
- A published package missing a new module breaks consumers: `npm pack` must list every runtime file. (Task 9)

---

### Task 1: Test harness and run history

**Files:**
- Modify: `packages/reporter/core.js` (constructor, bulk body in `report`)
- Modify: `packages/reporter/package.json` (`scripts.test`)
- Modify: `.github/workflows/ci.yml` (run tests after the reporter build step)
- Create: `packages/reporter/test/helpers.js`, `packages/reporter/test/history.test.js`

**Interfaces:**
- Produces (`test/helpers.js`), used by every later task:
  - `fakeFetch(routes: Record<string, (request: { method: string; path: string; body?: unknown; form?: FormData }) => unknown | { status: number; body?: unknown }>): { fetch: typeof fetch; calls: Array<{ method: string; path: string; body?: unknown; form?: FormData }> }` — route keys are `"METHOD /path"` relative to the API base (`/projects/p/cases`); a plain return value is a 200 JSON response; an unknown route throws.
  - `captureConsole(): { logs: string[]; warnings: string[]; restore(): void }`
  - `testClient(fetch, overrides?: object): ReturnType<typeof createReporterClient>` — settings `apiUrl: 'https://t.example/api/v1'`, `token: 't'`, `projectId: 'p'`, merged with `overrides`.
- Produces: `TestOpsClient.executionId: string`.

- [ ] **Step 1: Write the failing tests** in `test/history.test.js`: `two executions into one run send different externalTestId values` (two `testClient` instances with `runId: 'r1'`, routes for `GET /projects/p/runs/r1` returning `{ id: 'r1', runCases: [{ testCaseId: 'c1', executionMode: 'AUTOMATED' }] }` and `POST /projects/p/runs/r1/results/bulk` returning `{ results: [{ id: 'x' }] }`; assert the two bulk bodies' `externalTestId` differ and both start with `t1:`), and `a retried bulk request keeps the same externalTestId` (first bulk call answers `{ status: 503 }`, second succeeds; assert both bodies carry the identical `externalTestId`).
- [ ] **Step 2: Run to verify failure:** `node --test test/history.test.js` — Expected: FAIL (ids are equal / no `:` suffix).
- [ ] **Step 3: Implement.** In `TestOpsClient` constructor set `this.executionId = randomUUID()` (`node:crypto`); in `report` build the bulk item's `externalTestId` as `` `${result.externalTestId}:${this.executionId}` ``. Add `"test": "node --test"` to `package.json` scripts. In `ci.yml` add a step `Test TestOps reporter package` running `pnpm --filter @testops/reporter run test` right after the `Build TestOps reporter package` step.
- [ ] **Step 4: Run to verify pass:** `node --test` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/reporter .github/workflows/ci.yml
git commit -m "feat(reporter): add one attempt per execution to a run's history"
```

### Task 2: Step matching in the client

**Files:**
- Create: `packages/reporter/match.js`, `packages/reporter/test/match.test.js`, `packages/reporter/test/report-steps.test.js`
- Modify: `packages/reporter/core.js` (`report`), `packages/reporter/core.d.ts`

**Interfaces:**
- Consumes: `fakeFetch`, `captureConsole`, `testClient` (Task 1).
- Produces (`match.js`):
  - `normalizeTitle(title: string): string` — lowercase, collapse whitespace, trim, drop trailing `.` or `:`.
  - `matchSteps(steps: TestOpsStep[], caseSteps: Array<{ position: number; action: string }>): { stepResults: Array<{ stepPosition: number; status: 'PASSED' | 'FAILED'; comment?: string }>; unmatched: string[] }`
  - `STEP_RESULTS_MAX = 200`, `STEP_COMMENT_MAX = 2000`.
- Produces (`core.d.ts`): `TestOpsStep { title: string; status: 'PASSED' | 'FAILED'; comment?: string }` and `TestOpsResult.steps?: TestOpsStep[]`.

- [ ] **Step 1: Write failing tests.** `match.test.js`: `normalizeTitle lowercases, collapses whitespace and drops a trailing dot or colon`; `matchSteps returns the case step position for a title match`; `repeated titles match case steps in order`; `steps without a case step are returned in unmatched`; `a step comment is cut to 2000 characters`; `no more than 200 step results are returned`. `report-steps.test.js` (fake routes for run, bulk, `GET /projects/p/cases` returning one case with two steps): `matched steps are sent as stepResults and the case list is fetched once for several results`; `unmatched steps warn and the result is still sent`; `a failing GET /cases warns and the result is sent without stepResults`; `GET /cases is not requested when no result has steps`.
- [ ] **Step 2: Run to verify failure:** `node --test test/match.test.js test/report-steps.test.js` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `match.js` per the interfaces (a case step is consumed once; a failed step keeps its comment). In `report`, when any linked result has `steps?.length`, fetch `GET ${projectPath}/cases` once (retryable) inside try/catch, build `Map<caseId, steps>`, call `matchSteps` per result, add `stepResults` to the bulk item (omit when empty) and warn with `shortList(unmatched)` per test that has unmatched steps. Extend `core.d.ts`.
- [ ] **Step 4: Run to verify pass:** `node --test` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/reporter
git commit -m "feat(reporter): report test steps matched to case steps by title"
```

### Task 3: Collect Playwright steps

**Files:**
- Modify: `packages/reporter/reporter.js`
- Modify: `packages/reporter/test/helpers.js` (add reporter fakes)
- Create: `packages/reporter/test/collect-steps.test.js`, `packages/reporter/test/reporter.test.js`

**Interfaces:**
- Consumes: `TestOpsStep` (Task 2).
- Produces: `export function collectSteps(steps: PlaywrightStepLike[]): TestOpsStep[]` from `reporter.js`, where `PlaywrightStepLike = { category: string; title: string; error?: { message?: string; value?: string }; steps: PlaywrightStepLike[] }`; depth first, only `category === 'test.step'`, `FAILED` when `error` is set, comment = ANSI-stripped message.
- Produces (`test/helpers.js`): `fakeTest(spec: { id: string; title?: string; testCaseId?: string; results: Array<{ status: string; duration?: number; steps?: PlaywrightStepLike[]; attachments?: Array<{ name: string; contentType: string; path?: string; body?: Buffer }>; stdout?: Array<string | Buffer>; stderr?: Array<string | Buffer>; errors?: Array<{ message: string }> }> })` returning a Playwright-`TestCase`-shaped object (`id`, `titlePath()`, `annotations`, `expectedStatus: 'passed'`, `results` with `startTime` and `duration` filled in), and `fakeSuite(tests)` returning `{ allTests(): tests }`.

- [ ] **Step 1: Write failing tests.** `collect-steps.test.js`: `keeps only test.step steps and drops expect and pw:api steps`; `walks nested steps depth first`; `a step with an error is FAILED with the ANSI-stripped message`. `reporter.test.js`: `onEnd sends the collected steps with the last retry's result` (drive `new TestOpsReporter({ apiUrl, token, projectId })` with `globalThis.fetch` replaced by `fakeFetch`, restoring it in `finally`; assert the bulk body carries `stepResults` from the last retry only).
- [ ] **Step 2: Run to verify failure:** `node --test test/collect-steps.test.js test/reporter.test.js` — Expected: FAIL (`collectSteps` is not exported).
- [ ] **Step 3: Implement** `collectSteps` and add `steps: collectSteps(result.steps ?? [])` to the result objects built in `onEnd`.
- [ ] **Step 4: Run to verify pass:** `node --test` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/reporter
git commit -m "feat(reporter): collect Playwright test steps for TestOps"
```

### Task 4: Artifact policy, limits and upload in the client

**Files:**
- Create: `packages/reporter/artifacts.js`, `packages/reporter/test/artifacts.test.js`, `packages/reporter/test/report-attachments.test.js`
- Modify: `packages/reporter/core.js` (`settingsFrom`, `report`, `uploadAttachments`), `packages/reporter/core.d.ts`

**Interfaces:**
- Produces (`artifacts.js`):
  - `MAX_FILE_BYTES`, `MAX_REQUEST_BYTES`, `MAX_FILES_PER_REQUEST`, `ALLOWED_EXTENSIONS: ReadonlySet<string>` (values from Global Constraints).
  - `parseAttachmentPolicy(value: string | undefined): 'failed' | 'all' | 'none'` — empty or undefined is `'failed'`; anything else throws `Error('TESTOPS_ATTACHMENTS must be failed, all or none.')`.
  - `shouldAttach(policy, status: string): boolean`
  - `skipReason(file: { name: string; size: number }): string | null` — over the size limit, extension not allowed, or no extension.
  - `groupFiles<T extends { size: number }>(files: T[]): T[][]` — preserves order, closes a group at 20 files or when the next file would exceed 128 MB.
- Produces (client): `settings.attachments` (option `attachments`, env `TESTOPS_ATTACHMENTS`); `TestOpsClient.wantsAttachments(status: string): boolean`; `uploadAttachments(resultId: string, attachments: Array<{ path: string; contentType: string; name?: string }>, title: string): Promise<void>`.
- `core.d.ts`: `TestOpsResult.attachments` items gain optional `name`; `ReporterOptions.attachments?: 'failed' | 'all' | 'none'`.

- [ ] **Step 1: Write failing tests.** `artifacts.test.js`: `parseAttachmentPolicy defaults to failed and rejects unknown values`; `shouldAttach follows the policy for PASSED and FAILED`; `skipReason flags oversize, disallowed and extensionless files and accepts trace.zip`; `groupFiles splits at 20 files`; `groupFiles splits before a file that would pass 128 MB`. `report-attachments.test.js` (temp files in a `mkdtemp` directory; an oversize file made with `fs.truncate` to 33 MB): `25 small files are uploaded in two requests of 20 and 5`; `an oversize file and a missing file warn and the others upload`; `a passed result gets no upload under the default policy and uploads under all`; `a failing upload warns and the result is still reported`.
- [ ] **Step 2: Run to verify failure:** `node --test test/artifacts.test.js test/report-attachments.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.** Parse the policy in `settingsFrom`. In `report`, replace the `status === 'FAILED'` gate for uploads with `wantsAttachments(result.status)` (defect linking stays FAILED-only). `uploadAttachments` stats each file, warns `TestOps: skipped attachment "<name>": <reason>.` for skips and unreadable files, groups the rest, sends one multipart request per group (field `files`, file name from `name ?? basename(path)`), and catches a failing group with `TestOps: attachments for "<title>" could not be uploaded. <message>`.
- [ ] **Step 4: Run to verify pass:** `node --test` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/reporter
git commit -m "feat(reporter): upload artifacts by policy within server limits"
```

### Task 5: Playwright artifacts

**Files:**
- Modify: `packages/reporter/reporter.js` (`onEnd`)
- Modify: `packages/reporter/test/reporter.test.js`

**Interfaces:**
- Consumes: `client.wantsAttachments` (Task 4), `fakeTest`/`fakeSuite` (Task 3).
- Produces: in `onEnd`, for each result the client wants artifacts for, `attachments: Array<{ path; contentType; name }>` from all `result.attachments` (path as is; body-only written to a temp file) plus `stdout.log` and `stderr.log` when non-empty (chunks may be `string | Buffer`). Temp root is `mkdtemp(join(tmpdir(), 'testops-artifacts-'))`, one subdirectory per test, removed in `finally`.

- [ ] **Step 1: Write failing tests** in `reporter.test.js`: `a failed test uploads path attachments of every type` (png, `trace.zip`, `video.webm`); `body-only attachments and stdout and stderr are uploaded as files with the right extensions` (include a `Buffer` stdout chunk); `a passed test under the default policy reads and writes nothing` (assert no `testops-artifacts-*` entry was created in `os.tmpdir()` and no attachment request was made); `only the last retry's attachments are used`; `the temp directory is removed when sending fails` (bulk route answers 500).
- [ ] **Step 2: Run to verify failure:** `node --test test/reporter.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.** Extension for a body-only attachment: from its name when allowed, else from content type (`image/png` png, `image/jpeg` jpg, `video/webm` webm, `application/zip` zip, `text/plain` txt, `text/html` html, `application/json` json), else none (the client then skips it with a warning). Remove the old `image/*` filter.
- [ ] **Step 4: Run to verify pass:** `node --test` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/reporter
git commit -m "feat(reporter): send all Playwright artifacts, stdout and stderr"
```

### Task 6: Match tests to cases by title

**Files:**
- Modify: `packages/reporter/match.js`
- Create: `packages/reporter/test/match-cases.test.js`

**Interfaces:**
- Consumes: `normalizeTitle` (Task 2).
- Produces (`match.js`):
  - `SUGGESTION_MIN_SCORE = 0.6`
  - `type Location = { file: string; line: number; column: number }`
  - `dedupeByLocation<T extends { location?: Location }>(tests: T[]): T[]` — keeps the first test per `file:line:column`; tests without a location pass through.
  - `matchTestsToCases(tests: Array<{ title: string; location?: Location }>, cases: Array<{ id: string; title: string }>): { exact: Array<{ test; caseId: string; caseTitle: string }>; suggestions: Array<{ test; caseId: string; caseTitle: string; score: number }>; ambiguous: Array<{ test; reason: string }>; unmatched: Array<test> }`

- [ ] **Step 1: Write failing tests:** `an exact normalized title match is returned when both sides are unique`; `two tests with the same title are ambiguous and not linked`; `two cases with the same title are ambiguous and not linked`; `a near match above 0.6 token overlap is a suggestion, never exact`; `an exact-matched case is never suggested for another test`; `a test with no case above the threshold is unmatched`; `dedupeByLocation collapses Playwright project variants of one test`.
- [ ] **Step 2: Run to verify failure:** `node --test test/match-cases.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.** Group by normalized title on both sides for uniqueness; the score is Jaccard similarity over the sets of whitespace-separated normalized words; each test gets at most its best suggestion.
- [ ] **Step 4: Run to verify pass:** `node --test` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/reporter
git commit -m "feat(reporter): match tests to cases by title for linking"
```

### Task 7: Write case IDs into test source

**Files:**
- Create: `packages/reporter/link.js`, `packages/reporter/test/link.test.js`

**Interfaces:**
- Produces (`link.js`): `linkTestsInSource(source: string, links: Array<{ line: number; column: number; testCaseId: string }>): { source: string; linked: number; skipped: Array<{ line: number; reason: string }> }` and `IMPORT_LINE = "import { testops } from '@testops/reporter';"`. The input string is never mutated; when nothing is linked the returned `source` equals the input.

- [ ] **Step 1: Verify what `test.location` points at.** In `examples/demo-shop` run `npx playwright test --list --reporter=json`, compare `line` and `column` of two tests with the source, and add the result as a comment above the offset helper in `link.js`. The tests below assume 1-based line and column pointing at the `t` of `test`; if verification shows otherwise, change only the offset helper.
- [ ] **Step 2: Write failing tests:** `inserts testops after a plain string title and adds the import before the first import`; `handles test.only, test.skip and test.fixme`; `a test with a details object is skipped with a reason and the file is unchanged`; `a template-literal title is skipped`; `single and double quoted titles with an escaped quote and non-ASCII characters are handled`; `two tests in one file are linked from the bottom up and the expected full output matches`; `CRLF line endings are preserved`; `an existing named import of testops is not duplicated`; `a default-only import from @testops/reporter gets an added named import line`; `a file without a top-level import is skipped entirely with a reason that names the import`; `a location that does not start with test( is skipped`.
- [ ] **Step 3: Run to verify failure:** `node --test test/link.test.js` — Expected: FAIL.
- [ ] **Step 4: Implement** per spec section 4: from the offset require `test`, optional `.only|.skip|.fixme|.fail|.slow`, `(`, a quoted string literal (scan to the closing quote honoring backslash escapes), then `,` and a next token that is not `{` or `)`; insert `, testops('<id>')` after the literal. Apply edits sorted by offset descending, insert `IMPORT_LINE` once before the first `^import\s` line when no named `testops` import from `@testops/reporter` exists, using the file's own line ending.
- [ ] **Step 5: Run to verify pass:** `node --test` — Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add packages/reporter
git commit -m "feat(reporter): insert case IDs into Playwright test source"
```

### Task 8: `testops-sync --link`

**Files:**
- Modify: `packages/reporter/sync-reporter.js`, `packages/reporter/sync-cli.js`, `packages/reporter/core.js` (`syncTests`, `syncTestCases`), `packages/reporter/core.d.ts`, `packages/reporter/index.d.ts`
- Create: `packages/reporter/test/sync-link.test.js`

**Interfaces:**
- Consumes: `dedupeByLocation`, `matchTestsToCases` (Task 6), `linkTestsInSource` (Task 7).
- Produces: `TestOpsSyncTest.location?: { file: string; line: number; column: number }`; `TestOpsSyncOptions.link?: boolean`; `syncTests(inputTests, { apply, link })`; CLI flag `--link` (not forwarded to Playwright); `sync-reporter.js` writes `location: test.location` per test.
- Output lines (prefix `TestOps link:`): one per exact match (`would link` / `linked`), one per suggestion with its score and the manual instruction, one per ambiguous or unlinked test with `file:line`.

- [ ] **Step 1: Write failing tests** in `sync-link.test.js` (real spec files in a temp directory, `fakeFetch` for `GET /projects/p/cases`): `a dry run lists exact matches and suggestions and leaves files unchanged`; `--link --apply writes IDs for exact matches only`; `a case already linked to another test is not offered`; `the link phase runs when the linked tests are already in sync`; `a test whose edit is refused is printed with file:line and its file is unchanged`; `without link nothing changes in how sync behaves`.
- [ ] **Step 2: Run to verify failure:** `node --test test/sync-link.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.** Restructure `syncTests` so the `changes.length === 0` early return no longer skips the link phase. Link phase: unlinked tests (no ID) go through `dedupeByLocation`; candidate cases are the fetched cases not linked by any discovered test (the list endpoint excludes archived cases by default); print the summary; with `apply`, group exact matches by `location.file`, read the file, call `linkTestsInSource`, write the file once only when `linked > 0`, print the skipped entries. Pass `link` through `syncTestCases`; add `--link` handling next to `--apply` in `sync-cli.js`.
- [ ] **Step 4: Run to verify pass:** `node --test` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/reporter
git commit -m "feat(reporter): link tests without an ID to cases with testops-sync --link"
```

### Task 9: Docs, demo step test and packaging

**Files:**
- Modify: `packages/reporter/README.md`, `packages/reporter/package.json` (`files`, `build`), `examples/demo-shop/tests/cart.spec.ts`, `examples/demo-shop/README.md`, `PLAN.md` (one sentence under the reporter item)

- [ ] **Step 1: Packaging.** Add `match.js`, `artifacts.js` and `link.js` to `files` and `node --check` for each to `build`. Run `pnpm --filter @testops/reporter run build` and `cd packages/reporter && npm pack --dry-run`. Expected: the pack list contains every runtime module and no `test/` entry.
- [ ] **Step 2: README.** Document `--link` and `--link --apply` (what is written, which files are refused and reported), step matching by title (include a short `test.step` example), `TESTOPS_ATTACHMENTS` (`failed` default, `all`, `none`; server limits and skipped files), and that each execution into a run adds an attempt while only the last retry of a test is reported.
- [ ] **Step 3: Demo.** In `cart.spec.ts` wrap the body of the `adding products updates the cart badge and the totals` test in two `test.step()` calls titled exactly `Add Espresso beans twice and a Ceramic mug` and `Open the cart` (the `cart-add` case steps in `apps/api/src/demo/demo-shop.json`); add a README note that step titles must equal the case step text. In `PLAN.md` add one sentence to the reporter item naming steps, artifacts, `--link` and run history.
- [ ] **Step 4: Verify.** `cd packages/reporter && node --test` passes; `pnpm --filter @testops/reporter run build` passes; `cd examples/demo-shop && npm run typecheck` passes. If a local TestOps is running, `npx testops-sync --link` in the demo prints a dry-run summary; otherwise the demo workflow run on the PR is the end-to-end check.
- [ ] **Step 5: Commit**

```bash
git add packages/reporter examples/demo-shop PLAN.md
git commit -m "docs(reporter): document linking, steps, artifacts and run history"
```
