import type { TestDetails } from '@playwright/test';
import type { Reporter } from '@playwright/test/reporter';

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
}

export function testops(caseKey: string, defectTitle?: string): TestDetails;

export default class TestOpsReporter implements Reporter {
  constructor(options?: TestOpsReporterOptions);
  printsToStdio(): boolean;
  onBegin(config: unknown, suite: import('@playwright/test/reporter').Suite): void;
  onEnd(result: import('@playwright/test/reporter').FullResult): Promise<{ status?: import('@playwright/test/reporter').FullResult['status'] } | undefined>;
}
