import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { WorkspacesService } from "./workspaces.service";
import { CreateWorkspaceDto } from "./dto/create-workspace.dto";
import { AddWorkspaceMemberDto } from "./dto/add-workspace-member.dto";
import { UpdateWorkspaceMemberRoleDto } from "./dto/update-member-role.dto";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../common/decorators/current-user.decorator";

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
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.workspacesService.listForUser(user.id);
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
    @Body("name") name: string,
  ) {
    return this.workspacesService.update(user.id, workspaceId, name);
  }

  @Get(":workspaceId/members")
  listMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param("workspaceId") workspaceId: string,
  ) {
    return this.workspacesService.listMembers(user.id, workspaceId);
  }

  @Post(":workspaceId/members")
  addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("workspaceId") workspaceId: string,
    @Body() dto: AddWorkspaceMemberDto,
  ) {
    return this.workspacesService.addMember(user.id, workspaceId, dto);
  }

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
}
