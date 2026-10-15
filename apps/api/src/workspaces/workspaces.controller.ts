import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { WorkspacesService } from "./workspaces.service";
import { CreateWorkspaceDto } from "./dto/create-workspace.dto";
import { UpdateWorkspaceDto } from "./dto/update-workspace.dto";
import { UpdateWorkspaceMemberRoleDto } from "./dto/update-member-role.dto";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../common/decorators/current-user.decorator";
import type { Response } from "express";
import { PageQueryDto, PagedResponse, sendPage } from "../common/pagination";
import { WebSessionOnly } from "../common/decorators/web-session-only.decorator";
import { DeleteWorkspaceDto } from "./dto/delete-workspace.dto";
import { SetProjectRoleDto } from "./dto/set-project-role.dto";

@ApiTags("workspaces")
@Controller("workspaces")
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWorkspaceDto,
  ) {
    return this.workspacesService.create(user.id, dto);
  }

  @Get()
  @PagedResponse()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PageQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.workspacesService.listForUser(user.id, query));
  }

  @Get(":workspaceId")
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param("workspaceId") workspaceId: string,
  ) {
    return this.workspacesService.getOne(user.id, workspaceId);
  }

  @Patch(":workspaceId")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("workspaceId") workspaceId: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.workspacesService.update(user.id, workspaceId, dto);
  }

  @Get(":workspaceId/members")
  listMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param("workspaceId") workspaceId: string,
  ) {
    return this.workspacesService.listMembers(user.id, workspaceId);
  }

  /** Changes a member's workspace role. Web session only: a leaked token must not grant roles. */
  @WebSessionOnly()
  @Patch(":workspaceId/members/:memberId")
  updateMemberRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param("workspaceId") workspaceId: string,
    @Param("memberId") memberId: string,
    @Body() dto: UpdateWorkspaceMemberRoleDto,
  ) {
    return this.workspacesService.updateMemberRole(
      user.id,
      workspaceId,
      memberId,
      dto.role,
    );
  }

  @Delete(":workspaceId/members/:memberId")
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("workspaceId") workspaceId: string,
    @Param("memberId") memberId: string,
  ) {
    return this.workspacesService.removeMember(user.id, workspaceId, memberId);
  }

  /**
   * Who can do what in the workspace (workspace admins): members with their workspace role, the
   * active projects, and each member's role in each project.
   */
  @Get(":workspaceId/permissions")
  permissions(
    @CurrentUser() user: AuthenticatedUser,
    @Param("workspaceId") workspaceId: string,
  ) {
    return this.workspacesService.permissions(user.id, workspaceId);
  }

  /**
   * Sets a member's role in a project of the workspace, or removes them from it with role null
   * (workspace admins). Web session only: a leaked token must not grant roles.
   */
  @WebSessionOnly()
  @Put(":workspaceId/permissions/projects/:projectId/users/:userId")
  setProjectRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("userId") userId: string,
    @Body() dto: SetProjectRoleDto,
  ) {
    return this.workspacesService.setProjectRole(user.id, workspaceId, projectId, userId, dto.role);
  }

  /** Deletes the workspace with all its projects and data; send the workspace name to confirm. */
  @Delete(":workspaceId")
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("workspaceId") workspaceId: string,
    @Body() dto: DeleteWorkspaceDto,
  ) {
    await this.workspacesService.remove(user.id, workspaceId, dto.confirmName);
  }
}
