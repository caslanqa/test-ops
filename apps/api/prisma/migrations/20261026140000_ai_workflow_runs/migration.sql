-- CreateEnum
CREATE TYPE "AiWorkflowType" AS ENUM ('REQUIREMENT_TO_CASES');

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'AWAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AiStepStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "ai_workflow_runs" (
    "id" TEXT NOT NULL,
    "type" "AiWorkflowType" NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" "AiRunStatus" NOT NULL DEFAULT 'QUEUED',
    "input" JSONB NOT NULL,
    "providerSnapshot" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ai_workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_workflow_steps" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "skillVersion" INTEGER NOT NULL,
    "status" "AiStepStatus" NOT NULL DEFAULT 'RUNNING',
    "attempt" INTEGER NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "usage" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ai_workflow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_workflow_runs_status_availableAt_idx" ON "ai_workflow_runs"("status", "availableAt");

-- CreateIndex
CREATE INDEX "ai_workflow_runs_projectId_createdAt_idx" ON "ai_workflow_runs"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_workflow_steps_runId_name_attempt_key" ON "ai_workflow_steps"("runId", "name", "attempt");

-- AddForeignKey
ALTER TABLE "ai_workflow_runs" ADD CONSTRAINT "ai_workflow_runs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_workflow_runs" ADD CONSTRAINT "ai_workflow_runs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_workflow_steps" ADD CONSTRAINT "ai_workflow_steps_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ai_workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
