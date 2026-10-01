import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { TestCasesService } from "./test-cases.service";
import { CreateTestCaseDto } from "./dto/create-test-case.dto";
import { UpdateTestCaseDto } from "./dto/update-test-case.dto";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../common/decorators/current-user.decorator";

@ApiTags("test-cases")
@Controller("projects/:projectId/cases")
export class TestCasesController {
  constructor(private readonly testCasesService: TestCasesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Query("suiteId") suiteId?: string,
    @Query("includeArchived") includeArchived?: string,
  ) {
    return this.testCasesService.list(user.id, projectId, {
      suiteId,
      includeArchived: includeArchived === "true",
    });
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
}
