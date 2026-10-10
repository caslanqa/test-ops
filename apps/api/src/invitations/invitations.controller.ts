import { Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { InvitationsService } from "./invitations.service";
import { Public } from "../common/decorators/public.decorator";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../common/decorators/current-user.decorator";

/** The invitation link's side: what the invited person sees and does. */
@ApiTags("invitations")
@Controller("invitations")
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  /** The workspace, invited email address and role behind an invitation link; no sign-in needed. */
  @Public()
  @Get(":token")
  preview(@Param("token") token: string) {
    return this.invitationsService.preview(token);
  }

  /** Joins the workspace with the signed-in account, which must have the invited email address. */
  @Post(":token/accept")
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param("token") token: string,
  ) {
    return this.invitationsService.accept(user, token);
  }
}
