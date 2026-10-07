import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ResultsService } from "./results.service";
import { SubmitResultDto } from "./dto/submit-result.dto";
import { BulkSubmitResultsDto } from "./dto/bulk-submit-results.dto";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../common/decorators/current-user.decorator";
import { UpdateResultDto } from "./dto/update-result.dto";

@ApiTags("results")
@Controller("projects/:projectId/runs/:runId/results")
export class ResultsController {
  constructor(private readonly resultsService: ResultsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
  ) {
    return this.resultsService.list(user.id, projectId, runId);
  }

  @Get(":resultId")
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
    @Param("resultId") resultId: string,
  ) {
    return this.resultsService.getOne(user.id, projectId, runId, resultId);
  }

  @Post()
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
    @Body() dto: SubmitResultDto,
  ) {
    return this.resultsService.submit(user.id, projectId, runId, dto);
  }

  @Post("bulk")
  bulkSubmit(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
    @Body() dto: BulkSubmitResultsDto,
  ) {
    return this.resultsService.bulkSubmit(
      user.id,
      projectId,
      runId,
      dto.results,
    );
  }

  /** Corrects a result of an open run; omitted fields are kept. */
  @Patch(":resultId")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
    @Param("resultId") resultId: string,
    @Body() dto: UpdateResultDto,
  ) {
    return this.resultsService.update(user.id, projectId, runId, resultId, dto);
  }

  /** Deletes a result and its attachments from an open run (project admins only). */
  @Delete(":resultId")
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
    @Param("resultId") resultId: string,
  ) {
    await this.resultsService.remove(user.id, projectId, runId, resultId);
  }
}
