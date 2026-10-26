import { Module } from "@nestjs/common";
import { AiRunExecutor } from "./ai-run-executor";
import { AiRunsController } from "./ai-runs.controller";
import { AiRunsService } from "./ai-runs.service";
import { AiSettingsController } from "./ai-settings.controller";
import { AiSettingsService } from "./ai-settings.service";
import { AiWorkerService } from "./ai-worker.service";

/** The embedded AI assistant: where the provider is defined, and the workflows that use it. */
@Module({
  controllers: [AiSettingsController, AiRunsController],
  providers: [AiSettingsService, AiRunsService, AiRunExecutor, AiWorkerService],
  exports: [AiSettingsService],
})
export class AiModule {}
