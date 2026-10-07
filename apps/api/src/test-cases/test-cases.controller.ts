import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { TestCasesService } from "./test-cases.service";
import { CreateTestCaseDto } from "./dto/create-test-case.dto";
import { UpdateTestCaseDto } from "./dto/update-test-case.dto";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../common/decorators/current-user.decorator";
import type { Response } from "express";
import { PagedResponse, sendPage } from "../common/pagination";
import { ListTestCasesQueryDto } from "./dto/list-test-cases-query.dto";
import { BulkCreateTestCasesDto } from "./dto/bulk-create-test-cases.dto";

@ApiTags("test-cases")
@Controller("projects/:projectId/cases")
export class TestCasesController {
  constructor(private readonly testCasesService: TestCasesService) {}

  @Get()
  @PagedResponse()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Query() query: ListTestCasesQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.testCasesService.list(user.id, projectId, query));
  }

  @Get(":caseId")
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("caseId") caseId: string,
  ) {
    return this.testCasesService.getOne(user.id, projectId, caseId);
  }

  @Get(":caseId/history")
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("caseId") caseId: string,
  ) {
    return this.testCasesService.history(user.id, projectId, caseId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() dto: CreateTestCaseDto,
  ) {
    return this.testCasesService.create(user.id, projectId, dto);
  }

  @Patch(":caseId")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("caseId") caseId: string,
    @Body() dto: UpdateTestCaseDto,
  ) {
    return this.testCasesService.update(user.id, projectId, caseId, dto);
  }

  @Delete(":caseId")
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("caseId") caseId: string,
  ) {
    return this.testCasesService.archive(user.id, projectId, caseId);
  }

  /** Creates up to 500 cases at once; all or none are created. */
  @Post("bulk")
  createMany(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() dto: BulkCreateTestCasesDto,
  ) {
    return this.testCasesService.createMany(user.id, projectId, dto);
  }
}
