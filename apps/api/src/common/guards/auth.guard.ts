import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import * as crypto from "crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

// A single Authorization: Bearer <value> scheme accepts both the web session JWT
// and automation/CI API tokens (FR: API operations are subject to the user's
// role and token permissions).
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers["authorization"];
    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }
    const token = authHeader.slice("Bearer ".length).trim();

    // JWTs have three dot-separated segments; API tokens are a single random string.
    if (token.split(".").length === 3) {
      try {
        const payload = await this.jwtService.verifyAsync(token);
        const user = await this.prisma.user.findUnique({
          where: { id: payload.sub },
        });
        // A password change raises sessionVersion and so ends the sessions signed in before it.
        // Tokens issued before session versions existed carry no `sv` and count as version 0.
        if (!user || !user.isActive || (payload.sv ?? 0) !== user.sessionVersion) {
          throw new UnauthorizedException("User not found or inactive");
        }
        request.user = {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          authMethod: "jwt",
        };
        return true;
      } catch {
        throw new UnauthorizedException("Invalid or expired session token");
      }
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const apiToken = await this.prisma.apiToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!apiToken || apiToken.revokedAt || !apiToken.user.isActive) {
      throw new UnauthorizedException("Invalid or revoked API token");
    }
    if (apiToken.expiresAt && apiToken.expiresAt <= new Date()) {
      throw new UnauthorizedException(
        "This API token has expired; create a new one under Account → API tokens",
      );
    }
    await this.prisma.apiToken.update({
      where: { id: apiToken.id },
      data: { lastUsedAt: new Date() },
    });
    request.user = {
      id: apiToken.user.id,
      email: apiToken.user.email,
      displayName: apiToken.user.displayName,
      authMethod: "api-token",
    };
    return true;
  }
}
