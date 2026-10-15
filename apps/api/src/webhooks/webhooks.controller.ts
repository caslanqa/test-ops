import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { CurrentUser, AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { WebSessionOnly } from "../common/decorators/web-session-only.decorator";
import { SaveWebhookDto } from "./dto/save-webhook.dto";
import { requestOrigin } from "./request-origin";
import { WebhooksService } from "./webhooks.service";

@ApiTags("webhooks")
@Controller("projects/:projectId")
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  /** The project's CI webhook and its recent calls (project admins); header values are never returned. */
  @Get("webhook")
  @WebSessionOnly()
  get(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string) {
    return this.webhooksService.getSettings(user.id, projectId);
  }

  /**
   * Creates or changes the CI webhook (project admins). A new webhook's signing secret is in the
   * answer this once.
   */
  @Put("webhook")
  @WebSessionOnly()
  save(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string, @Body() dto: SaveWebhookDto) {
    return this.webhooksService.save(user.id, projectId, dto);
  }

  @Delete("webhook")
  @WebSessionOnly()
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string) {
    await this.webhooksService.remove(user.id, projectId);
  }

  /** A new signing secret, in the answer this once; the old one stops working. */
  @Post("webhook/secret")
  @WebSessionOnly()
  regenerateSecret(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string) {
    return this.webhooksService.regenerateSecret(user.id, projectId);
  }

  /** Sends a test event ("ping") and returns how the call went. */
  @Post("webhook/ping")
  @WebSessionOnly()
  ping(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string, @Req() request: Request) {
    return this.webhooksService.ping(user.id, projectId, requestOrigin(request));
  }

  /** Whether CI was told about the run: the project has a webhook, and how its last call went. */
  @Get("runs/:runId/ci")
  runStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
  ) {
    return this.webhooksService.runStatus(user.id, projectId, runId);
  }

  /** Calls the webhook for the run again ("Trigger CI again"), for an open run with cases for automation. */
  @Post("runs/:runId/ci")
  retrigger(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
    @Req() request: Request,
  ) {
    return this.webhooksService.retrigger(user.id, projectId, runId, requestOrigin(request));
  }
}
