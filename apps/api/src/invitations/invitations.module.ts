import { Module } from "@nestjs/common";
import { InvitationsService } from "./invitations.service";
import { InvitationsController } from "./invitations.controller";
import { WorkspaceInvitationsController } from "./workspace-invitations.controller";

/** Exported for AuthModule: creating an account with an invitation link joins its workspace. */
@Module({
  controllers: [WorkspaceInvitationsController, InvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
