import { Link } from 'react-router-dom';
import { CodeSample } from './CodeSample';

const workflowTrigger = `on:
  repository_dispatch:
    types: [testops.run.started]
# github.event.client_payload.run.id        the run to report to
# github.event.client_payload.api_url       the TestOps API
# github.event.client_payload.automation_case_ids  TestOps IDs of its automated cases`;

/** TestOps → CI: the values to put into the CI webhook so that a run starts a GitHub Actions workflow. */
export function GithubActionsGuide() {
  return (
    <section className="surface integrations-section" aria-labelledby="github-heading">
      <h2 id="github-heading" className="section-title">GitHub Actions</h2>
      <p className="muted">
        Enter these values in the form on the <Link to={{ search: '?tab=webhook' }} replace>CI webhook</Link> tab.
      </p>
      <ol className="prose-list">
        <li>
          URL: <code>https://api.github.com/repos/OWNER/REPO/dispatches</code>
        </li>
        <li>
          Headers: <code>Authorization: Bearer &lt;token&gt;</code> (a fine-grained token for that repository with
          Contents: read and write) and <code>Accept: application/vnd.github+json</code>. The{' '}
          <strong>Headers for GitHub</strong> button in the form adds both.
        </li>
        <li>
          In the workflow, start on the event; the payload carries the run and the cases to run:
          <CodeSample title="Workflow trigger" text={workflowTrigger} copyLabel="workflow trigger" />
        </li>
      </ol>
    </section>
  );
}
