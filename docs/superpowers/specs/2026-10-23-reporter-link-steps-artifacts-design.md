# Reporter: case linking, step results, artifacts and run history

Status: draft for owner review. Branch: `feat/playwright-testops-reporter`. Package: `packages/reporter` (`@testops/reporter`).

## Goal

Framework runs (Playwright first) report into TestOps as runs, with the evidence a reviewer needs, and
tests written in the framework can be matched to cases already written in TestOps. Matching always goes
through the TestOps case ID (a UUID).

The package already creates or reuses a run (`TESTOPS_RUN_ID`), submits results in bulk, links defects
and syncs title and automation status by case ID (`testops-sync`). This spec closes four gaps.

## Decisions

| Topic | Decision |
|-------|----------|
| Tests without a case ID | `testops-sync --link` proposes cases by title and, with `--apply`, writes the ID into the test source. It never creates or deletes cases. |
| Step mapping | A Playwright `test.step()` maps to the case step whose `action` has the same normalized title. |
| Artifacts | Every Playwright artifact type, for failed tests only by default; configurable. |
| Case reference in code | The UUID stays. No short case number. |
| Retries | Only the last attempt of a test is reported, as today. |
| Backend | No API or schema change. Everything below uses existing endpoints. |

## Assumption to confirm

"Failed test results must also be added to history" is read as: a later execution into the same run
must not overwrite an earlier failed result. The API treats a re-sent `externalTestId` as an update of the
same result (`results.service.ts`, FR-075), and the reporter currently sends the stable Playwright test ID,
so a second execution into one run replaces the first result and the failure disappears from the run
case's result history. If "history" meant something else (for example the case edit history, which the
sync already feeds through `PATCH /cases/:id`), this section changes and nothing else does.

## Design

### 1. Run history: one attempt per execution

`TestOpsClient` creates one `executionId` (`crypto.randomUUID()`) per process. The `externalTestId` sent
to the API becomes `<adapter externalTestId>:<executionId>`.

- Network retries inside one process resend the same key, so they stay idempotent.
- A later execution into the same run adds a new attempt. The run case status follows the latest attempt
  and the earlier results, failed ones included, stay in the result history.
- Results of every status are appended. Appending only failures would hide a later fix.
- The key is built in `core.js`, so every adapter gets it. Adapters keep supplying a stable per-test ID.

### 2. Step results

The Playwright reporter walks `result.steps` depth first and keeps steps with `category === 'test.step'`
(nested ones included) in execution order.

1. The linked case's steps come from `GET /projects/:id/cases`, which returns every case with its steps
   ordered by `position` and is not paged unless `limit` is passed. It is fetched once per run, and only
   when at least one linked test has user-defined steps.
2. `normalize(title)` lowercases, collapses whitespace, trims and drops trailing `.` or `:`.
3. Each Playwright step is matched to the first not-yet-matched case step with the same normalized
   `action`. A repeated title therefore matches in order.
4. Each match becomes `{ stepPosition: <case step position>, status, comment }` in the result's
   `stepResults`. Status is `FAILED` when the step has an `error`, otherwise `PASSED`. The comment holds
   the error message, cut to 2000 characters.
5. Unmatched Playwright steps and unmatched case steps are not sent. The reporter prints one summary line
   per test with unmatched steps. The API does not validate `stepPosition`, so only positions that exist in
   the case are sent. At most 200 step results are sent per result.

Step-level attachments are out of scope: all artifacts attach to the result (section 3).

### 3. Artifacts

Policy `TESTOPS_ATTACHMENTS` = `failed` (default) | `all` | `none`. It decides which results get artifacts.
Selected results upload:

- `result.attachments`: screenshots, video, `trace.zip`, and anything added with `testInfo.attach`.
  Attachments that carry only a `body` are written to a temporary file named from the attachment name and
  content type, and removed afterwards.
- `result.stdout` and `result.stderr`, written as `stdout.log` and `stderr.log` when non-empty.

Server limits (`attachments.constants.ts`, configurable by the operator): 32 MB per file, 128 MB and 20
files per request, extension allow list. The reporter:

