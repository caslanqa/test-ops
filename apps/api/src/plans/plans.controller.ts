import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PlansService } from "./plans.service";
import { CreatePlanDto } from "./dto/create-plan.dto";
import { UpdatePlanDto } from "./dto/update-plan.dto";
import { AddPlanCasesDto } from "./dto/add-plan-cases.dto";
import { UpdatePlanCaseDto, UpdatePlanCasesDto } from "./dto/update-plan-cases.dto";
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

  /** Brings an archived plan back into the lists. */
  @Post(":planId/restore")
  @HttpCode(200)
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("planId") planId: string,
  ) {
    return this.plansService.restore(user.id, projectId, planId);
  }

  @Post(":planId/cases")
  addCases(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("planId") planId: string,
    @Body() dto: AddPlanCasesDto,
  ) {
    return this.plansService.addCases(user.id, projectId, planId, dto);
  }

  /**
   * Sets who tests several cases of the plan and/or how they run, all at once (all or none); runs
   * started from the plan take both over.
   */
  @Patch(":planId/cases")
  updateCases(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("planId") planId: string,
    @Body() { testCaseIds, ...changes }: UpdatePlanCasesDto,
  ) {
    return this.plansService.updateCases(user.id, projectId, planId, testCaseIds, changes);
  }

  /** Sets who tests a case of the plan and/or how it runs; runs started from the plan take both over. */
  @Patch(":planId/cases/:caseId")
  updateCase(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("planId") planId: string,
    @Param("caseId") caseId: string,
    @Body() dto: UpdatePlanCaseDto,
  ) {
    return this.plansService.updateCase(user.id, projectId, planId, caseId, dto);
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
