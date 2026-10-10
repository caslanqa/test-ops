import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, WorkspaceRole } from "@prisma/client";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AccessControlService } from "../common/access-control.service";
import { AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { CreateInvitationDto } from "./dto/create-invitation.dto";

/** How long an invitation link works. */
const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

const INVALID_LINK =
  "This invitation link is invalid, has expired or was already used. Ask a workspace admin for a new one.";

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Invitations that can still be accepted. */
function pending(): Prisma.WorkspaceInvitationWhereInput {
  return { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } };
}

/**
 * Workspace invitations (FR-002). An admin invites an email address and gets a link to share.
 * The answer is the same whether or not the address has an account, so inviting can't be used
 * to find out who has one, and nobody becomes a member without accepting. The account with the
 * invited email accepts the link, or the link's holder creates that account, also when
 * SELF_REGISTRATION is off. A link works once.
 */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
  ) {}

  async create(userId: string, workspaceId: string, dto: CreateInvitationDto) {
    await this.accessControl.requireWorkspaceRole(userId, workspaceId, [
      WorkspaceRole.ADMIN,
    ]);
    const email = dto.email.trim().toLowerCase();
    // Admins can list the members anyway, so saying someone already is one reveals nothing.
    const member = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, user: { email: { equals: email, mode: "insensitive" } } },
    });
    if (member) {
      throw new ConflictException("This person is already a member of the workspace.");
    }
    const token = `inv_${crypto.randomBytes(32).toString("base64url")}`;
    const [, invitation] = await this.prisma.$transaction([
      // A new invitation replaces a pending one for the same address; the old link stops working.
      this.prisma.workspaceInvitation.updateMany({
        where: { workspaceId, email, ...pending() },
        data: { revokedAt: new Date() },
      }),
      this.prisma.workspaceInvitation.create({
        data: {
          workspaceId,
          email,
          role: dto.role,
          tokenHash: hashToken(token),
          invitedById: userId,
          expiresAt: new Date(Date.now() + INVITATION_LIFETIME_MS),
        },
      }),
    ]);
    return {
      id: invitation.id,
      email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      token, // visible only in this response
    };
  }

  /** Pending invitations of the workspace, without their links. */
  async list(userId: string, workspaceId: string) {
    await this.accessControl.requireWorkspaceRole(userId, workspaceId, [
      WorkspaceRole.ADMIN,
    ]);
    return this.prisma.workspaceInvitation.findMany({
      where: { workspaceId, ...pending() },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        createdAt: true,
        invitedBy: { select: { displayName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async revoke(userId: string, workspaceId: string, invitationId: string) {
    await this.accessControl.requireWorkspaceRole(userId, workspaceId, [
      WorkspaceRole.ADMIN,
    ]);
    const { count } = await this.prisma.workspaceInvitation.updateMany({
      where: { id: invitationId, workspaceId, ...pending() },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException("Invitation not found");
  }

  /** What the link's holder sees before accepting: the workspace, the invited address and the role. */
  async preview(token: string) {
    const invitation = await this.prisma.workspaceInvitation.findFirst({
      where: { tokenHash: hashToken(token), ...pending() },
      include: { workspace: { select: { id: true, name: true } } },
    });
    if (!invitation) throw new NotFoundException(INVALID_LINK);
    return {
      workspace: invitation.workspace,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    };
  }

  /** The signed-in account with the invited email joins the workspace. */
  async accept(user: AuthenticatedUser, token: string) {
    return this.prisma.$transaction(async (tx) => {
      const invitation = await this.claim(tx, token, user.email);
      // A member who is invited again keeps their role; an invitation never changes it.
      const membership = await tx.workspaceMember.upsert({
        where: {
          workspaceId_userId: { workspaceId: invitation.workspaceId, userId: user.id },
        },
        create: {
          workspaceId: invitation.workspaceId,
          userId: user.id,
          role: invitation.role,
        },
        update: {},
      });
      return { workspaceId: membership.workspaceId, role: membership.role };
    });
  }

  /**
   * Throws unless the link is a pending invitation for `email`. Sign-up checks the link before
   * anything else, so a made-up link can't be used to find out which addresses have accounts.
   */
  async verify(token: string, email: string) {
    await this.findFor(this.prisma, token, email);
  }

  /**
   * Uses up a pending invitation for `email` in the caller's transaction, when it is accepted or
   * when the invited account is created with it. The conditional update lets a link work only
   * once, even when two requests use it at the same moment.
   */
  async claim(tx: Prisma.TransactionClient, token: string, email: string) {
    const invitation = await this.findFor(tx, token, email);
    const { count } = await tx.workspaceInvitation.updateMany({
      where: { id: invitation.id, ...pending() },
      data: { acceptedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException(INVALID_LINK);
    return invitation;
  }

  /** The pending invitation behind the link; only the invited address can use it. */
  private async findFor(client: Prisma.TransactionClient, token: string, email: string) {
    const invitation = await client.workspaceInvitation.findFirst({
      where: { tokenHash: hashToken(token), ...pending() },
    });
    if (!invitation) throw new NotFoundException(INVALID_LINK);
    if (invitation.email !== email.trim().toLowerCase()) {
      throw new ForbiddenException(
        `This invitation is for ${invitation.email}; only that email address can use it.`,
      );
    }
    return invitation;
  }
}
