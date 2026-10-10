import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ProjectsService } from "./projects.service";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import { AddProjectMemberDto } from "./dto/add-project-member.dto";
import { UpdateProjectMemberRoleDto } from "./dto/update-project-member-role.dto";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../common/decorators/current-user.decorator";
import type { Response } from "express";
import { PagedResponse, sendPage } from "../common/pagination";
import { ListProjectsQueryDto } from "./dto/list-projects-query.dto";
import { ListWorkspaceProjectsQueryDto } from "./dto/list-workspace-projects-query.dto";

@ApiTags("projects")
@Controller()
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post("workspaces/:workspaceId/projects")
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("workspaceId") workspaceId: string,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projectsService.create(user.id, workspaceId, dto);
  }

  @Get("workspaces/:workspaceId/projects")
  @PagedResponse()
  async listForWorkspace(
    @CurrentUser() user: AuthenticatedUser,
    @Param("workspaceId") workspaceId: string,
    @Query() query: ListWorkspaceProjectsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.projectsService.listForWorkspace(user.id, workspaceId, query));
  }

  @Get("projects/:projectId")
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
  ) {
    return this.projectsService.getOne(user.id, projectId);
  }

  @Patch("projects/:projectId")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.update(user.id, projectId, dto);
  }

  /**
   * Archives the project (project or workspace admins). It leaves the project lists and is
   * read-only until restored: its data can be read, but changes get 409.
   */
  @Delete("projects/:projectId")
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
  ) {
    return this.projectsService.archive(user.id, projectId);
  }

  /** Restores an archived project (project or workspace admins). */
  @Post("projects/:projectId/restore")
  @HttpCode(200)
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
  ) {
    return this.projectsService.restore(user.id, projectId);
  }

  @Get("projects/:projectId/members")
  listMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
  ) {
    return this.projectsService.listMembers(user.id, projectId);
  }

  @Post("projects/:projectId/members")
  addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() dto: AddProjectMemberDto,
  ) {
    return this.projectsService.addMember(user.id, projectId, dto);
  }

  @Patch("projects/:projectId/members/:memberId")
  updateMemberRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("memberId") memberId: string,
    @Body() dto: UpdateProjectMemberRoleDto,
  ) {
    return this.projectsService.updateMemberRole(
      user.id,
      projectId,
      memberId,
      dto.role,
    );
  }

  @Delete("projects/:projectId/members/:memberId")
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("memberId") memberId: string,
  ) {
    return this.projectsService.removeMember(user.id, projectId, memberId);
  }

  /** Every project the signed-in user can open, across workspaces. */
  @Get("projects")
  @PagedResponse()
  async listAccessible(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListProjectsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.projectsService.listAccessible(user.id, query));
  }
}
