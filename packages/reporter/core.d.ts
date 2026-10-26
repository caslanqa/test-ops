export type TestOpsResultStatus = 'PASSED' | 'FAILED' | 'SKIPPED';

/** A file uploaded with a result. */
export interface TestOpsAttachment {
  path: string;
  contentType: string;
  /** File name sent to TestOps; defaults to the path's base name. */
  name?: string;
}

/** A framework step; reported against the case step whose text equals its title (ignoring case and spacing). */
export interface TestOpsStep {
  title: string;
  status: 'PASSED' | 'FAILED';
  /** Failure message of the step. */
  comment?: string;
}

/** Framework-neutral result shape consumed by TestOps' shared reporting client. */
export interface TestOpsResult {
  /** Exact UUID of the TestOps case. */
  testCaseId?: string;
  /** Stable identity for safe retry and deduplication inside a run. */
  externalTestId: string;
  title: string;
  status: TestOpsResultStatus;
  comment?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  attachments?: TestOpsAttachment[];
  /** Steps in execution order, matched to the case's steps by title. */
  steps?: TestOpsStep[];
  defectTitle?: string;
}

/** Test metadata discovered by a framework adapter and synchronized to a TestOps case ID. */
export interface TestOpsSyncTest {
  testCaseId?: string;
  title: string;
}

export interface ReporterOptions {
  apiUrl?: string;
  token?: string;
  projectId?: string;
  runId?: string;
  runTitle?: string;
  environment?: string;
  ciUrl?: string;
  /**
   * Which results get their artifacts uploaded: `failed` (default), `all` or `none`.
   * Defaults to TESTOPS_ATTACHMENTS.
   */
  attachments?: 'failed' | 'all' | 'none';
  /** Adapter name shown on the run and individual results. */
  integrationName?: string;
}

export interface TestOpsSyncOptions extends ReporterOptions {
  /** Apply title and automation status changes. Defaults to false (dry run). */
  apply?: boolean;
}

/** Uploads framework-neutral results using the TestOps v1 REST contract. */
export function reportResults(
  results: TestOpsResult[],
  options?: ReporterOptions,
  environment?: Record<string, string | undefined>,
): Promise<void>;

/** Syncs titles and automation status of annotated tests to their TestOps cases. */
export function syncTestCases(
  tests: TestOpsSyncTest[],
  options?: TestOpsSyncOptions,
  environment?: Record<string, string | undefined>,
): Promise<void>;
