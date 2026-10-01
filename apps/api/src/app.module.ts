import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ServeStaticModule } from "@nestjs/serve-static";
import { join } from "path";
import configuration from "./config/configuration";
import { PrismaModule } from "./prisma/prisma.module";
import { CommonModule } from "./common/common.module";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";
import { ProjectsModule } from "./projects/projects.module";
import { SuitesModule } from "./suites/suites.module";
import { TestCasesModule } from "./test-cases/test-cases.module";
import { RequirementsModule } from "./requirements/requirements.module";
import { MilestonesModule } from "./milestones/milestones.module";
import { PlansModule } from "./plans/plans.module";
import { RunsModule } from "./runs/runs.module";
import { DefectsModule } from "./defects/defects.module";
import { AttachmentsModule } from "./attachments/attachments.module";
import { ApiTokensModule } from "./api-tokens/api-tokens.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    // Tek imajda bırlikte yayınlanan React SPA; derlenmiş dosyalar
    // Dockerfile tarafından dist'in yanına (apps/api/web) kopyalanır.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, "..", "web"),
      exclude: ["/api", "/health", "/ready"],
    }),
    PrismaModule,
    CommonModule,
    HealthModule,
    AuthModule,
    WorkspacesModule,
    ProjectsModule,
    SuitesModule,
    TestCasesModule,
    RequirementsModule,
    MilestonesModule,
    PlansModule,
    RunsModule,
    DefectsModule,
    AttachmentsModule,
    ApiTokensModule,
  ],
})
export class AppModule {}
