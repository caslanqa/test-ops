import type { TestDetails } from '@playwright/test';
import type { Reporter } from '@playwright/test/reporter';
import type { TestOpsSyncOptions, TestOpsSyncTest } from './core.js';
export type { TestOpsSyncOptions, TestOpsSyncTest } from './core.js';

export interface TestOpsReporterOptions {
  /** API base URL, e.g. https://testops.example.com/api/v1. Defaults to TESTOPS_URL. */
  apiUrl?: string;
  /** An API token with Automation, Tester or Admin access. Defaults to TESTOPS_TOKEN. */
  token?: string;
  /** Destination project ID. Defaults to TESTOPS_PROJECT_ID. */
  projectId?: string;
  /** Report into an existing TestOps run. Defaults to TESTOPS_RUN_ID. */
  runId?: string;
  /** Optional custom title for a newly created run. Defaults to TESTOPS_RUN_TITLE. */
  runTitle?: string;
  /** Optional environment label. Defaults to TESTOPS_ENVIRONMENT or CI/local. */
  environment?: string;
  /** Optional CI job URL. Defaults to TESTOPS_CI_URL or a supported CI environment. */
  ciUrl?: string;
  /** Which results get their artifacts uploaded: failed (default), all or none. Defaults to TESTOPS_ATTACHMENTS. */
  attachments?: 'failed' | 'all' | 'none';
}

/** Link a Playwright test to the UUID displayed in its TestOps case details. */
export function testops(testCaseId?: string, defectTitle?: string): TestDetails;

/** Sync discovered test titles and automation status to TestOps. */
export function syncTestCases(tests: TestOpsSyncTest[], options?: TestOpsSyncOptions): Promise<void>;

export default class TestOpsReporter implements Reporter {
  constructor(options?: TestOpsReporterOptions);
  printsToStdio(): boolean;
  onBegin(config: unknown, suite: import('@playwright/test/reporter').Suite): void;
  onEnd(result: import('@playwright/test/reporter').FullResult): Promise<{ status?: import('@playwright/test/reporter').FullResult['status'] } | undefined>;
}
