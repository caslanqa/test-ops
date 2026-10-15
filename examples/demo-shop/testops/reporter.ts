import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';

/**
 * Sends Playwright results to TestOps, one result per test that is linked to a TestOps case;
 * screenshots of failures go along as attachments, and a failure can be linked to an open defect.
 *
 * Two ways to run:
 *   - Its own run: every `playwright test` becomes a new CI run, completed at the end.
 *   - A run TestOps started (TESTOPS_RUN_ID, from the CI webhook's client_payload.run.id): the
 *     results go into that run, only for its cases set to Automation, and the run stays open for
 *     the manual cases. The run gets a link to the CI job.
 *
 * Settings (environment variables):
 *   TESTOPS_URL          the API base, e.g. https://testops.example.com/api/v1
 *   TESTOPS_TOKEN        an API token (Account → API tokens) of someone who may record results
 *   TESTOPS_PROJECT_ID   the project's id
 *   TESTOPS_RUN_ID       optional: report into this run instead of starting one
 *   TESTOPS_RUN_TITLE    optional: "Playwright – <branch> @ <commit>" on GitHub Actions, else "Playwright – local"
 *   TESTOPS_ENVIRONMENT  optional: "CI" on CI, else "local"
 * Without the first three it does nothing, so the tests run the same with or without TestOps.
 *
 * Linking: a test carries the annotation { type: 'testops', description: '<key>' } (see
 * tests/shop.ts) and the case has the tag `e2e:<key>`. Tests without a matching case are listed and
 * left out; TestOps doesn't create cases from results yet. An annotation
 * { type: 'testops-defect', description: '<defect title>' } links a failure to that open defect.
 */

type ResultStatus = 'PASSED' | 'FAILED' | 'SKIPPED';

interface Settings {
  api: string;
  token: string;
  projectId: string;
  /** A run TestOps started, to report into; otherwise a new run is made. */
  runId: string | null;
}

interface TestOpsRun {
  id: string;
  runCases: { testCaseId: string; executionMode: 'MANUAL' | 'AUTOMATED' }[];
}

interface TestOpsCase {
  id: string;
  tags: string[];
}

/** The server keeps up to 10,000 characters of a comment. */
const COMMENT_MAX = 10_000;
const CASE_TAG_PREFIX = 'e2e:';
const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '');

function readSettings(): Settings | null {
  const api = process.env.TESTOPS_URL?.trim().replace(/\/+$/, '');
  const token = process.env.TESTOPS_TOKEN?.trim();
  const projectId = process.env.TESTOPS_PROJECT_ID?.trim();
  const runId = process.env.TESTOPS_RUN_ID?.trim() || null;
  return api && token && projectId ? { api, token, projectId, runId } : null;
}

function runTitle(): string {
  if (process.env.TESTOPS_RUN_TITLE) return process.env.TESTOPS_RUN_TITLE;
  const { GITHUB_REF_NAME: branch, GITHUB_SHA: sha } = process.env;
  return branch && sha ? `Playwright – ${branch} @ ${sha.slice(0, 7)}` : 'Playwright – local';
}

/** The link back to the CI job, when there is one. */
function ciLink(): string | undefined {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: id } = process.env;
  return server && repo && id ? `${server}/${repo}/actions/runs/${id}` : undefined;
}

function annotation(test: TestCase, result: TestResult, type: string): string | undefined {
  // Annotations added while the test runs (test.fail(), test.skip()) are on the result.
  return [...test.annotations, ...(result.annotations ?? [])].find((a) => a.type === type)?.description;
}

/** What TestOps should record for the test's last attempt, or null when it didn't finish. */
function outcome(test: TestCase, result: TestResult): { status: ResultStatus; comment?: string } | null {
  const knownIssue = test.expectedStatus === 'failed';
  const errors = result.errors.map((e) => stripAnsi(e.message ?? e.value ?? '')).filter(Boolean).join('\n\n');
  switch (result.status) {
    case 'passed': {
      if (knownIssue) return { status: 'PASSED', comment: 'Marked as a known failure, but it passed: the bug may be fixed.' };
      const retries = test.results.length - 1;
      return { status: 'PASSED', comment: retries > 0 ? `Passed on retry ${retries}.` : undefined };
    }
    case 'failed':
    case 'timedOut': {
      const prefix = knownIssue ? `Known issue: ${annotation(test, result, 'fail') ?? 'expected to fail'}.\n\n` : '';
      return { status: 'FAILED', comment: (prefix + errors).slice(0, COMMENT_MAX) || undefined };
    }
    case 'skipped':
      return { status: 'SKIPPED', comment: annotation(test, result, 'skip') };
    default:
      return null;
  }
}

export default class TestOpsReporter implements Reporter {
  private readonly settings = readSettings();
  private suite?: Suite;

  printsToStdio() {
    return false;
  }

  onBegin(_config: unknown, suite: Suite) {
    this.suite = suite;
    if (!this.settings) {
      console.log('TestOps: TESTOPS_URL, TESTOPS_TOKEN or TESTOPS_PROJECT_ID is not set; the results stay local.');
    }
  }

  async onEnd(_result: FullResult): Promise<{ status?: FullResult['status'] } | undefined> {
    if (!this.settings || !this.suite) return;
    try {
      await this.send(this.settings, this.suite);
    } catch (err) {
      // A configured upload that fails fails the run, so CI doesn't hide it.
      console.error(`TestOps: the results could not be sent. ${err instanceof Error ? err.message : err}`);
      return { status: 'failed' };
    }
  }