- Skips a file that is over 32 MB, has an extension outside the default allow list, or cannot be read,
  and prints one warning per skipped file. A skipped file never fails the run.
- Groups files into requests of at most 20 files and 128 MB. Today each file is its own request.

The default `failed` keeps today's status filter (failed tests only) and widens the file types from
failure screenshots to all of the above.

### 4. `testops-sync --link`

`testops-sync` discovers tests with `playwright test --list`. The discovery reporter also records
`test.location` (file, line, column). Tests that appear once per Playwright project are deduplicated by
location.

Matching, for tests without a `testops` annotation:

1. Candidate cases are all non-archived cases that no discovered test already links.
2. A test matches a case when their normalized titles are equal and both sides are unique. Duplicates on
   either side are reported and skipped.
3. Near matches (token overlap above a fixed threshold, no exact match) are printed as suggestions only.

Output is a dry run by default, in the same style as `--apply`: exact matches, suggestions, ambiguous and
unmatched tests.

`--link --apply` writes the exact matches into the source. For each file it:

1. Reads the text at the recorded location and requires `test` (optionally followed by `.only`, `.skip`,
   `.fixme`, `.fail` or `.slow`), `(`, then a plain string literal title.
2. Requires that the argument after the title is not an object literal. A test that already has a details
   object is reported with `file:line` for a manual edit.
3. Inserts `, testops('<uuid>')` after the title literal.
4. Adds `import { testops } from '@testops/reporter';` before the first top-level `import` when the file
   has none. A file with no top-level `import` (CommonJS) is reported for a manual edit.

Any file that does not fit these rules is left untouched and reported with `file:line`. Parameterized tests
(a title built from a template literal or a loop) are always reported, never rewritten. Edits within one
file are applied from the bottom up so earlier locations stay valid. `--link` needs `TESTOPS_SYNC_TOKEN`
with Tester or Admin, like `--apply`.

### 5. Configuration

| Variable | Default | Meaning |
|----------|---------|---------|
| `TESTOPS_ATTACHMENTS` | `failed` | `failed`, `all` or `none` (section 3) |
| `TESTOPS_RUN_ID` | unset | Existing run to write into; a new run is created when unset (unchanged) |

Everything else keeps its current meaning. `testops-sync` gets the `--link` flag only.

### 6. Failure behavior

Artifact and step problems warn and never fail the run or lose a result. A result that cannot be sent still
fails the reporter with an error, as today. `--link --apply` never partially edits a file: it computes all
edits for a file first and writes the file once.

## Testing

`node --test` in `packages/reporter` (no new dependency). The client already accepts an injected `fetch`.
Cases to cover:

- title normalization and exact, duplicate, archived-case and near-match decisions;
- source insertion: plain test, `.only`, existing details object (refused), template-literal title
  (refused), CommonJS file (refused), several tests in one file;
- step matching: nested steps, repeated titles, unmatched steps on both sides, 200-step cap;
- artifact selection by policy, body-only attachments, oversize and disallowed-extension skips, grouping by
  file count and size;
- history: two executions into one run produce two distinct `externalTestId` values, a network retry in one
  execution produces the same value.

CI runs the new tests in the existing reporter build step. The demo shop example gets one test with
`test.step()` titles that match its case steps, and the demo workflow's run is the end-to-end check.

## Documentation

`packages/reporter/README.md` (English) documents `--link`, step matching by title, the attachment policy
and the history behavior. The README of the demo shop example gets a short step-naming note.

## Non-goals

- Reporting every retry attempt (`attemptNumber`); only the last is sent.
- Creating cases from tests (FR-017) and writing case steps from `test.step()` titles.
- Step-level attachments.
- A short numeric case ID.
- Other frameworks, JUnit import.

## To verify during implementation

- What `test.location` points at (the `test` identifier or the call) for `test`, `test.only` and
  `test.skip`; the insertion rule in section 4 depends on it.
- `TestResult.stdout` and `stderr` element types (`string | Buffer`) on the minimum supported Playwright
  version (peer range is `>=1.40`); older versions may lack `TestStep.attachments`, which this design does
  not use.
- Whether `GET /cases` payload size is acceptable for the largest demo project; if not, fetch only the
  linked cases.
