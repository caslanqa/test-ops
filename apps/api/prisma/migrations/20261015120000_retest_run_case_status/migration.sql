-- Retest: a case with a result that has to be run again ("Run again"). Only run cases have it;
-- the next result replaces it.
ALTER TYPE "RunCaseStatus" ADD VALUE 'RETEST' AFTER 'INVALID';
