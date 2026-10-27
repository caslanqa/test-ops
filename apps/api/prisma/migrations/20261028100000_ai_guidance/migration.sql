-- CreateEnum
CREATE TYPE "AiGuidanceKind" AS ENUM ('CASE_CONTENT', 'AUTOMATION_CODE', 'TEAM_RULE');

-- CreateEnum
CREATE TYPE "AiGuidanceStep" AS ENUM ('REVIEW', 'DESIGN', 'AUDIT', 'CODEGEN');

-- CreateEnum
CREATE TYPE "AiGuidanceSource" AS ENUM ('WRITTEN', 'UPLOADED');

-- AlterTable
ALTER TABLE "ai_settings" ADD COLUMN "guidanceBudgetTokens" INTEGER NOT NULL DEFAULT 6000;

-- AlterTable
ALTER TABLE "ai_workflow_runs" ADD COLUMN "guidance" JSONB;

-- AlterTable
ALTER TABLE "ai_workflow_steps" ADD COLUMN "guidanceTokens" INTEGER;

-- CreateTable
CREATE TABLE "ai_guidance" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "body" TEXT NOT NULL,
    "kind" "AiGuidanceKind" NOT NULL,
    "steps" "AiGuidanceStep"[],
    "priority" INTEGER NOT NULL DEFAULT 500,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceKind" "AiGuidanceSource" NOT NULL DEFAULT 'WRITTEN',
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "license" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_guidance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_guidance_versions" (
    "id" TEXT NOT NULL,
    "guidanceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "body" TEXT NOT NULL,
    "kind" "AiGuidanceKind" NOT NULL,
    "steps" "AiGuidanceStep"[],
    "priority" INTEGER NOT NULL,
    "editedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_guidance_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_guidance_toggles" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "projectId" TEXT,
    "guidanceId" TEXT,
    "builtinKey" TEXT,
    "enabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_guidance_toggles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_guidance_workspaceId_idx" ON "ai_guidance"("workspaceId");

-- CreateIndex
CREATE INDEX "ai_guidance_projectId_idx" ON "ai_guidance"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_guidance_versions_guidanceId_version_key" ON "ai_guidance_versions"("guidanceId", "version");

-- CreateIndex
CREATE INDEX "ai_guidance_toggles_workspaceId_idx" ON "ai_guidance_toggles"("workspaceId");

-- CreateIndex
CREATE INDEX "ai_guidance_toggles_projectId_idx" ON "ai_guidance_toggles"("projectId");

-- CreateIndex
CREATE INDEX "ai_guidance_toggles_guidanceId_idx" ON "ai_guidance_toggles"("guidanceId");

-- AddForeignKey
ALTER TABLE "ai_guidance" ADD CONSTRAINT "ai_guidance_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_guidance" ADD CONSTRAINT "ai_guidance_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_guidance_versions" ADD CONSTRAINT "ai_guidance_versions_guidanceId_fkey" FOREIGN KEY ("guidanceId") REFERENCES "ai_guidance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_guidance_toggles" ADD CONSTRAINT "ai_guidance_toggles_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_guidance_toggles" ADD CONSTRAINT "ai_guidance_toggles_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_guidance_toggles" ADD CONSTRAINT "ai_guidance_toggles_guidanceId_fkey" FOREIGN KEY ("guidanceId") REFERENCES "ai_guidance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma doesn't model CHECK constraints or expression indexes, so these are written by hand.

-- A guidance belongs to exactly one of a workspace and a project, and says where it applies.
ALTER TABLE "ai_guidance" ADD CONSTRAINT "ai_guidance_one_owner" CHECK (("workspaceId" IS NULL) <> ("projectId" IS NULL));
ALTER TABLE "ai_guidance" ADD CONSTRAINT "ai_guidance_steps_not_empty" CHECK (cardinality("steps") >= 1);
ALTER TABLE "ai_guidance_versions" ADD CONSTRAINT "ai_guidance_versions_steps_not_empty" CHECK (cardinality("steps") >= 1);

-- A toggle has one owner and one target, and there is one per owner and target: the COALESCE makes the NULL
-- columns compare equal, which a plain unique index doesn't.
ALTER TABLE "ai_guidance_toggles" ADD CONSTRAINT "ai_guidance_toggles_one_owner" CHECK (("workspaceId" IS NULL) <> ("projectId" IS NULL));
ALTER TABLE "ai_guidance_toggles" ADD CONSTRAINT "ai_guidance_toggles_one_target" CHECK (("guidanceId" IS NULL) <> ("builtinKey" IS NULL));
CREATE UNIQUE INDEX "ai_guidance_toggles_target" ON "ai_guidance_toggles"
  (COALESCE("workspaceId", ''), COALESCE("projectId", ''), COALESCE("guidanceId", ''), COALESCE("builtinKey", ''));

-- 0 means no limit.
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_guidance_budget_range" CHECK ("guidanceBudgetTokens" BETWEEN 0 AND 200000);
