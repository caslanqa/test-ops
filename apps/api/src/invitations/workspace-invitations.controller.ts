import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { InvitationsService } from "./invitations.service";
import { CreateInvitationDto } from "./dto/create-invitation.dto";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../common/decorators/current-user.decorator";

@ApiTags("workspaces")
@Controller("workspaces/:workspaceId/invitations")
export class WorkspaceInvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  /**
   * Invites an email address to the workspace (workspace admins only). The response carries the
   * invitation link's token once; it looks the same whether or not the address has an account.
   */
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("workspaceId") workspaceId: string,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitationsService.create(user.id, workspaceId, dto);
  }

  /** Pending invitations of the workspace, without their links (workspace admins only). */
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param("workspaceId") workspaceId: string,
  ) {
    return this.invitationsService.list(user.id, workspaceId);
  }

  /** Revokes a pending invitation; its link stops working (workspace admins only). */
  @Delete(":invitationId")
  @HttpCode(204)
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param("workspaceId") workspaceId: string,
    @Param("invitationId") invitationId: string,
  ) {
    await this.invitationsService.revoke(user.id, workspaceId, invitationId);
  }
}
