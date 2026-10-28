import { Module } from "@nestjs/common";
import { TestCasesModule } from "../test-cases/test-cases.module";
import { AiRunExecutor } from "./ai-run-executor";
import { AiRunsController } from "./ai-runs.controller";
import { AiRunsService } from "./ai-runs.service";
import { AiSettingsController } from "./ai-settings.controller";
import { AiSettingsService } from "./ai-settings.service";
import { AiWorkerService } from "./ai-worker.service";

/** The embedded AI assistant: where the provider is defined, and the workflows that use it. */
@Module({
  imports: [TestCasesModule],
  controllers: [AiSettingsController, AiRunsController],
  providers: [AiSettingsService, AiRunsService, AiRunExecutor, AiWorkerService],
  exports: [AiSettingsService],
})
export class AiModule {}
