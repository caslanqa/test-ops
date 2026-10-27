import { BadRequestException, Controller, Get, Param, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AiGuidanceStep } from "@prisma/client";
import type { Response } from "express";
import { AccessControlService } from "../../common/access-control.service";
import { AuthenticatedUser, CurrentUser } from "../../common/decorators/current-user.decorator";
import { EffectiveGuidanceQuery } from "./dto/effective-guidance.query";
import { GuidanceResolver } from "./guidance-resolver.service";
import { estimateTokens, type GuidanceSelection } from "./resolve-guidance";

/**
 * What guidance applies to a project, for any member and for API tokens: a coding agent can read the team's
 * guidance from here. Reading changes nothing, so unlike the routes that write guidance it is open to tokens, and
 * it lives in a controller of its own so that a new route in the other one can't inherit that by accident.
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
    const selection = this.selectionOf(query);
    const resolved = await this.resolver.resolve(projectId, step, selection);

    if (query.format === "prompt") {
      response.type("text/plain");
      return resolved.prompt;
    }
    return {
      step,
      selection: selection.mode,
      budgetTokens: resolved.budgetTokens,
      usedTokens: resolved.usedTokens,
      used: resolved.used.map((item) => ({
        ref: item.ref,
        scope: item.scope,
        title: item.title,
        version: item.version,
        priority: item.priority,
        tokens: estimateTokens(item.body),
        body: item.body,
      })),
      dropped: resolved.dropped,
    };
  }

  /** `ids` belong to `LIST` and to nothing else. */
  private selectionOf(query: EffectiveGuidanceQuery): GuidanceSelection {
    const mode = query.selection ?? "EFFECTIVE";
    if (mode !== "LIST") {
      if (query.ids !== undefined) throw new BadRequestException("ids go with selection=LIST");
      return { mode };
    }
    const ids = (query.ids ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id !== "");
    return { mode, ids };
  }
}
