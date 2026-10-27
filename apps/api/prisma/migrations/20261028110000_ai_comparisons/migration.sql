-- CreateEnum
CREATE TYPE "AiComparisonSide" AS ENUM ('A', 'B');

-- CreateEnum
CREATE TYPE "AiComparisonVerdict" AS ENUM ('A', 'B', 'NEITHER');

-- AlterTable
ALTER TABLE "ai_workflow_runs" ADD COLUMN "comparisonId" TEXT,
ADD COLUMN "comparisonSide" "AiComparisonSide";

-- CreateTable
CREATE TABLE "ai_run_comparisons" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "preferred" "AiComparisonVerdict",
    "note" TEXT,
    "judgedById" TEXT,
    "judgedAt" TIMESTAMP(3),

    CONSTRAINT "ai_run_comparisons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_run_comparisons_projectId_createdAt_idx" ON "ai_run_comparisons"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_workflow_runs_comparisonId_comparisonSide_key" ON "ai_workflow_runs"("comparisonId", "comparisonSide");

-- AddForeignKey
ALTER TABLE "ai_workflow_runs" ADD CONSTRAINT "ai_workflow_runs_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "ai_run_comparisons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_run_comparisons" ADD CONSTRAINT "ai_run_comparisons_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma doesn't model CHECK constraints, so these are written by hand.

-- A run is a side of a comparison, or it isn't: both columns are set or neither.
ALTER TABLE "ai_workflow_runs" ADD CONSTRAINT "ai_workflow_runs_comparison_both_or_none" CHECK (("comparisonId" IS NULL) = ("comparisonSide" IS NULL));

-- A verdict comes with who gave it and when, or there is none; a note is short.
ALTER TABLE "ai_run_comparisons" ADD CONSTRAINT "ai_run_comparisons_verdict_complete" CHECK (("preferred" IS NULL) = ("judgedById" IS NULL) AND ("preferred" IS NULL) = ("judgedAt" IS NULL));
ALTER TABLE "ai_run_comparisons" ADD CONSTRAINT "ai_run_comparisons_note_length" CHECK ("note" IS NULL OR char_length("note") <= 1000);
