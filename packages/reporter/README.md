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

## Link a test to a case

Give the TestOps case a tag in the form `e2e:<key>`, then annotate the Playwright test with the same
key:

```ts
import { test } from '@playwright/test';
import { testops } from '@testops/reporter';

test('checkout works', testops('checkout-card'), async ({ page }) => {
  // ...
});
```

`testops(key, defectTitle?)` adds the `testops` annotation, the CI selector tag `@<key>`, and an
optional known-defect annotation. The key accepts letters, digits, dots, underscores and hyphens.
The tag keeps a test linked to its case when either title is renamed.

## Runs and results

With no `TESTOPS_RUN_ID`, the reporter creates a CI run containing the linked cases, uploads results,
and completes the run. With `TESTOPS_RUN_ID`, it writes into that existing run, only accepts cases
in the run whose execution mode is Automation, and leaves the run open for its manual cases. A CI
URL is attached to the run when detected.

The reporter maps passed, failed, timed-out and skipped tests to TestOps results. It reports the
last retry, records a stable Playwright test ID for safe result re-sends, includes duration and
failure details, uploads failure screenshots, and can link a failed test to an existing open defect
by title. Results are sent in API-supported batches of up to 500.

TestOps can start the CI job through a project webhook. Use a workflow that listens for the
`testops.run.started` repository dispatch, selects the requested `@<key>` Playwright tests from
`client_payload.automation_keys`, and sets the `TESTOPS_*` variables from `client_payload`. Store
the TestOps API token as a CI secret. The repository's [demo workflow](https://github.com/caslanqa/test-ops/blob/master/.github/workflows/demo-shop.yml)
is a complete GitHub Actions example.

## Shared adapter contract

The `@testops/reporter/core` subpath accepts normalized `TestOpsResult` records and owns case
resolution, run creation or lookup, bulk submission, attachment upload, defect linking and run
completion. Node-based adapters should only translate native framework results to this shape; they
should not introduce separate TestOps API implementations. Non-Node integrations can use the same
documented REST endpoints directly.

Package implementation and example: <https://github.com/caslanqa/test-ops/tree/master/examples/demo-shop>.
