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

/** Kimlik denemesi türü; hangi kimliğin (e-posta, IP, kullanıcı) sayılacağını belirler. */
export type AuthAttemptKind = "login" | "register" | "password-change";

const AUTH_ATTEMPT_KEY = "rateLimit:authAttempt";

/** Tüm API istekleri: oturum açmış kullanıcı veya anonim IP başına. */
export const DEFAULT_THROTTLER = "default";
/** Kimlik denemeleri: hesap (+IP) başına; parola tahminini yavaşlatır. */
export const AUTH_THROTTLER = "auth";
/** Kimlik denemeleri: IP başına, hesaptan bağımsız (credential stuffing, toplu kayıt). */
export const AUTH_IP_THROTTLER = "auth-ip";

/**
 * Endpoint'i kimlik denemesi olarak işaretler; genel limite ek olarak `auth` ve
 * `auth-ip` limitleri uygulanır. İşaretsiz endpoint'lerde bu iki limit atlanır.
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
 * `rateLimit.*` ayarlarından throttler listesini üretir. Limiti 0 olan throttler
 * listeye hiç eklenmez, böylece "kapalı" ayarı guard'da ek kontrol gerektirmez.
 * Sayaçlar bellekte tutulur; birden fazla replika çalıştırılacaksa paylaşılan
 * bir storage (ör. Redis) gerekir.
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
 * Uygulamanın rate limit guard'ı. Kütüphanenin varsayılanlarından üç noktada ayrılır:
 * - Sayaç anahtarı route başına değil kimlik başınadır; aksi halde limit her
 *   endpoint için ayrı ayrı işler ve "dakikada N istek" anlamını yitirir.
 * - Kimlik, throttler türüne göre seçilir (kullanıcı, IP, e-posta + IP).
 * - 429 yanıtında standart `Retry-After` başlığı ve kullanıcıya gösterilebilir mesaj döner.
 *
 * AuthGuard'dan sonra çalışmalıdır (CommonModule'de sıra buna göre); `request.user`
 * ancak o zaman doludur.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  /** Throttler'ın bu istekte uygulanıp uygulanmayacağına ve kimliğe karar verir. */
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

  /** Sayaç anahtarı: throttler adı + kimlik. Bellekte e-posta tutmamak için hash'lenir. */
  protected generateKey(_context: ExecutionContext, tracker: string, name: string): string {
    return crypto.createHash("sha256").update(`${name}:${tracker}`).digest("hex");
  }

  /** 429 yanıtı: standart Retry-After başlığı ve kalan süreyi söyleyen mesaj. */
  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const { res } = this.getRequestResponse(context);
    const wait = Math.max(1, detail.timeToBlockExpire);
    // Kütüphane adlandırılmış limitlerde başlığı "Retry-After-auth" gibi yazıyor;
    // istemcilerin ve proxy'lerin tanıdığı başlık RFC 9110'daki Retry-After.
    this.setResponseHeader(res, "Retry-After", wait);
    const subject = this.authAttemptKind(context) ? "Too many attempts" : "Too many requests";
    throw new ThrottlerException(
      `${subject}. Try again in ${wait} second${wait === 1 ? "" : "s"}.`,
    );
  }

  /** Throttler türüne göre sayılacak kimlik. */
  private async trackerFor(
    name: string,
    req: Record<string, any>,
    kind: AuthAttemptKind | undefined,
  ): Promise<string> {
    // Temel getTracker IPv6 adreslerini /64 alt ağa indirger; tek bir istemcinin
    // alt ağındaki adresleri döndürerek limiti atlatmasını engeller.
    const ip = await super.getTracker(req);
    const userId: string | undefined = req.user?.id;

    if (name === AUTH_IP_THROTTLER) {
      return `ip:${ip}`;
    }
    if (name === AUTH_THROTTLER) {
      switch (kind) {
        case "password-change":
          // Oturum ele geçirilse bile mevcut parolanın tahmin edilmesini yavaşlatır.
          return `user:${userId}`;
        case "login": {
          // Ofis NAT'ı gibi paylaşılan IP'lerde farklı kullanıcılar birbirini kilitlemesin.
          const email = typeof req.body?.email === "string" ? req.body.email : "";
          return `login:${ip}:${email.trim().toLowerCase()}`;
        }
        default:
          return `${kind}:${ip}`;
      }
    }
    return userId ? `user:${userId}` : `ip:${ip}`;
  }

  /** Handler'daki @RateLimitAuthAttempt işareti. */
  private authAttemptKind(context: ExecutionContext): AuthAttemptKind | undefined {
    return this.reflector.get<AuthAttemptKind | undefined>(AUTH_ATTEMPT_KEY, context.getHandler());
  }
}
