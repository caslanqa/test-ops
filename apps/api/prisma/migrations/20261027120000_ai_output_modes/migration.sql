-- CreateEnum
CREATE TYPE "AiOutputMode" AS ENUM ('AUTO', 'JSON_SCHEMA', 'TOOL_CALL', 'JSON_OBJECT', 'PROMPT');

-- AlterTable
ALTER TABLE "ai_settings" ADD COLUMN "outputMode" "AiOutputMode" NOT NULL DEFAULT 'AUTO',
ADD COLUMN "learnedMode" "AiOutputMode";

-- AlterTable
ALTER TABLE "ai_workflow_steps" ADD COLUMN "mode" TEXT;
