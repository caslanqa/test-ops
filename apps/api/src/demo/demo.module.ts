import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module";
import { SuitesModule } from "../suites/suites.module";
import { TestCasesModule } from "../test-cases/test-cases.module";
import { RequirementsModule } from "../requirements/requirements.module";
import { MilestonesModule } from "../milestones/milestones.module";
import { PlansModule } from "../plans/plans.module";
import { RunsModule } from "../runs/runs.module";
import { DefectsModule } from "../defects/defects.module";
import { DemoService } from "./demo.service";
import { DemoController } from "./demo.controller";

/** Every user's own DEMO workspace (DEMO_WORKSPACE); see DemoService. */
@Module({
  imports: [
    ProjectsModule,
    SuitesModule,
    TestCasesModule,
    RequirementsModule,
    MilestonesModule,
    PlansModule,
    RunsModule,
    DefectsModule,
  ],
  controllers: [DemoController],
  providers: [DemoService],
  exports: [DemoService],
})
export class DemoModule {}
