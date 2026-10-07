import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PlansService } from "./plans.service";
import { CreatePlanDto } from "./dto/create-plan.dto";
import { UpdatePlanDto } from "./dto/update-plan.dto";
import { AddPlanCasesDto } from "./dto/add-plan-cases.dto";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../common/decorators/current-user.decorator";
import type { Response } from "express";
import { PagedResponse, sendPage } from "../common/pagination";
import { ListPlansQueryDto } from "./dto/list-plans-query.dto";

@ApiTags("plans")
@Controller("projects/:projectId/plans")
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  @PagedResponse()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Query() query: ListPlansQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.plansService.list(user.id, projectId, query));
  }

  @Get(":planId")
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("planId") planId: string,
  ) {
    return this.plansService.getOne(user.id, projectId, planId);
  }

  @Get(":planId/case-ids")
  caseIds(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("planId") planId: string,
  ) {
    return this.plansService.caseIds(user.id, projectId, planId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() dto: CreatePlanDto,
  ) {
    return this.plansService.create(user.id, projectId, dto);
  }

  @Patch(":planId")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("planId") planId: string,
    @Body() dto: UpdatePlanDto,
  ) {
    return this.plansService.update(user.id, projectId, planId, dto);
  }

  @Delete(":planId")
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("planId") planId: string,
  ) {
    return this.plansService.archive(user.id, projectId, planId);
  }

  @Post(":planId/cases")
  addCases(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("planId") planId: string,
    @Body() dto: AddPlanCasesDto,
  ) {
    return this.plansService.addCases(
      user.id,
      projectId,
      planId,
      dto.testCaseIds,
    );
  }

  @Delete(":planId/cases/:caseId")
  removeCase(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("planId") planId: string,
    @Param("caseId") caseId: string,
  ) {
    return this.plansService.removeCase(user.id, projectId, planId, caseId);
  }
}
