import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import shared from './annotation.cjs';
import { ALLOWED_EXTENSIONS, extensionOf } from './artifacts.js';
import { createReporterClient } from './core.js';

const stripAnsi = (text) => text.replace(/\u001b\[[0-9;]*m/g, '');
const COMMENT_MAX = 10_000;

// Extension for an in-memory attachment whose own name has none the server accepts.
// Longest base name given to an in-memory attachment's temp file, well under the 255 bytes a file name may have.
const MAX_BASE_NAME = 100;

const EXTENSION_BY_CONTENT_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'video/webm': 'webm',
  'application/zip': 'zip',
  'text/plain': 'txt',
  'text/html': 'html',
  'application/json': 'json',
};

/** Temp files for artifacts Playwright holds only in memory; created on first use, removed by remove(). */
class ArtifactFiles {
  root;
  count = 0;

  async write(fileName, content) {
    this.root ??= await mkdtemp(join(tmpdir(), 'testops-artifacts-'));
    // One directory per file keeps equal names from overwriting each other.
    const dir = join(this.root, String(this.count++));
    await mkdir(dir);
    const path = join(dir, fileName);
    await writeFile(path, content);
    return path;
  }

  async remove() {
    if (this.root) await rm(this.root, { recursive: true, force: true });
  }
}

/** File name for an in-memory attachment: its own name when that has an allowed extension, else one from its content type. */
function bodyFileName(attachment) {
  const name = (attachment.name || '').replace(/[^\w.\- ]+/g, '_');
  const ownExtension = extensionOf(name);
  const keepsOwnExtension = ALLOWED_EXTENSIONS.has(ownExtension);
  const extension = keepsOwnExtension
    ? ownExtension
    : EXTENSION_BY_CONTENT_TYPE[attachment.contentType?.split(';')[0].trim()];
  // "." and ".." would name a directory, and a long name would not fit the file system.
  const base = (keepsOwnExtension ? name.slice(0, -(ownExtension.length + 1)) : name)
    .replace(/^\.+$/, '')
    .slice(0, MAX_BASE_NAME) || 'attachment';
  return extension ? `${base}.${extension}` : base;
}

/**
 * Everything worth uploading for one attempt: its attachments (video, trace and screenshots included), stdout
 * and stderr. A file that cannot be prepared is skipped with a warning; it never costs the results.
 */
async function collectArtifacts(result, files, title) {
  const artifacts = [];
  const prepare = async (name, write) => {
    try {
      artifacts.push(await write());
    } catch (error) {
      console.warn(`TestOps: skipped attachment "${name}" of "${title}": it could not be prepared (${error instanceof Error ? error.message : error}).`);
    }
  };
  for (const attachment of result.attachments ?? []) {
    if (attachment.path) {
      artifacts.push({ path: attachment.path, contentType: attachment.contentType });
    } else if (attachment.body) {
      await prepare(attachment.name || 'attachment', async () => {
        const name = bodyFileName(attachment);
        return { path: await files.write(name, attachment.body), contentType: attachment.contentType, name };
      });
    }
  }
  for (const [name, chunks] of [['stdout.log', result.stdout], ['stderr.log', result.stderr]]) {
    const text = (chunks ?? []).map((chunk) => (typeof chunk === 'string' ? chunk : chunk.toString('utf8'))).join('');
    if (text) await prepare(name, async () => ({ path: await files.write(name, text), contentType: 'text/plain', name }));
  }
  return artifacts;
}

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

/**
 * The user-defined steps of a result in execution order, nested ones included. Playwright also
 * reports its own steps (expect, page actions, hooks), which are not part of a test's script.
 */
export function collectSteps(steps) {
  const collected = [];
  for (const step of steps) {
    if (step.category === 'test.step') {
      const message = stripAnsi(step.error?.message ?? step.error?.value ?? '');
      collected.push({
        title: step.title,
        status: step.error ? 'FAILED' : 'PASSED',
        ...(message ? { comment: message } : {}),
      });
    }
    collected.push(...collectSteps(step.steps ?? []));
  }
  return collected;
}

export const testops = shared.testops;

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

    const files = new ArtifactFiles();
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
          // Only a linked result is sent, so nothing is prepared for the others.
          attachments: testCaseId && this.client.wantsAttachments(mapped.status) ? await collectArtifacts(result, files, title) : [],
          steps: collectSteps(result.steps ?? []),
          defectTitle: annotation(test, result, 'testops-defect'),
        });
      }
      await this.client.report(results, 'Playwright');
    } catch (error) {
      console.error(`TestOps: the results could not be sent. ${error instanceof Error ? error.message : error}`);
      return { status: 'failed' };
    } finally {
      await files.remove();
    }
  }
}
