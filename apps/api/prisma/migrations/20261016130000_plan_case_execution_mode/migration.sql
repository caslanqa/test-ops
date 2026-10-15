-- How runs started from a plan run each of its cases (by a tester or by CI), set in the plan's case
-- list, as the assignee is. Existing plan cases: as their case is defined.
ALTER TABLE "plan_cases" ADD COLUMN "executionMode" "ExecutionMode" NOT NULL DEFAULT 'MANUAL';

UPDATE "plan_cases" pc
SET "executionMode" = 'AUTOMATED'
FROM "test_cases" tc
WHERE tc."id" = pc."testCaseId" AND tc."automationStatus" = 'AUTOMATED';
