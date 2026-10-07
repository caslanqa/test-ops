import { Module } from "@nestjs/common";
import { RunsService } from "./runs.service";
import { ResultsService } from "./results.service";
import { RunsController } from "./runs.controller";
import { ResultsController } from "./results.controller";
import { ProjectResultsController } from "./project-results.controller";
import { PublicRunsController } from "./public-runs.controller";

@Module({
  controllers: [
    RunsController,
    ResultsController,
    ProjectResultsController,
    PublicRunsController,
  ],
  providers: [RunsService, ResultsService],
  exports: [RunsService, ResultsService],
})
export class RunsModule {}
