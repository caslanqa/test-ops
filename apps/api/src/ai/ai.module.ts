import { Module } from "@nestjs/common";
import { TestCasesModule } from "../test-cases/test-cases.module";
import { AiRunExecutor } from "./ai-run-executor";
import { AiRunsController } from "./ai-runs.controller";
import { AiRunsService } from "./ai-runs.service";
import { AiSettingsController } from "./ai-settings.controller";
import { AiSettingsService } from "./ai-settings.service";
import { AiWorkerService } from "./ai-worker.service";
import { ComparisonsController } from "./comparisons/comparisons.controller";
import { ComparisonsService } from "./comparisons/comparisons.service";
import { BuiltinGuidanceService } from "./guidance/builtin-guidance";
import { GuidanceEffectiveController } from "./guidance/guidance-effective.controller";
import { GuidanceResolver } from "./guidance/guidance-resolver.service";
import { GuidanceController } from "./guidance/guidance.controller";
import { GuidanceService } from "./guidance/guidance.service";

/** The embedded AI assistant: where the provider is defined, the guidance the team gives it, and the workflows. */
@Module({
  imports: [TestCasesModule],
  controllers: [AiSettingsController, AiRunsController, GuidanceController, GuidanceEffectiveController, ComparisonsController],
  providers: [AiSettingsService, AiRunsService, AiRunExecutor, AiWorkerService, GuidanceService, GuidanceResolver, BuiltinGuidanceService, ComparisonsService],
  exports: [AiSettingsService],
})
export class AiModule {}
