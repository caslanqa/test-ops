import { ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ThrottlerException,
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerModuleOptions,
  ThrottlerOptions,
  ThrottlerRequest,
  seconds,
} from "@nestjs/throttler";
import * as crypto from "crypto";

/** Auth attempt kind; determines which identity (email, IP, user) is counted. */
export type AuthAttemptKind = "login" | "register" | "password-change";

const AUTH_ATTEMPT_KEY = "rateLimit:authAttempt";

/** All API requests: per signed-in user or per anonymous IP. */
export const DEFAULT_THROTTLER = "default";
/** Auth attempts: per account (+IP); slows down password guessing. */
export const AUTH_THROTTLER = "auth";
/** Auth attempts: per IP, independent of account (credential stuffing, mass sign-up). */
export const AUTH_IP_THROTTLER = "auth-ip";

/**
 * Marks the endpoint as an auth attempt; the `auth` and `auth-ip` limits apply in
 * addition to the general limit. Unmarked endpoints skip these two limits.
 *
 * @example
 * ```ts
 * @Public()
 * @RateLimitAuthAttempt("login")
 * @Post("login")
 * login(@Body() dto: LoginDto) {}
 * ```
 */
export const RateLimitAuthAttempt = (kind: AuthAttemptKind) =>
  SetMetadata(AUTH_ATTEMPT_KEY, kind);

/**
 * Builds the throttler list from the `rateLimit.*` settings. A throttler with limit 0
 * is never added, so the "disabled" setting needs no extra check in the guard.
 * Counters are kept in memory; running more than one replica requires a shared
 * storage (e.g. Redis).
 */
export function throttlerOptions(config: ConfigService): ThrottlerModuleOptions {
  const window = seconds(60);
  const candidates: ThrottlerOptions[] = [
    { name: DEFAULT_THROTTLER, ttl: window, limit: config.get<number>("rateLimit.perMinute", 600) },
    { name: AUTH_THROTTLER, ttl: window, limit: config.get<number>("rateLimit.authPerMinute", 10) },
    {
      name: AUTH_IP_THROTTLER,
      ttl: window,
      limit: config.get<number>("rateLimit.authIpPerMinute", 60),
    },
  ];
  return { throttlers: candidates.filter((throttler) => Number(throttler.limit) > 0) };
}

/**
 * The app's rate limit guard. It departs from the library defaults in three ways:
 * - The counter key is per identity, not per route; otherwise the limit runs
 *   separately for each endpoint and loses its "N requests per minute" meaning.
 * - The identity is chosen by throttler kind (user, IP, email + IP).
 * - A 429 response carries the standard `Retry-After` header and a user-facing message.
 *
 * Must run after AuthGuard (CommonModule orders them accordingly); only then is
 * `request.user` populated.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  /** Decides whether the throttler applies to this request and which identity it tracks. */
  protected async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { context, throttler } = requestProps;
    const kind = this.authAttemptKind(context);
    if (throttler.name !== DEFAULT_THROTTLER && !kind) {
      return true;
    }
    return super.handleRequest({
      ...requestProps,
      getTracker: (req) => this.trackerFor(throttler.name ?? DEFAULT_THROTTLER, req, kind),
    });
  }

  /** Counter key: throttler name + identity. Hashed so emails are not kept in memory. */
  protected generateKey(_context: ExecutionContext, tracker: string, name: string): string {
    return crypto.createHash("sha256").update(`${name}:${tracker}`).digest("hex");
  }

  /** 429 response: standard Retry-After header and a message stating the remaining wait. */
  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const { res } = this.getRequestResponse(context);
    const wait = Math.max(1, detail.timeToBlockExpire);
    // For named limits the library writes the header as e.g. "Retry-After-auth";
    // the header clients and proxies recognize is RFC 9110's Retry-After.
    this.setResponseHeader(res, "Retry-After", wait);
    const subject = this.authAttemptKind(context) ? "Too many attempts" : "Too many requests";
    throw new ThrottlerException(
      `${subject}. Try again in ${wait} second${wait === 1 ? "" : "s"}.`,
    );
  }

  /** The identity to count, based on the throttler kind. */
  private async trackerFor(
    name: string,
    req: Record<string, any>,
    kind: AuthAttemptKind | undefined,
  ): Promise<string> {
    // The base getTracker reduces IPv6 addresses to their /64 subnet; this stops a single
    // client from bypassing the limit by rotating addresses within its subnet.
    const ip = await super.getTracker(req);
    const userId: string | undefined = req.user?.id;

    if (name === AUTH_IP_THROTTLER) {
      return `ip:${ip}`;
    }
    if (name === AUTH_THROTTLER) {
      switch (kind) {
        case "password-change":
          // Slows down guessing the current password even if the session is hijacked.
          return `user:${userId}`;
        case "login": {
          // On shared IPs such as office NAT, different users must not lock each other out.
          const email = typeof req.body?.email === "string" ? req.body.email : "";
          return `login:${ip}:${email.trim().toLowerCase()}`;
        }
        default:
          return `${kind}:${ip}`;
      }
    }
    return userId ? `user:${userId}` : `ip:${ip}`;
  }

  /** The @RateLimitAuthAttempt marker on the handler. */
  private authAttemptKind(context: ExecutionContext): AuthAttemptKind | undefined {
    return this.reflector.get<AuthAttemptKind | undefined>(AUTH_ATTEMPT_KEY, context.getHandler());
  }
}