  private async send(settings: Settings, suite: Suite) {
    const call = async <T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> => {
      const res = await fetch(`${settings.api}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${settings.token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${text.slice(0, 500)}`);
      return (text ? JSON.parse(text) : undefined) as T;
    };
    const project = `/projects/${settings.projectId}`;

    // Cases by their e2e: tag.
    const cases = await call<TestOpsCase[]>('GET', `${project}/cases`);
    const caseByKey = new Map<string, string>();
    for (const c of cases) {
      for (const tag of c.tags) {
        if (tag.startsWith(CASE_TAG_PREFIX)) caseByKey.set(tag.slice(CASE_TAG_PREFIX.length), c.id);
      }
    }

    // Reporting into a run TestOps started: only its cases that automation runs take results.
    const existing = settings.runId ? await call<TestOpsRun>('GET', `${project}/runs/${settings.runId}`) : null;
    const forAutomation = existing
      ? new Set(existing.runCases.filter((rc) => rc.executionMode === 'AUTOMATED').map((rc) => rc.testCaseId))
      : null;

    const linked: { test: TestCase; result: TestResult; caseId: string; status: ResultStatus; comment?: string }[] = [];
    const unlinked: string[] = [];
    const outsideRun: string[] = [];
    for (const test of suite.allTests()) {
      const result = test.results.at(-1);
      if (!result) continue;
      const found = outcome(test, result);
      if (!found) continue;
      const key = test.annotations.find((a) => a.type === 'testops')?.description;
      const caseId = key ? caseByKey.get(key) : undefined;
      if (!caseId) unlinked.push(`${test.title}${key ? ` (no case tagged ${CASE_TAG_PREFIX}${key})` : ' (no testops annotation)'}`);
      else if (forAutomation && !forAutomation.has(caseId)) outsideRun.push(test.title);
      else linked.push({ test, result, caseId, ...found });
    }
    if (linked.length === 0) {
      console.log(existing ? "TestOps: no test belongs to the run's automated cases; nothing was sent." : 'TestOps: no test is linked to a case, so no run was created.');
      return;
    }

    const run =
      existing ??
      (await call<{ id: string }>('POST', `${project}/runs`, {
        title: runTitle(),
        description: ciLink() ? `Playwright run on GitHub Actions: ${ciLink()}` : undefined,
        source: 'CI',
        environment: process.env.TESTOPS_ENVIRONMENT ?? (process.env.CI ? 'CI' : 'local'),
        build: process.env.GITHUB_SHA?.slice(0, 12),
        testCaseIds: [...new Set(linked.map((l) => l.caseId))],
      }));
    // A run TestOps started links to the CI job that ran its automated cases.
    if (existing && ciLink()) {
      await call('PATCH', `${project}/runs/${run.id}`, { externalLinkType: 'GitHub Actions', externalLinkRef: ciLink() });
    }

    // One request for all results; the answer keeps their order.
    const { results } = await call<{ results: { id: string }[] }>('POST', `${project}/runs/${run.id}/results/bulk`, {
      results: linked.map(({ test, result, caseId, status, comment }) => ({
        testCaseId: caseId,
        status,
        source: 'AUTOMATION',
        automationSourceLabel: 'Playwright',
        externalTestId: test.titlePath().filter(Boolean).join(' › '),
        comment,
        durationMs: Math.round(result.duration),
        startedAt: result.startTime.toISOString(),
        endedAt: new Date(result.startTime.getTime() + result.duration).toISOString(),
      })),
    });

    // Screenshots of failures, then the links from failures to their known defects.
    let openDefects: { id: string; title: string }[] | null = null;
    for (const [index, { test, result, status }] of linked.entries()) {
      if (status !== 'FAILED') continue;
      const resultId = results[index].id;
      const screenshots = result.attachments.filter((a) => a.path && a.contentType.startsWith('image/'));
      if (screenshots.length > 0) {
        const form = new FormData();
        for (const shot of screenshots) {
          const bytes = new Uint8Array(await readFile(shot.path!));
          form.append('files', new Blob([bytes], { type: shot.contentType }), basename(shot.path!));
        }
        await call('POST', `${project}/results/${resultId}/attachments`, undefined, form);
      }
      const defectTitle = annotation(test, result, 'testops-defect');
      if (defectTitle) {
        openDefects ??= [
          ...(await call<{ id: string; title: string }[]>('GET', `${project}/defects?status=OPEN`)),
          ...(await call<{ id: string; title: string }[]>('GET', `${project}/defects?status=IN_PROGRESS`)),
        ];
        const defect = openDefects.find((d) => d.title === defectTitle);
        if (defect) await call('POST', `${project}/defects/${defect.id}/results`, { resultIds: [resultId] });
        else console.log(`TestOps: no open defect is titled "${defectTitle}"; "${test.title}" was not linked.`);
      }
    }

    // A run of its own is done; a run TestOps started stays open for its manual cases.
    if (!existing) await call('POST', `${project}/runs/${run.id}/complete`);
    const web = settings.api.replace(/\/api\/v\d+$/, '');
    const count = `${linked.length} ${linked.length === 1 ? 'result' : 'results'}`;
    console.log(`TestOps: ${count} sent to ${web}${project}/runs/${run.id}`);
    if (unlinked.length > 0) console.log(`TestOps: not linked to a case: ${unlinked.join('; ')}`);
    if (outsideRun.length > 0) console.log(`TestOps: not among the run's automated cases: ${outsideRun.join('; ')}`);
  }
}
