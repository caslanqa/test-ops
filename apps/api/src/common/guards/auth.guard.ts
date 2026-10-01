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

// Tek bir Authorization: Bearer <value> şeması hem web oturum JWT'sini
// hem de otomasyon/CI API token'larını kabul eder (FR: API işlemleri kullanıcı
// rolü ve token izinlerine tabidir).
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

    // JWT'ler üç nokta-ayrılmış segment içerir; API token'ları rastgele tek bir dizedir.
    if (token.split(".").length === 3) {
      try {
        const payload = await this.jwtService.verifyAsync(token);
        const user = await this.prisma.user.findUnique({
          where: { id: payload.sub },
        });
        if (!user || !user.isActive) {
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
