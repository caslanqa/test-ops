import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ExternalLink, Info, LifeBuoy, Terminal } from 'lucide-react';
import { api } from '../api/client';
import { CopyButton } from '../components/CopyButton';
import { PageHeader } from '../components/Page';
import { usePageTitle, useResource } from '../lib/useResource';

const REPO_URL = 'https://github.com/caslanqa/test-ops';

interface SystemInfo {
  version: string;
  apiVersion: string;
}

/** Link to another site or to a server-rendered page; tells screen reader users it opens a new tab. */
function ExternalAnchor({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="external-link">
      {children}
      <ExternalLink size={14} aria-hidden="true" />
      <span className="visually-hidden"> (opens in a new tab)</span>
    </a>
  );
}

/** Section card with an icon in its heading; the heading also names the region. */
function SupportSection({
  icon: Icon,
  title,
  area,
  children,
}: {
  icon: typeof Info;
  title: string;
  /** Grid area in .support-grid; the CSS decides the arrangement per screen width. */
  area: 'api' | 'help' | 'ci' | 'about';
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section className={`surface settings-section support-${area}`} aria-labelledby={titleId}>
      <h2 id={titleId} className="section-title support-title">
        <Icon size={18} aria-hidden="true" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function ApiDocsSection({ baseUrl }: { baseUrl: string }) {
  const fieldId = useId();
  return (
    <SupportSection icon={BookOpen} title="API documentation" area="api">
      <p className="muted settings-intro">
        Everything in TestOps is available through a REST API. The interactive reference lists every endpoint
        with its parameters, request bodies and responses, and lets you try requests.
      </p>
      {/* Server-rendered pages, not app routes: plain links instead of router links. */}
      <div className="support-actions">
        <a className="btn btn-primary" href="/api/docs" target="_blank" rel="noopener noreferrer">
          Open API reference
          <ExternalLink size={16} aria-hidden="true" />
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
        <span className="muted support-spec">
          OpenAPI spec for code generators:{' '}
          <ExternalAnchor href="/api/docs-json">JSON</ExternalAnchor>
          {' · '}
          <ExternalAnchor href="/api/docs-yaml">YAML</ExternalAnchor>
        </span>
      </div>
      <div className="field">
        <label htmlFor={fieldId} className="field-label">API base URL</label>
        <div className="copy-field">
          <input id={fieldId} value={baseUrl} readOnly className="mono" onFocus={(e) => e.target.select()} />
          <CopyButton text={baseUrl} what="API base URL" targetId={fieldId} />
        </div>
      </div>
      <p className="field-hint">
        To try requests in the reference, choose <strong>Authorize</strong> and paste an API token.
      </p>
    </SupportSection>
  );
}

function CiSection({ baseUrl }: { baseUrl: string }) {
  const exampleId = useId();
  const example = [
    `curl -X POST "${baseUrl}/projects/<project-id>/runs/<run-id>/results/bulk" \\`,
    '  -H "Authorization: Bearer $TESTOPS_TOKEN" \\',
    '  -H "Content-Type: application/json" \\',
    `  -d '{`,
    '    "results": [',
    '      {',
    '        "testCaseId": "<test-case-id>",',
    '        "status": "PASSED",',
    '        "source": "AUTOMATION",',
    '        "externalTestId": "checkout.spec.ts > pays by card",',
    '        "durationMs": 1840',
    '      }',
    '    ]',
    `  }'`,
  ].join('\n');

  return (
    <SupportSection icon={Terminal} title="Send results from CI" area="ci">
      <ol className="support-steps">
        <li>
          Create an API token on the <Link to="/account">Account</Link> page and store it as a secret in your CI,
          e.g. <code>TESTOPS_TOKEN</code>. Use a dedicated user with the Automation role for this.
        </li>
        <li>
          Open the run the results belong to: its address ends in{' '}
          <code>/projects/&lt;project-id&gt;/runs/&lt;run-id&gt;</code>. Test case IDs are listed by{' '}
          <code>GET /projects/&lt;project-id&gt;/cases</code>.
        </li>
        <li>
          Send the results; a test case that isn't in the run yet is added to it. Status is one of{' '}
          <code>PASSED</code>, <code>FAILED</code>, <code>BLOCKED</code> or <code>SKIPPED</code>; up to 500 results
          per request.
        </li>
      </ol>
      <div className="code-header">
        <span id={`${exampleId}-label`} className="field-label">Example request</span>
        <CopyButton text={example} what="example request" targetId={exampleId} />
      </div>
      {/* Focusable so keyboard users can scroll long lines (WCAG 2.1.1). */}
      <pre
        id={exampleId}
        className="code-block"
        tabIndex={0}
        role="region"
        aria-labelledby={`${exampleId}-label`}
      >
        {example}
      </pre>
      <p className="field-hint">
        Set <code>externalTestId</code> to a stable name of the automated test so a retried request updates the
        result instead of adding a second one.
      </p>
    </SupportSection>
  );
}

function HelpSection() {
  return (
    <SupportSection icon={LifeBuoy} title="Get help" area="help">
      <ul className="support-links">
        <li>
          <ExternalAnchor href={`${REPO_URL}#troubleshooting`}>Troubleshooting guide</ExternalAnchor>
          <span className="muted"> — common installation and startup errors</span>
        </li>
        <li>
          <ExternalAnchor href={`${REPO_URL}#quick-start-recommended`}>Installing and upgrading</ExternalAnchor>
        </li>
        <li>
          <ExternalAnchor href={`${REPO_URL}/issues/new`}>Report a bug or request a feature</ExternalAnchor>
          <span className="muted"> — include the version shown below</span>
        </li>
      </ul>
    </SupportSection>
  );
}

function AboutSection() {
  const { data: info, error } = useResource(() => api.get<SystemInfo>('/system/info'), []);
  const isRelease = info && info.version !== 'dev';
  return (
    <SupportSection icon={Info} title="About this installation" area="about">
      <dl className="meta-list">
        <div>
          <dt>Version</dt>
          <dd>{error ? 'Unavailable' : info ? (isRelease ? info.version : 'Development build') : 'Loading…'}</dd>
        </div>
        <div>
          <dt>API</dt>
          <dd>{info?.apiVersion ?? 'v1'}</dd>
        </div>
      </dl>
      {isRelease && (
        <ExternalAnchor href={`${REPO_URL}/releases/tag/v${info.version}`}>
          What's new in {info.version}
        </ExternalAnchor>
      )}
    </SupportSection>
  );
}

/** Help & support: API documentation, sending results from CI, where to get help and the running version. */
export function SupportPage() {
  usePageTitle('Help & support');
  const baseUrl = `${window.location.origin}/api/v1`;
  return (
    <>
      <PageHeader
        title="Help & support"
        description="API documentation, sending automation results and where to get help."
      />
      <div className="support-grid">
        <ApiDocsSection baseUrl={baseUrl} />
        <HelpSection />
        <CiSection baseUrl={baseUrl} />
        <AboutSection />
      </div>
    </>
  );
}
