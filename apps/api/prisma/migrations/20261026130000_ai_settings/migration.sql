-- CreateEnum
CREATE TYPE "AiProviderKind" AS ENUM ('ANTHROPIC', 'OPENAI_COMPATIBLE');

-- CreateTable
CREATE TABLE "ai_settings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "projectId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "provider" "AiProviderKind" NOT NULL,
    "model" TEXT NOT NULL,
    "endpoint" TEXT,
    "credentialCipher" TEXT,
    "maxOutputTokens" INTEGER NOT NULL DEFAULT 8192,
    "requestTimeoutMs" INTEGER NOT NULL DEFAULT 120000,
    "maxRunsPerUserPerDay" INTEGER NOT NULL DEFAULT 20,
    "testedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_settings_workspaceId_key" ON "ai_settings"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_settings_projectId_key" ON "ai_settings"("projectId");

-- AddForeignKey
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A row belongs to exactly one of a workspace (its default) and a project (its override). Prisma doesn't
-- model CHECK constraints, so this is written by hand.
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_one_owner" CHECK (("workspaceId" IS NULL) <> ("projectId" IS NULL));
