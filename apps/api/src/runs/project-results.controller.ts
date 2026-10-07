import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { ResultsService } from "./results.service";
import { ListResultsQueryDto } from "./dto/list-results-query.dto";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../common/decorators/current-user.decorator";
import { PagedResponse, sendPage } from "../common/pagination";

/** Results of a whole project, for reporting and history across runs. */
@ApiTags("results")
@Controller("projects/:projectId/results")
export class ProjectResultsController {
  constructor(private readonly resultsService: ResultsService) {}

  @Get()
  @PagedResponse()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Query() query: ListResultsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.resultsService.listForProject(user.id, projectId, query));
  }
}
