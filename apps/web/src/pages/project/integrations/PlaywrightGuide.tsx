import { Link } from 'react-router-dom';
import { CodeSample } from './CodeSample';

const installCommand = 'npm install --save-dev @testops/reporter';

// Naming the package works in ES module and CommonJS projects alike.
const configExample = `import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [['list'], ['html', { open: 'never' }], ['@testops/reporter']],
});`;

const testExample = `import { test } from '@playwright/test';
import { testops } from '@testops/reporter';

test('checkout works', testops('550e8400-e29b-41d4-a716-446655440000'), async ({ page }) => {
  // ...
});`;

/** CI → TestOps: how to send Playwright results to this project, with its URL and ID filled in. */
export function PlaywrightGuide({ projectId, webhookTab }: { projectId: string; webhookTab: boolean }) {
  const environment = `TESTOPS_URL=${window.location.origin}/api/v1
TESTOPS_TOKEN=<CI secret>
TESTOPS_PROJECT_ID=${projectId}
# Optional: report into a run that TestOps started${webhookTab ? ' (see the CI webhook tab)' : ''}
# TESTOPS_RUN_ID=<run-id>
# Optional: which results get screenshots, video, traces and logs: failed (default), all or none
# TESTOPS_ATTACHMENTS=failed
# Optional: a Tester or Admin token, for testops-sync --apply
# TESTOPS_SYNC_TOKEN=<CI secret>`;

  return (
    <section className="surface integrations-section" aria-labelledby="playwright-heading">
      <h2 id="playwright-heading" className="section-title">Playwright test reporter</h2>
      <p className="muted">
        Install the reporter in your Playwright project to send its results to this project. Create an API token on
        the <Link to="/account">Account → API tokens</Link> page and store it as a CI secret with the{' '}
        <strong>Automation</strong> role. Do not commit the token to your repository.
      </p>
      <h3 className="section-subtitle">What it reports</h3>
      <ul className="prose-list">
        <li>The result of each test that is linked to a case. Only the last retry of a test is reported.</li>
        <li>
          The steps written with <code>test.step()</code>, against the case step with the same text (ignoring case and
          spacing).
        </li>
        <li>
          For failed tests: screenshots, video, the trace, files added with <code>testInfo.attach()</code>, and the
          test&rsquo;s output. Traces and logs can hold secrets, and every member of the project can download them.
        </li>
        <li>Every CI execution into a run adds an attempt; the earlier results stay in the case&rsquo;s history.</li>
      </ul>
      <h3 className="section-subtitle">Set it up</h3>
      <ol className="prose-list">
        <li>
          Install the package. <span className="muted">Playwright must already be installed in your project.</span>
          <CodeSample title="Install command" text={installCommand} copyLabel="install command" />
        </li>
        <li>
          Add the reporter to <code>playwright.config.ts</code>:
          <CodeSample title="playwright.config.ts" text={configExample} copyLabel="Playwright reporter configuration" />
        </li>
        <li>
          Open the TestOps case, copy its Test ID from the details panel, and pass that ID to <code>testops()</code>:
          <CodeSample title="Linked Playwright test" text={testExample} copyLabel="linked Playwright test example" />
        </li>
        <li>
          Set these environment variables in your CI job. The URL and project ID are prefilled for this TestOps
          project; keep the result token in your CI secret store:
          <CodeSample title="CI environment" text={environment} copyLabel="CI environment variables" />
        </li>
        <li>
          Run this before Playwright in CI to update linked case titles and mark them as automated when the tests change:
          <CodeSample title="Sync command" text="npx testops-sync --apply" copyLabel="TestOps sync command" />
        </li>
        <li>
          Tests that have no Test ID yet: this lists the cases whose title matches, and with <code>--apply</code> writes
          the IDs into the tests.
          <CodeSample title="Link command" text="npx testops-sync --link" copyLabel="TestOps link command" />
        </li>
      </ol>
      <p className="field-hint">
        Both commands default to a dry run; add <code>--apply</code> to update TestOps or your tests. The sync changes
        only case titles and automation status, by Test ID. The link command writes only tests whose title matches one
        case exactly, and lists the rest; run it without Playwright arguments. Without <code>TESTOPS_RUN_ID</code>,
        each CI execution creates and completes a run. Set it when a job is started by the{' '}
        {webhookTab ? <Link to={{ search: '?tab=webhook' }} replace>CI webhook</Link> : 'CI webhook'} to report into that run; the reporter leaves it
        open for manual cases.
      </p>
    </section>
  );
}
