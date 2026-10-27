import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuthenticatedUser, CurrentUser } from "../../common/decorators/current-user.decorator";
import { WebSessionOnly } from "../../common/decorators/web-session-only.decorator";
import { SaveGuidanceDto, UpdateGuidanceDto } from "./dto/save-guidance.dto";
import { ToggleGuidanceDto } from "./dto/toggle-guidance.dto";
import { GuidanceService } from "./guidance.service";

/**
 * The team's guidance for the AI assistant: written by workspace admins for the whole workspace and by project
 * admins for their project (a workspace admin counts as admin of every project). It decides what is added to
 * what a model is sent, so none of it is open to API tokens.
 */
@ApiTags("ai")
@WebSessionOnly()
@Controller()
export class GuidanceController {
  constructor(private readonly guidance: GuidanceService) {}

  /** The workspace's guidance. */
  @Get("workspaces/:workspaceId/ai/guidance")
  listWorkspace(@CurrentUser() user: AuthenticatedUser, @Param("workspaceId") workspaceId: string) {
    return this.guidance.list(user.id, { kind: "WORKSPACE", id: workspaceId });
  }

  @Post("workspaces/:workspaceId/ai/guidance")
  createWorkspace(
    @CurrentUser() user: AuthenticatedUser,
    @Param("workspaceId") workspaceId: string,
    @Body() dto: SaveGuidanceDto,
  ) {
    return this.guidance.create(user.id, { kind: "WORKSPACE", id: workspaceId }, dto);
  }

  /** Switches a built-in pack on or off for the whole workspace. */
  @Put("workspaces/:workspaceId/ai/guidance/toggles")
  toggleWorkspace(
    @CurrentUser() user: AuthenticatedUser,
    @Param("workspaceId") workspaceId: string,
    @Body() dto: ToggleGuidanceDto,
  ) {
    return this.guidance.toggle(user.id, { kind: "WORKSPACE", id: workspaceId }, dto);
  }

  @Patch("workspaces/:workspaceId/ai/guidance/:guidanceId")
  updateWorkspace(
    @CurrentUser() user: AuthenticatedUser,
    @Param("workspaceId") workspaceId: string,
    @Param("guidanceId") guidanceId: string,
    @Body() dto: UpdateGuidanceDto,
  ) {
    return this.guidance.update(user.id, { kind: "WORKSPACE", id: workspaceId }, guidanceId, dto);
  }

  @Delete("workspaces/:workspaceId/ai/guidance/:guidanceId")
  @HttpCode(204)
  async removeWorkspace(
    @CurrentUser() user: AuthenticatedUser,
    @Param("workspaceId") workspaceId: string,
    @Param("guidanceId") guidanceId: string,
  ) {
    await this.guidance.remove(user.id, { kind: "WORKSPACE", id: workspaceId }, guidanceId);
  }

  /** Every version of one guidance, newest first. */
  @Get("workspaces/:workspaceId/ai/guidance/:guidanceId/versions")
  versionsWorkspace(
    @CurrentUser() user: AuthenticatedUser,
    @Param("workspaceId") workspaceId: string,
    @Param("guidanceId") guidanceId: string,
  ) {
    return this.guidance.versions(user.id, { kind: "WORKSPACE", id: workspaceId }, guidanceId);
  }

  /** The project's guidance, and the workspace's with whether each applies to the project. */
  @Get("projects/:projectId/ai/guidance")
  listProject(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string) {
    return this.guidance.list(user.id, { kind: "PROJECT", id: projectId });
  }

  @Post("projects/:projectId/ai/guidance")
  createProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() dto: SaveGuidanceDto,
  ) {
    return this.guidance.create(user.id, { kind: "PROJECT", id: projectId }, dto);
  }

  /** Switches a built-in pack, or a guidance of the workspace, on or off for this project alone. */
  @Put("projects/:projectId/ai/guidance/toggles")
  toggleProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() dto: ToggleGuidanceDto,
  ) {
    return this.guidance.toggle(user.id, { kind: "PROJECT", id: projectId }, dto);
  }

  @Patch("projects/:projectId/ai/guidance/:guidanceId")
  updateProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("guidanceId") guidanceId: string,
    @Body() dto: UpdateGuidanceDto,
  ) {
    return this.guidance.update(user.id, { kind: "PROJECT", id: projectId }, guidanceId, dto);
  }

  @Delete("projects/:projectId/ai/guidance/:guidanceId")
  @HttpCode(204)
  async removeProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("guidanceId") guidanceId: string,
  ) {
    await this.guidance.remove(user.id, { kind: "PROJECT", id: projectId }, guidanceId);
  }

  @Get("projects/:projectId/ai/guidance/:guidanceId/versions")
  versionsProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("guidanceId") guidanceId: string,
  ) {
    return this.guidance.versions(user.id, { kind: "PROJECT", id: projectId }, guidanceId);
  }
}
