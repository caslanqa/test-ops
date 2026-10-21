export type TestOpsResultStatus = 'PASSED' | 'FAILED' | 'SKIPPED';

/** Framework-neutral result shape consumed by TestOps' shared reporting client. */
export interface TestOpsResult {
  /** Stable key from a matching TestOps case tag (`e2e:<caseKey>`). */
  caseKey?: string;
  /** Optional direct link for adapters that have a TestOps case ID. */
  testCaseId?: string;
  /** Stable identity for safe retry and deduplication inside a run. */
  externalTestId: string;
  title: string;
  status: TestOpsResultStatus;
  comment?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  attachments?: Array<{ path: string; contentType: string }>;
  defectTitle?: string;
}

export interface ReporterOptions {
  apiUrl?: string;
  token?: string;
  projectId?: string;
  runId?: string;
  runTitle?: string;
  environment?: string;
  ciUrl?: string;
  /** Adapter name shown on the run and individual results. */
  integrationName?: string;
}

/** Uploads framework-neutral results using the TestOps v1 REST contract. */
export function reportResults(
  results: TestOpsResult[],
  options?: ReporterOptions,
  environment?: Record<string, string | undefined>,
): Promise<void>;
