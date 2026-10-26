import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { AuthenticatedUser, CurrentUser } from "../common/decorators/current-user.decorator";
import { PagedResponse, sendPage } from "../common/pagination";
import { AiRunsService } from "./ai-runs.service";
import { ListRunsQueryDto } from "./dto/list-runs-query.dto";
import { StartRunDto } from "./dto/start-run.dto";

@ApiTags("ai")
@Controller("projects/:projectId/ai/runs")
export class AiRunsController {
  constructor(private readonly runs: AiRunsService) {}

  /** Queues a run (202); the work is done in the background, so poll the run for how it went. */
  @Post()
  @HttpCode(202)
  start(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string, @Body() dto: StartRunDto) {
    return this.runs.start(user.id, projectId, dto);
  }

  /** The project's runs, newest first; add `requirementId` for those of one requirement. */
  @Get()
  @PagedResponse()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Query() query: ListRunsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.runs.list(user.id, projectId, query));
  }

  /** One run with how each step went, and its result once the drafts are ready. */
  @Get(":runId")
  get(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string, @Param("runId") runId: string) {
    return this.runs.get(user.id, projectId, runId);
  }

  /** Stops a run that is queued, running or waiting for approval. */
  @Post(":runId/cancel")
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string, @Param("runId") runId: string) {
    return this.runs.cancel(user.id, projectId, runId);
  }
}
