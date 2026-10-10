import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { InvitationsService } from "../invitations/invitations.service";
import { RegisterDto } from "./dto/register.dto";

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly invitations: InvitationsService,
  ) {}

  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  /**
   * Looks up the email case-insensitively: a user registered as "Ali@x.com" must
   * also be able to sign in with "ali@x.com", and the same address must not register twice.
   */
  findUserByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email: { equals: email.trim(), mode: "insensitive" } },
    });
  }

  /** Whether the login screen should show the sign-up link. */
  publicConfig() {
    return {
      selfRegistration: this.config.get<boolean>("auth.selfRegistration") ?? false,
    };
  }

  async login(email: string, password: string) {
    const user = await this.findUserByEmail(email);
    if (!user || !user.isActive) {
      throw new UnauthorizedException("Invalid email or password");
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException("Invalid email or password");
    }
    return this.issueSession(user);
  }

  /**
   * Creates an account. Open sign-up needs SELF_REGISTRATION; such a user is not a member
   * of any workspace and can create their own or be invited. With an invitation link the
   * invited account can be created even when sign-up is off, and it joins that workspace.
   */
  async register(dto: RegisterDto) {
    if (!dto.inviteToken && !this.publicConfig().selfRegistration) {
      throw new ForbiddenException(
        "Self-registration is disabled on this server; ask a workspace admin for an invitation link.",
      );
    }
    const email = dto.email.trim().toLowerCase();
    // The link comes first: a made-up one must not reveal which addresses have an account.
    if (dto.inviteToken) {
      await this.invitations.verify(dto.inviteToken, email);
    }
    if (await this.findUserByEmail(email)) {
      throw new ConflictException("An account with this email already exists. Try signing in.");
    }
    const passwordHash = await this.hashPassword(dto.password);
    const user = await this.prisma.$transaction(async (tx) => {
      const invitation = dto.inviteToken
        ? await this.invitations.claim(tx, dto.inviteToken, email)
        : null;
      const created = await tx.user.create({
        data: { email, displayName: dto.displayName.trim(), passwordHash },
      });
      if (invitation) {
        await tx.workspaceMember.create({
          data: { workspaceId: invitation.workspaceId, userId: created.id, role: invitation.role },
        });
      }
      return created;
    });
    return this.issueSession(user);
  }

  async updateProfile(userId: string, displayName: string) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { displayName: displayName.trim() },
    });
    return { id: user.id, email: user.email, displayName: user.displayName };
  }

  /**
   * Changing the password requires verifying the current one, so someone who
   * hijacks a session left open cannot take over the account permanently.
   * Not allowed with API tokens (a token must not change its owner's password).
   */
  async changePassword(
    userId: string,
    authMethod: "jwt" | "api-token",
    currentPassword: string,
    newPassword: string,
  ) {
    if (authMethod !== "jwt") {
      throw new ForbiddenException("The password can only be changed from a web session.");
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException("The current password is incorrect.");
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.hashPassword(newPassword) },
    });
  }

  private async issueSession(user: { id: string; email: string; displayName: string }) {
    const accessToken = await this.jwtService.signAsync({ sub: user.id });
    return {
      accessToken,
      user: { id: user.id, email: user.email, displayName: user.displayName },
    };
  }
}
