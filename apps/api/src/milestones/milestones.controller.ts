import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { MilestonesService } from "./milestones.service";
import { CreateMilestoneDto } from "./dto/create-milestone.dto";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../common/decorators/current-user.decorator";
import type { Response } from "express";
import { PagedResponse, sendPage } from "../common/pagination";
import { ListMilestonesQueryDto } from "./dto/list-milestones-query.dto";
import { UpdateMilestoneDto } from "./dto/update-milestone.dto";

@ApiTags("milestones")
@Controller("projects/:projectId/milestones")
export class MilestonesController {
  constructor(private readonly milestonesService: MilestonesService) {}

  @Get()
  @PagedResponse()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Query() query: ListMilestonesQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.milestonesService.list(user.id, projectId, query));
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() dto: CreateMilestoneDto,
  ) {
    return this.milestonesService.create(user.id, projectId, dto);
  }

  @Get(":milestoneId")
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("milestoneId") milestoneId: string,
  ) {
    return this.milestonesService.getOne(user.id, projectId, milestoneId);
  }

  @Patch(":milestoneId")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("milestoneId") milestoneId: string,
    @Body() dto: UpdateMilestoneDto,
  ) {
    return this.milestonesService.update(user.id, projectId, milestoneId, dto);
  }

  /** Deletes the milestone; its plans and runs are kept without a milestone. */
  @Delete(":milestoneId")
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("milestoneId") milestoneId: string,
  ) {
    await this.milestonesService.remove(user.id, projectId, milestoneId);
  }
}
