import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RequirementsService } from "./requirements.service";
import { CreateRequirementDto } from "./dto/create-requirement.dto";
import { UpdateRequirementDto } from "./dto/update-requirement.dto";
import { LinkCasesDto } from "./dto/link-cases.dto";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../common/decorators/current-user.decorator";
import type { Response } from "express";
import { PagedResponse, sendPage } from "../common/pagination";
import { ListRequirementsQueryDto } from "./dto/list-requirements-query.dto";
import { ListRequirementCasesQueryDto } from "./dto/list-requirement-cases-query.dto";

@ApiTags("requirements")
@Controller("projects/:projectId/requirements")
export class RequirementsController {
  constructor(private readonly requirementsService: RequirementsService) {}

  @Get()
  @PagedResponse()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Query() query: ListRequirementsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.requirementsService.list(user.id, projectId, query));
  }

  @Get("coverage")
  coverage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
  ) {
    return this.requirementsService.coverage(user.id, projectId);
  }

  @Get(":requirementId")
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("requirementId") requirementId: string,
  ) {
    return this.requirementsService.getOne(user.id, projectId, requirementId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() dto: CreateRequirementDto,
  ) {
    return this.requirementsService.create(user.id, projectId, dto);
  }

  @Patch(":requirementId")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("requirementId") requirementId: string,
    @Body() dto: UpdateRequirementDto,
  ) {
    return this.requirementsService.update(
      user.id,
      projectId,
      requirementId,
      dto,
    );
  }

  @Delete(":requirementId")
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("requirementId") requirementId: string,
  ) {
    return this.requirementsService.archive(user.id, projectId, requirementId);
  }

  /** Brings an archived requirement back into the lists. */
  @Post(":requirementId/restore")
  @HttpCode(200)
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("requirementId") requirementId: string,
  ) {
    return this.requirementsService.restore(user.id, projectId, requirementId);
  }

  @Post(":requirementId/cases")
  linkCases(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("requirementId") requirementId: string,
    @Body() dto: LinkCasesDto,
  ) {
    return this.requirementsService.linkCases(
      user.id,
      projectId,
      requirementId,
      dto.testCaseIds,
    );
  }

  @Delete(":requirementId/cases/:caseId")
  unlinkCase(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("requirementId") requirementId: string,
    @Param("caseId") caseId: string,
  ) {
    return this.requirementsService.unlinkCase(
      user.id,
      projectId,
      requirementId,
      caseId,
    );
  }

  /** The test cases linked to the requirement. */
  @Get(":requirementId/cases")
  @PagedResponse()
  async listCases(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("requirementId") requirementId: string,
    @Query() query: ListRequirementCasesQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(
      res,
      await this.requirementsService.listCases(user.id, projectId, requirementId, query),
    );
  }
}
