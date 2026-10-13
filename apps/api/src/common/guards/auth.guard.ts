import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService, TokenExpiredError } from "@nestjs/jwt";
import * as crypto from "crypto";
import type { Request, Response } from "express";
import { PrismaService } from "../../prisma/prisma.service";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { AuthenticatedUser } from "../decorators/current-user.decorator";
import {
  WEB_SESSION_ONLY_KEY,
  WEB_SESSION_ONLY_MESSAGE,
} from "../decorators/web-session-only.decorator";
import { AuthFailureLimiter } from "../rate-limit";

/**
 * A session token this server signed that no longer works: it expired, or its user is gone or
 * deactivated. It can't be a guess, so it gets 401 even from a blocked address and doesn't count
 * as a failure; the web app sees the 401 and sends the user to sign in.
 */
class SessionEndedException extends UnauthorizedException {
  constructor() {
    super("Your session has ended; sign in again.");
  }
}

// A single Authorization: Bearer <value> scheme accepts both the web session JWT
// and automation/CI API tokens (FR: API operations are subject to the user's
// role and token permissions).
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly authFailures: AuthFailureLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest();
    try {
      request.user = await this.authenticate(request, http.getResponse());
    } catch (error) {
      // Requests that fail to authenticate count against the client's address (FR-077).
      if (error instanceof UnauthorizedException && !(error instanceof SessionEndedException)) {
        const wait = await this.authFailures.recordFailure(request);
        if (wait > 0) this.authFailures.reject(http.getResponse(), wait);
      }
      throw error;
    }

    // Endpoints marked @WebSessionOnly() refuse API tokens, so a leaked token can't use them to
    // keep or widen its access. A 403, not a failed authentication: the limiter doesn't count it.
    const webSessionOnly = this.reflector.getAllAndOverride<boolean>(WEB_SESSION_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (webSessionOnly && request.user.authMethod !== "jwt") {
      throw new ForbiddenException(WEB_SESSION_ONLY_MESSAGE);
    }
    return true;
  }

  /** The user behind the request's bearer token; 401 when it is missing or not valid. */
  private async authenticate(request: Request, response: Response): Promise<AuthenticatedUser> {
    const authHeader = request.headers["authorization"];
    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }
    const token = authHeader.slice("Bearer ".length).trim();

    // JWTs have three dot-separated segments; API tokens are a single random string.
    if (token.split(".").length === 3) {
      let payload: { sub?: string; sv?: number };
      try {
        payload = await this.jwtService.verifyAsync(token);
      } catch (error) {
        // The signature is checked before the expiry, so an expired token is one this server
        // signed: the session ended rather than being guessed.
        if (error instanceof TokenExpiredError) throw new SessionEndedException();
        throw new UnauthorizedException("Invalid or expired session token");
      }
      // Outside the try block on purpose: a database error or pool timeout here is not an
      // authentication failure. It propagates as 5xx, so the web app doesn't sign the user out
      // and the failure limiter doesn't count it.
      const user = payload.sub
        ? await this.prisma.user.findUnique({ where: { id: payload.sub } })
        : null;
      // A password change raises sessionVersion and so ends the sessions signed in before it.
      // Tokens issued before session versions existed carry no `sv` and count as version 0.
      if (!user || !user.isActive || (payload.sv ?? 0) !== user.sessionVersion) {
        throw new SessionEndedException();
      }
      return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        authMethod: "jwt",
        sessionVersion: user.sessionVersion,
      };
    }

    // An address over its failure limit gets no API token lookups, so a flood of guessed tokens
    // can't keep the database busy. Valid web sessions (above) are still served.
    const wait = this.authFailures.retryAfter(request);
    if (wait > 0) this.authFailures.reject(response, wait);

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
    return {
      id: apiToken.user.id,
      email: apiToken.user.email,
      displayName: apiToken.user.displayName,
      authMethod: "api-token",
    };
  }
}
