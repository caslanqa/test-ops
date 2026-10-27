import { Body, Controller, Get, HttpCode, Param, Post, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuthenticatedUser, CurrentUser } from "../../common/decorators/current-user.decorator";
import { ComparisonsService } from "./comparisons.service";
import { StartComparisonDto, VerdictDto } from "./dto/start-comparison.dto";

/**
 * Comparing two selections of guidance on one requirement. Testers and admins start and judge; every member reads.
 * Nothing here changes guidance or settings, so, unlike writing guidance, it is open to API tokens like starting a run.
 */
@ApiTags("ai")
@Controller("projects/:projectId/ai")
export class ComparisonsController {
  constructor(private readonly comparisons: ComparisonsService) {}

  /** Starts two runs, side A and side B, of one requirement (201); poll the comparison for how they went. */
  @Post("comparisons")
  @HttpCode(201)
  start(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string, @Body() dto: StartComparisonDto) {
    return this.comparisons.start(user.id, projectId, dto);
  }

  /** Both runs as run views, and the verdict once there is one. */
  @Get("comparisons/:comparisonId")
  get(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string, @Param("comparisonId") comparisonId: string) {
    return this.comparisons.get(user.id, projectId, comparisonId);
  }

  /** Which side drafted better: `A`, `B` or `NEITHER`, with an optional note. Both runs need drafts. */
  @Put("comparisons/:comparisonId/verdict")
  @HttpCode(200)
  judge(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("comparisonId") comparisonId: string,
    @Body() dto: VerdictDto,
  ) {
    return this.comparisons.judge(user.id, projectId, comparisonId, dto);
  }

  /** Per guidance: the judged comparisons it took part in, and in how many a side it was sent on was preferred. */
  @Get("guidance/stats")
  stats(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string) {
    return this.comparisons.stats(user.id, projectId);
  }
}
