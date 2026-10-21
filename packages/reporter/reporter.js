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

export function testops(caseKey, defectTitle) {
  const key = typeof caseKey === 'string' ? caseKey.trim() : '';
  if (!/^[A-Za-z0-9._-]+$/.test(key)) {
    throw new TypeError('A TestOps case key must use letters, digits, dots, underscores or hyphens.');
  }
  return {
    tag: `@${key}`,
    annotation: [
      { type: 'testops', description: key },
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
        const caseKey = annotation(test, result, 'testops');
        const title = test.titlePath().filter(Boolean).join(' › ');
        results.push({
          caseKey,
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
