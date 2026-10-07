import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RunStatus } from "@prisma/client";
import { RunsService } from "./runs.service";
import { CreateRunDto } from "./dto/create-run.dto";
import { UpdateRunDto } from "./dto/update-run.dto";
import { ToggleShareDto } from "./dto/toggle-share.dto";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../common/decorators/current-user.decorator";
import type { Response } from "express";
import { PagedResponse, sendPage } from "../common/pagination";
import { ListRunsQueryDto } from "./dto/list-runs-query.dto";

@ApiTags("runs")
@Controller("projects/:projectId/runs")
export class RunsController {
  constructor(private readonly runsService: RunsService) {}

  @Get()
  @PagedResponse()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Query() query: ListRunsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.runsService.list(user.id, projectId, query));
  }

  @Get(":runId")
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
  ) {
    return this.runsService.getOne(user.id, projectId, runId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() dto: CreateRunDto,
  ) {
    return this.runsService.create(user.id, projectId, dto);
  }

  @Patch(":runId")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
    @Body() dto: UpdateRunDto,
  ) {
    return this.runsService.update(user.id, projectId, runId, dto);
  }

  @Post(":runId/complete")
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
  ) {
    return this.runsService.complete(user.id, projectId, runId);
  }

  @Post(":runId/reopen")
  reopen(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
  ) {
    return this.runsService.reopen(user.id, projectId, runId);
  }

  @Post(":runId/share")
  toggleShare(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
    @Body() dto: ToggleShareDto,
  ) {
    return this.runsService.toggleShare(user.id, projectId, runId, dto.enabled);
  }

  /** Deletes the run together with its results and their attachments (project admins only). */
  @Delete(":runId")
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
  ) {
    await this.runsService.remove(user.id, projectId, runId);
  }
}
