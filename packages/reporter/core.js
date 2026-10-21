import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const CASE_TAG_PREFIX = 'e2e:';
const COMMENT_MAX = 10_000;
const BULK_MAX = 500;
const REQUEST_TIMEOUT_MS = 30_000;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function ciUrlFromEnvironment(env) {
  if (clean(env.TESTOPS_CI_URL)) return clean(env.TESTOPS_CI_URL);
  if (env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID) {
    return `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  }
  return clean(env.CI_JOB_URL) || clean(env.CI_PIPELINE_URL) || clean(env.BUILDKITE_BUILD_URL) || clean(env.CIRCLE_BUILD_URL) || undefined;
}

function settingsFrom(options, env) {
  const settings = {
    apiUrl: clean(options.apiUrl ?? env.TESTOPS_URL).replace(/\/+$/, ''),
    token: clean(options.token ?? env.TESTOPS_TOKEN),
    projectId: clean(options.projectId ?? env.TESTOPS_PROJECT_ID),
    runId: clean(options.runId ?? env.TESTOPS_RUN_ID) || null,
    runTitle: clean(options.runTitle ?? env.TESTOPS_RUN_TITLE) || undefined,
    environment: clean(options.environment ?? env.TESTOPS_ENVIRONMENT) || (env.CI ? 'CI' : 'local'),
    ciUrl: clean(options.ciUrl ?? env.TESTOPS_CI_URL) || ciUrlFromEnvironment(env),
  };
  const required = [settings.apiUrl, settings.token, settings.projectId];
  if (required.every((value) => !value)) return null;
  if (required.some((value) => !value)) {
    throw new Error('Configure TESTOPS_URL, TESTOPS_TOKEN and TESTOPS_PROJECT_ID together.');
  }
  let parsed;
  try {
    parsed = new URL(settings.apiUrl);
  } catch {
    throw new Error('TESTOPS_URL must be a full URL ending in /api/v1.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('TESTOPS_URL must use HTTP or HTTPS.');
  }
  if (!/\/api\/v\d+$/.test(parsed.pathname.replace(/\/+$/, '')) || parsed.search || parsed.hash) {
    throw new Error('TESTOPS_URL must be the versioned API base, e.g. https://testops.example.com/api/v1.');
  }
  return settings;
}

function shortList(items, limit = 10) {
  const shown = items.slice(0, limit);
  return `${shown.join('; ')}${items.length > limit ? `; and ${items.length - limit} more` : ''}`;
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

class TestOpsClient {
  constructor(settings, fetchImpl = globalThis.fetch, env = process.env) {
    this.settings = settings;
    this.fetch = fetchImpl;
    this.env = env;
    this.projectPath = `/projects/${encodeURIComponent(settings.projectId)}`;
  }

  async request(method, path, body, { form, retryable = false } = {}) {
    const maxAttempts = retryable ? 3 : 1;
    let lastError;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const response = await this.fetch(`${this.settings.apiUrl}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${this.settings.token}`,
            ...(!form && body !== undefined ? { 'content-type': 'application/json' } : {}),
          },
          body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const text = await response.text();
        if (!response.ok) {
          const error = new Error(`${method} ${path} answered ${response.status}: ${text.slice(0, 500)}`);
          error.status = response.status;
          error.retryAfter = response.headers.get('retry-after');
          throw error;
        }
        return text ? JSON.parse(text) : undefined;
      } catch (error) {
        lastError = error;
        const retryableStatus = error?.status === 429 || error?.status >= 500;
        const retryableNetwork = error?.status === undefined;
        if (!retryable || (!retryableStatus && !retryableNetwork) || attempt + 1 >= maxAttempts) throw error;
        const retryAfterMs = Number(error.retryAfter) * 1_000;
        const delay = Number.isFinite(retryAfterMs) && retryAfterMs > 0
          ? Math.min(retryAfterMs, 10_000)
          : 500 * (2 ** attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  }

  async report(inputResults, integrationName = 'Test automation') {
    const cases = await this.request('GET', `${this.projectPath}/cases`);
    const caseIdByKey = new Map();
    const duplicateKeys = new Set();
    for (const testCase of cases) {
      for (const tag of testCase.tags ?? []) {
        if (!tag.startsWith(CASE_TAG_PREFIX)) continue;
        const key = tag.slice(CASE_TAG_PREFIX.length).trim();
        if (!key) continue;
        if (caseIdByKey.has(key) && caseIdByKey.get(key) !== testCase.id) duplicateKeys.add(key);
        else caseIdByKey.set(key, testCase.id);
      }
    }

    const existingRun = this.settings.runId
      ? await this.request('GET', `${this.projectPath}/runs/${encodeURIComponent(this.settings.runId)}`)
      : null;
    const automationCaseIds = existingRun
      ? new Set(existingRun.runCases.filter((runCase) => runCase.executionMode === 'AUTOMATED').map((runCase) => runCase.testCaseId))
      : null;

    const linked = [];
    const unlinked = [];
    const ambiguous = [];
    const outsideRun = [];
    for (const result of inputResults) {
      const caseId = result.testCaseId || (result.caseKey && !duplicateKeys.has(result.caseKey) ? caseIdByKey.get(result.caseKey) : undefined);
      if (!caseId) {
        if (result.caseKey && duplicateKeys.has(result.caseKey)) ambiguous.push(result.title);
        else unlinked.push(result.title);
        continue;
      }
      if (automationCaseIds && !automationCaseIds.has(caseId)) {
        outsideRun.push(result.title);
        continue;
      }
      if (!clean(result.externalTestId)) {
        throw new Error(`The result for "${result.title}" has no stable externalTestId; it cannot be safely retried.`);
      }
      linked.push({ ...result, testCaseId: caseId });
    }

    if (linked.length === 0) {
      console.log(existingRun
        ? "TestOps: no result belongs to this run's automated cases; nothing was sent."
        : 'TestOps: no result is linked to a TestOps case; no run was created.');
      this.logUnlinked(unlinked, ambiguous, outsideRun);
      return;
    }

    const run = existingRun ?? await this.request('POST', `${this.projectPath}/runs`, {
      title: this.settings.runTitle ?? this.defaultRunTitle(integrationName),
      description: this.settings.ciUrl ? `${integrationName} run: ${this.settings.ciUrl}` : undefined,
      source: 'CI',
      environment: this.settings.environment,
      build: (clean(this.env.GITHUB_SHA) || clean(this.env.CI_COMMIT_SHA) || clean(this.env.CIRCLE_SHA1) || clean(this.env.BUILDKITE_COMMIT)).slice(0, 12) || undefined,
      testCaseIds: [...new Set(linked.map((result) => result.testCaseId))],
    });

    if (this.settings.ciUrl) {
      await this.request('PATCH', `${this.projectPath}/runs/${encodeURIComponent(run.id)}`, {
        externalLinkType: this.ciLinkType(),
        externalLinkRef: this.settings.ciUrl,
      });
    }

    let openDefects;
    for (const batch of chunks(linked, BULK_MAX)) {
      const submitted = await this.request('POST', `${this.projectPath}/runs/${encodeURIComponent(run.id)}/results/bulk`, {
        results: batch.map((result) => ({
          testCaseId: result.testCaseId,
          status: result.status,
          source: 'AUTOMATION',
          automationSourceLabel: integrationName,
          externalTestId: result.externalTestId,
          comment: result.comment?.slice(0, COMMENT_MAX),
          startedAt: result.startedAt,
          endedAt: result.endedAt,
          durationMs: result.durationMs,
        })),
      }, { retryable: true });

      for (const [index, result] of batch.entries()) {
        const resultId = submitted.results[index].id;
        if (result.status === 'FAILED') {
          await this.uploadAttachments(resultId, result.attachments ?? []);
          if (result.defectTitle) {
            openDefects ??= await this.listOpenDefects();
            const defect = openDefects.find((item) => item.title === result.defectTitle);
            if (defect) {
              await this.request('POST', `${this.projectPath}/defects/${encodeURIComponent(defect.id)}/results`, { resultIds: [resultId] });
            } else {
              console.log(`TestOps: no open defect is titled "${result.defectTitle}"; "${result.title}" was not linked.`);
            }
          }
        }
      }
    }

    if (!existingRun) await this.request('POST', `${this.projectPath}/runs/${encodeURIComponent(run.id)}/complete`);
    const webBase = this.settings.apiUrl.replace(/\/api\/v\d+$/, '');
    console.log(`TestOps: ${linked.length} ${linked.length === 1 ? 'result' : 'results'} sent to ${webBase}/projects/${this.settings.projectId}/runs/${run.id}`);
    this.logUnlinked(unlinked, ambiguous, outsideRun);
  }

  async uploadAttachments(resultId, attachments) {
    for (const attachment of attachments) {
      const bytes = new Uint8Array(await readFile(attachment.path));
      const form = new FormData();
      form.append('files', new Blob([bytes], { type: attachment.contentType }), basename(attachment.path));
      await this.request('POST', `${this.projectPath}/results/${encodeURIComponent(resultId)}/attachments`, undefined, { form });
    }
  }

  async listOpenDefects() {
    const [open, inProgress] = await Promise.all([
      this.request('GET', `${this.projectPath}/defects?status=OPEN`),
      this.request('GET', `${this.projectPath}/defects?status=IN_PROGRESS`),
    ]);
    return [...open, ...inProgress];
  }

  defaultRunTitle(integrationName) {
    const branch = clean(this.env.GITHUB_REF_NAME) || clean(this.env.CI_COMMIT_REF_NAME);
    const sha = clean(this.env.GITHUB_SHA) || clean(this.env.CI_COMMIT_SHA) || clean(this.env.CIRCLE_SHA1) || clean(this.env.BUILDKITE_COMMIT);
    if (branch && sha) return `${integrationName} – ${branch} @ ${sha.slice(0, 7)}`;
    return `${integrationName} – ${this.settings.environment}`;
  }

  ciLinkType() {
    if (this.settings.ciUrl?.includes('github.com')) return 'GitHub Actions';
    if (this.settings.ciUrl?.includes('gitlab')) return 'GitLab CI';
    if (this.settings.ciUrl?.includes('circleci')) return 'CircleCI';
    if (this.settings.ciUrl?.includes('buildkite')) return 'Buildkite';
    return 'CI';
  }

  logUnlinked(unlinked, ambiguous, outsideRun) {
    if (unlinked.length) console.log(`TestOps: not linked to a case (missing annotation or e2e:<key> tag): ${shortList(unlinked)}.`);
    if (ambiguous.length) console.warn(`TestOps: case key is duplicated in this project; these results were skipped: ${shortList(ambiguous)}.`);
    if (outsideRun.length) console.log(`TestOps: not among this run's automated cases: ${shortList(outsideRun)}.`);
  }
}

/** Creates the API client when configured, or returns null when all TestOps settings are absent. */
export function createReporterClient(options = {}, env = process.env, fetchImpl = globalThis.fetch) {
  const settings = settingsFrom(options, env);
  return settings ? new TestOpsClient(settings, fetchImpl, env) : null;
}

/** Framework-neutral entry point for framework adapters. */
export async function reportResults(results, options = {}, env = process.env) {
  const client = createReporterClient(options, env);
  if (!client) return;
  await client.report(results, options.integrationName ?? 'Test automation');
}
