-- Invalid: the case could not be finished properly, so its outcome is inconclusive.
ALTER TYPE "ResultStatus" ADD VALUE 'INVALID' AFTER 'SKIPPED';
ALTER TYPE "RunCaseStatus" ADD VALUE 'INVALID' AFTER 'SKIPPED';
