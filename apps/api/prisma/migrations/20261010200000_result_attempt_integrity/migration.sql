-- Result attempt integrity (FR-034, FR-043, FR-075).
--
-- Before this release, parallel submissions could leave a run case with several "latest" results
-- and duplicate attempt numbers, deleting an attempt made the next one reuse a number, parallel
-- re-sends could store the same externalTestId more than once, and re-sending an older attempt's
-- externalTestId set the run case status back to that attempt's status. The statements below repair
-- such rows without deleting any result, then add the unique indexes that keep them from coming
-- back. Each step can safely run again.

-- 1) An externalTestId stays only on the newest result that carries it in a run case; older
--    duplicates keep their data as plain attempts.
UPDATE "results" AS r
SET "externalTestId" = NULL
FROM (
  SELECT "id", row_number() OVER (
    PARTITION BY "runCaseId", "externalTestId"
    ORDER BY "attemptNumber" DESC, "createdAt" DESC, "id" DESC
  ) AS rank
  FROM "results"
  WHERE "externalTestId" IS NOT NULL
) AS ranked
WHERE r."id" = ranked."id" AND ranked.rank > 1;

-- 2) Attempts are numbered 1..n per run case, in the order they were recorded.
UPDATE "results" AS r
SET "attemptNumber" = numbered.n
FROM (
  SELECT "id", row_number() OVER (
    PARTITION BY "runCaseId"
    ORDER BY "attemptNumber", "createdAt", "id"
  ) AS n
  FROM "results"
) AS numbered
WHERE r."id" = numbered."id" AND r."attemptNumber" <> numbered.n;

-- 3) Exactly one latest result per run case: its highest attempt.
UPDATE "results" AS r
SET "isLatest" = (r."attemptNumber" = top.max_attempt)
FROM (
  SELECT "runCaseId", max("attemptNumber") AS max_attempt
  FROM "results"
  GROUP BY "runCaseId"
) AS top
WHERE r."runCaseId" = top."runCaseId"
  AND r."isLatest" IS DISTINCT FROM (r."attemptNumber" = top.max_attempt);

-- 4) A run case shows the status of its latest result.
UPDATE "run_cases" AS rc
SET "status" = r."status"::text::"RunCaseStatus"
FROM "results" AS r
WHERE r."runCaseId" = rc."id"
  AND r."isLatest"
  AND rc."status"::text <> r."status"::text;

-- CreateIndex
CREATE UNIQUE INDEX "results_runCaseId_attemptNumber_key" ON "results"("runCaseId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "results_runCaseId_externalTestId_key" ON "results"("runCaseId", "externalTestId");
