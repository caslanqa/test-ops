# `@testops/reporter`

Playwright reporter for sending automated test results to the TestOps REST API. The package contains
a framework-neutral result contract in `@testops/reporter/core`; future Cucumber, Cypress and JUnit
adapters can map their framework events to the same client and API behavior.

## Install

```bash
npm install --save-dev @testops/reporter
```

The project should already have `@playwright/test` installed; it is a peer dependency.

Add the reporter to `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export default defineConfig({
  reporter: [['list'], ['html', { open: 'never' }], [require.resolve('@testops/reporter')]],
});
```

Set the destination and credentials as environment variables:

```sh
TESTOPS_URL=https://testops.example.com/api/v1
TESTOPS_TOKEN=<api-token>
TESTOPS_PROJECT_ID=<project-id>
```

The token needs a project role that can submit results: Automation, Tester or Admin. If all three
required settings are absent, the reporter leaves results in Playwright's own reporters. If only
some are configured, it fails the Playwright run with a configuration error.

For `testops-sync --apply`, set `TESTOPS_SYNC_TOKEN` to a separate token with the Tester or Admin
role; the normal reporter can keep using an Automation token.

## Link a test to a case

Copy the Test ID from the TestOps case details and pass that ID to `testops()`:

```ts
import { test } from '@playwright/test';
import { testops } from '@testops/reporter';

test('checkout works', testops('550e8400-e29b-41d4-a716-446655440000'), async ({ page }) => {
  // ...
});
```

`testops(testCaseId, defectTitle?)` adds the TestOps case ID annotation, the CI selector tag
`@testops-<id>`, and an optional known-defect annotation. TestOps case IDs are UUIDs. The reporter
submits the exact ID, so case and test titles can change independently.

## Runs and results

With no `TESTOPS_RUN_ID`, the reporter creates a CI run containing the linked cases, uploads results,
and completes the run. With `TESTOPS_RUN_ID`, it writes into that existing run, only accepts cases
in the run whose execution mode is Automation, and leaves the run open for its manual cases. A CI
URL is attached to the run when detected.

The reporter maps passed, failed, timed-out and skipped tests to TestOps results. It reports the
last retry of each test, includes duration and failure details, and can link a failed test to an
existing open defect by title. Results are sent in API-supported batches of up to 500.

Every execution adds an attempt: when the same run is written to again (a second CI job, a rerun),
the earlier results, failed ones included, stay in the case's result history instead of being
replaced. A request that is retried inside one execution is still sent only once.

### Steps

Steps written with `test.step()` are reported against the steps of the linked case as the run holds
them (the case's steps when the run started, which is what TestOps shows results against). A step is
matched to the case step whose text is the same as the step title, ignoring case, extra spaces and a
trailing dot or colon. Repeated titles match case steps in order.

```ts
await test.step('Open the cart', async () => { … });
await test.step('Pay by card', async () => { … });
```

A step that fails is reported as failed, with its error. A step without a matching case step is
named in a warning and not reported; Playwright's own steps (`expect`, page actions, hooks) are never
reported. The case steps themselves are never changed by a test run.

### Artifacts

`TESTOPS_ATTACHMENTS` decides which results get their artifacts uploaded:

| Value | Artifacts of |
|---|---|
| `failed` (default) | failed tests |
| `all` | every reported test |
| `none` | no test |

For those tests the reporter uploads everything Playwright recorded for the reported attempt:
screenshots, video, `trace.zip`, files added with `testInfo.attach()`, and the test's standard
output and error as `stdout.log` and `stderr.log`. Files are sent in requests of at most 20 files and
128 MB. A file larger than 32 MB or of a type the server does not accept is skipped with a warning,
as is a file that cannot be read or prepared. If the server refuses a request, its files are sent
again one by one, so only the file it still refuses is lost. None of this loses a result or fails the
run.

## Keep test cases in sync

The package installs a `testops-sync` command. It discovers tests with Playwright's `--list` mode
(tests are not executed), then uses each `testops(TestOpsCaseId)` annotation to compare the test
title with that case in the configured project. The sync updates only the case title and sets its
automation status to `AUTOMATED`; descriptions, steps, tags, requirements and cases without an ID
annotation are left alone. It never creates or deletes cases.

Run a dry run locally, then apply the changes:

```sh
npx testops-sync
npx testops-sync --apply
```

### Link tests that have no case ID

`testops-sync --link` looks at the tests without a `testops()` ID and pairs them with the project's
cases by title. It prints a dry run:

```sh
npx testops-sync --link
npx testops-sync --link --apply
```

- A title that matches one case exactly (ignoring case and spacing) and is unique among the tests and
  the cases is an **exact match**.
- Titles shared by several tests or several cases are reported as **ambiguous** and never linked.
- A similar title (most words in common) is only a **suggestion**: add the ID by hand if it is the
  right case.
- Cases that a test already links to are not offered again.

With `--apply`, the ID of each exact match is written into the test: `, testops('<id>')` after the
title, and `import { testops } from '@testops/reporter';` when the file has no such import. The package
is ES-module-only, so this is done only in a project that loads the file as an ES module (`"type":
"module"` in `package.json`, or a `.mjs`/`.mts` file); in any other project the matches are reported
and no file is changed. Only a
test written as `test('title', async () => { … })` (also `test.only`, `test.skip`, `test.fixme` and
`test.fail`) is edited. A test with a details object, a template-literal title, a helper call as its
second argument, or in a file without a top-level `import` is listed with `file:line` for you to
change by hand, and its file is left as it was. Cases are never created or deleted.

`--link` only reads the case list, so a token that can read the project is enough. `--apply` also
updates case titles and automation status, which needs `TESTOPS_SYNC_TOKEN` (see above).

Add `npx testops-sync --apply` before Playwright in CI to keep case metadata in sync when test code
changes. Applying changes requires a Tester or Admin API token; provide it as `TESTOPS_SYNC_TOKEN`.
The result reporter can use a separate `TESTOPS_TOKEN` with the Automation role.

TestOps can start the CI job through a project webhook. Use a workflow that listens for the
`testops.run.started` repository dispatch, selects the requested `@testops-<id>` Playwright tests
from `client_payload.automation_case_ids`, and sets the `TESTOPS_*` variables from
`client_payload`. Store the TestOps API token as a CI secret. The repository's
[demo workflow](https://github.com/caslanqa/test-ops/blob/master/.github/workflows/demo-shop.yml) is
a complete GitHub Actions example.

## Shared adapter contract

The `@testops/reporter/core` subpath accepts normalized `TestOpsResult` records with exact TestOps
case IDs and owns run creation or lookup, bulk submission, attachment upload, defect linking and run
completion. It also exports `syncTestCases` for framework-neutral test metadata sync. Node-based
adapters should only translate native framework results to these contracts; they should not
introduce separate TestOps API implementations. Non-Node integrations can use the same documented
REST endpoints directly.

Package implementation and example: <https://github.com/caslanqa/test-ops/tree/master/examples/demo-shop>.
