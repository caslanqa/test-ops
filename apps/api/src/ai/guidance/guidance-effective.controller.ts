import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AiGuidanceStep } from "@prisma/client";
import type { Response } from "express";
import { AccessControlService } from "../../common/access-control.service";
import { AuthenticatedUser, CurrentUser } from "../../common/decorators/current-user.decorator";
import { EffectiveGuidanceQuery } from "./dto/effective-guidance.query";
import { GuidanceResolver } from "./guidance-resolver.service";
import { guidanceAnswer, selectionFromQuery } from "./guidance-view";

/**
 * What guidance applies to a project, for any member and for API tokens: a coding agent can read the team's
 * guidance from here. Reading what applies changes nothing and is what every member's runs are sent anyway, so
 * unlike the routes that write guidance it is open to tokens, and it lives in a controller of its own so that a
 * new route in the other one can't inherit that by accident. Guidance that is not in effect is not reachable from
 * here: only admins read it, through the preview route.
 */
@ApiTags("ai")
@Controller()
export class GuidanceEffectiveController {
  constructor(
    private readonly resolver: GuidanceResolver,
    private readonly accessControl: AccessControlService,
  ) {}

  /** The guidance a step of the project would be sent, within the project's token budget. */
  @Get("projects/:projectId/ai/guidance/effective")
  async effective(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Query() query: EffectiveGuidanceQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.accessControl.requireProjectAccessOrWorkspaceAdmin(user.id, projectId);
    const step = query.step ?? AiGuidanceStep.DESIGN;
    const selection = selectionFromQuery(query.selection, undefined);
    const resolved = await this.resolver.resolve(projectId, step, selection);
    return guidanceAnswer(response, query.format, step, selection, resolved);
  }
}
