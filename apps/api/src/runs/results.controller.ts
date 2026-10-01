import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ResultsService } from "./results.service";
import { SubmitResultDto } from "./dto/submit-result.dto";
import { BulkSubmitResultsDto } from "./dto/bulk-submit-results.dto";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../common/decorators/current-user.decorator";

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
}
