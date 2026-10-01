import { Logger } from "@nestjs/common";

// design-doc.md bölüm 7-8: secret'lar image'a gömülmez. Varsayılan veya zayıf bir
// JWT secret ile herkes geçerli oturum token'ı üretip istediği kullanıcı olarak
// giriş yapabilir; bu yüzden production'da uygulama böyle bir secret ile hiç
// başlamaz. Geliştirme ortamında akışı bozmamak için yalnızca uyarı verilir.

/** Repo'daki örnek dosyalarda geçen yer tutucu değerler; production'da kabul edilmez. */
const PLACEHOLDER_SECRETS = new Set([
  "change-me-in-production",
  "change-me",
  "changeme",
  "secret",
]);

/** HS256 için önerilen asgari anahtar uzunluğu (256 bit). */
export const MIN_JWT_SECRET_LENGTH = 32;

const DEV_FALLBACK_SECRET = "dev-only-insecure-jwt-secret";
const HOW_TO_FIX =
  "Provide a random value of at least 32 characters (e.g. `openssl rand -hex 32`) " +
  "or let `scripts/start.sh` generate one.";

/**
 * JWT imzalama secret'ını ortamdan okur ve doğrular.
 * `NODE_ENV=production` iken eksik, yer tutucu veya kısa secret'ta hata fırlatır;
 * hata config yüklenirken oluştuğu için uygulama bootstrap edilmez.
 */
export function resolveJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.JWT_SECRET?.trim() ?? "";
  const isProduction = env.NODE_ENV === "production";

  if (!isProduction) {
    if (!secret || PLACEHOLDER_SECRETS.has(secret)) {
      new Logger("Config").warn(
        "JWT_SECRET is missing or a placeholder; accepted for development only.",
      );
    }
    return secret || DEV_FALLBACK_SECRET;
  }

  if (!secret) {
    throw new Error(`JWT_SECRET is not set. ${HOW_TO_FIX}`);
  }
  if (PLACEHOLDER_SECRETS.has(secret)) {
    throw new Error(`JWT_SECRET is a placeholder value ("${secret}"). ${HOW_TO_FIX}`);
  }
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET is too short (${secret.length} characters). ${HOW_TO_FIX}`,
    );
  }
  return secret;
}
