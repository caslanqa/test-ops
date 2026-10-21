import { createReporterClient } from './core.js';

const stripAnsi = (text) => text.replace(/\u001b\[[0-9;]*m/g, '');
const COMMENT_MAX = 10_000;

function annotation(test, result, type) {
  return [...(test.annotations ?? []), ...(result.annotations ?? [])]
    .find((item) => item.type === type)?.description;
}

function outcome(test, result) {
  const knownIssue = test.expectedStatus === 'failed';
  const errors = (result.errors ?? [])
    .map((error) => stripAnsi(error.message ?? error.value ?? ''))
    .filter(Boolean)
    .join('\n\n');

  switch (result.status) {
    case 'passed':
      if (knownIssue) return { status: 'PASSED', comment: 'Marked as a known failure, but it passed: the bug may be fixed.' };
      return {
        status: 'PASSED',
        comment: test.results.length > 1 ? `Passed on retry ${test.results.length - 1}.` : undefined,
      };
    case 'failed':
    case 'timedOut': {
      const knownIssueComment = knownIssue ? `Known issue: ${annotation(test, result, 'fail') ?? 'expected to fail'}.\n\n` : '';
      return { status: 'FAILED', comment: `${knownIssueComment}${errors}`.slice(0, COMMENT_MAX) || undefined };
    }
    case 'skipped':
      return { status: 'SKIPPED', comment: annotation(test, result, 'skip') };
    default:
      return null;
  }
}

export function testops(testCaseId, defectTitle) {
  const id = typeof testCaseId === 'string' ? testCaseId.trim() : '';
  if (!id) return { annotation: [] };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new TypeError('A TestOps test ID must be a UUID copied from the test case details.');
  }
  return {
    tag: `@testops-${id}`,
    annotation: [
      { type: 'testops', description: id },
      ...(defectTitle ? [{ type: 'testops-defect', description: defectTitle }] : []),
    ],
  };
}

export default class TestOpsReporter {
  constructor(options = {}) {
    this.options = options;
    this.suite = undefined;
    this.client = undefined;
    this.configurationError = undefined;
  }

  printsToStdio() {
    return false;
  }

  onBegin(_config, suite) {
    this.suite = suite;
    try {
      this.client = createReporterClient(this.options);
      if (!this.client) {
        console.log('TestOps: not configured; results stay in the local Playwright report.');
      }
    } catch (error) {
      this.configurationError = error;
    }
  }

  async onEnd() {
    if (this.configurationError) {
      console.error(`TestOps: ${this.configurationError.message}`);
      return { status: 'failed' };
    }
    if (!this.client || !this.suite) return;

    try {
      const results = [];
      for (const test of this.suite.allTests()) {
        const result = test.results.at(-1);
        if (!result) continue;
        const mapped = outcome(test, result);
        if (!mapped) continue;
        const testCaseId = annotation(test, result, 'testops');
        const title = test.titlePath().filter(Boolean).join(' › ');
        results.push({
          testCaseId,
          title,
          status: mapped.status,
          comment: mapped.comment,
          // TestCase.id is stable between retries and distinct for Playwright project variants.
          externalTestId: test.id,
          startedAt: result.startTime?.toISOString(),
          endedAt: result.startTime
            ? new Date(result.startTime.getTime() + result.duration).toISOString()
            : undefined,
          durationMs: Math.round(result.duration),
          attachments: result.attachments
            .filter((attachment) => attachment.path && attachment.contentType?.startsWith('image/'))
            .map((attachment) => ({ path: attachment.path, contentType: attachment.contentType })),
          defectTitle: annotation(test, result, 'testops-defect'),
        });
      }
      await this.client.report(results, 'Playwright');
    } catch (error) {
      console.error(`TestOps: the results could not be sent. ${error instanceof Error ? error.message : error}`);
      return { status: 'failed' };
    }
  }
}
