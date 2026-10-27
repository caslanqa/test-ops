import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuthenticatedUser, CurrentUser } from "../common/decorators/current-user.decorator";
import { WebSessionOnly } from "../common/decorators/web-session-only.decorator";
import { AiSettingsService } from "./ai-settings.service";
import { SaveAiSettingsDto } from "./dto/save-ai-settings.dto";
import { TestAiSettingsDto } from "./dto/test-ai-settings.dto";

/**
 * Who defines the AI provider, and where. The workspace default is for workspace admins; a project's own
 * setting for its project admins (a workspace admin counts). The settings say where project data may be
 * sent and hold a provider key, so none of this is open to API tokens: a leaked token must not be able to
 * aim the server somewhere new. Only the status is open to every member of the project.
 */
@ApiTags("ai")
@Controller()
export class AiSettingsController {
  constructor(private readonly settings: AiSettingsService) {}

  /** Whether AI is on for the project and which setting is behind it; any member. */
  @Get("projects/:projectId/ai/status")
  status(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string) {
    return this.settings.status(user.id, projectId);
  }

  /** The workspace default (workspace admins); the provider key is never returned. */
  @Get("workspaces/:workspaceId/ai")
  @WebSessionOnly()
  getWorkspace(@CurrentUser() user: AuthenticatedUser, @Param("workspaceId") workspaceId: string) {
    return this.settings.getWorkspace(user.id, workspaceId);
  }

  /** Creates or changes the workspace default (workspace admins). */
  @Put("workspaces/:workspaceId/ai")
  @WebSessionOnly()
  saveWorkspace(
    @CurrentUser() user: AuthenticatedUser,
    @Param("workspaceId") workspaceId: string,
    @Body() dto: SaveAiSettingsDto,
  ) {
    return this.settings.saveWorkspace(user.id, workspaceId, dto);
  }

  @Delete("workspaces/:workspaceId/ai")
  @WebSessionOnly()
  @HttpCode(204)
  async removeWorkspace(@CurrentUser() user: AuthenticatedUser, @Param("workspaceId") workspaceId: string) {
    await this.settings.removeWorkspace(user.id, workspaceId);
  }

  /**
   * One small request with no project content; says whether it worked. With the form's values in the body it tests
   * those before they are saved (a pass returns a `proof` for saving them as tested); without a body, the saved default.
   */
  @Post("workspaces/:workspaceId/ai/test")
  @WebSessionOnly()
  @HttpCode(200)
  testWorkspace(
    @CurrentUser() user: AuthenticatedUser,
    @Param("workspaceId") workspaceId: string,
    @Body() dto: TestAiSettingsDto,
  ) {
    return this.settings.test(user.id, { workspaceId }, dto);
  }

  /** The project's own setting and the workspace default it would use without one (project admins). */
  @Get("projects/:projectId/ai/settings")
  @WebSessionOnly()
  getProject(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string) {
    return this.settings.getProject(user.id, projectId);
  }

  /** Creates or changes the project's own setting, which replaces the workspace default whole (project admins). */
  @Put("projects/:projectId/ai/settings")
  @WebSessionOnly()
  saveProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() dto: SaveAiSettingsDto,
  ) {
    return this.settings.saveProject(user.id, projectId, dto);
  }

  /** Removes the project's own setting: the project uses the workspace default again. */
  @Delete("projects/:projectId/ai/settings")
  @WebSessionOnly()
  @HttpCode(204)
  async removeProject(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string) {
    await this.settings.removeProject(user.id, projectId);
  }

  /** The same for the project's own setting: the form's values in the body, or the saved setting without one. */
  @Post("projects/:projectId/ai/settings/test")
  @WebSessionOnly()
  @HttpCode(200)
  testProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() dto: TestAiSettingsDto,
  ) {
    return this.settings.test(user.id, { projectId }, dto);
  }
}
