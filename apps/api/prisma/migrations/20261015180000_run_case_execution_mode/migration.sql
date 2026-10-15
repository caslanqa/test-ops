-- How each case of a run is meant to be run (by a tester or by automation), chosen when the run
-- starts. Existing runs: a case whose latest result came from automation, or a case without results
-- that is automated, ran as automated; everything else as manual.
CREATE TYPE "ExecutionMode" AS ENUM ('MANUAL', 'AUTOMATED');

ALTER TABLE "run_cases" ADD COLUMN "executionMode" "ExecutionMode" NOT NULL DEFAULT 'MANUAL';

UPDATE "run_cases" rc
SET "executionMode" = 'AUTOMATED'
WHERE EXISTS (
    SELECT 1 FROM "results" r
    WHERE r."runCaseId" = rc."id" AND r."isLatest" AND r."source" = 'AUTOMATION'
  )
  OR (
    NOT EXISTS (SELECT 1 FROM "results" r WHERE r."runCaseId" = rc."id")
    AND EXISTS (
      SELECT 1 FROM "test_cases" tc
      WHERE tc."id" = rc."testCaseId" AND tc."automationStatus" = 'AUTOMATED'
    )
  );
