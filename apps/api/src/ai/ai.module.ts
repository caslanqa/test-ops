import { Module } from "@nestjs/common";
import { AiSettingsController } from "./ai-settings.controller";
import { AiSettingsService } from "./ai-settings.service";

/** The embedded AI assistant: where the provider is defined and, in later parts, the workflows that use it. */
@Module({
  controllers: [AiSettingsController],
  providers: [AiSettingsService],
  exports: [AiSettingsService],
})
export class AiModule {}
