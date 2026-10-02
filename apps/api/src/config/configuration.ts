import { resolveJwtSecret } from "./jwt-secret";
import {
  ATTACHMENT_DEFAULT_ALLOWED_EXTENSIONS,
  ATTACHMENT_DEFAULT_MAX_FILES_PER_REQUEST,
  ATTACHMENT_DEFAULT_MAX_FILE_SIZE_BYTES,
  ATTACHMENT_DEFAULT_MAX_REQUEST_SIZE_BYTES,
} from "../attachments/attachments.constants";

/** Virgülle ayrılmış uzantı listesini ("png, .JPG,log") normalize eder; boşsa undefined. */
function parseExtensionList(value: string | undefined): string[] | undefined {
  const list = (value ?? "")
    .split(",")
    .map((ext) => ext.trim().replace(/^\./, "").toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

/**
 * Sayısal env değerini okur. Compose, tanımsız değişkenleri boş string olarak
 * geçirdiği için boş değer de "verilmemiş" sayılır; sayı olmayan değer
 * sessizce NaN limitine dönüşmek yerine başlangıçta hata verir. `allowZero`,
 * 0'ın "kapalı" anlamına geldiği ayarlar içindir (ör. rate limit).
 */
function intFromEnv(name: string, fallback: number, { allowZero = false } = {}): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  const min = allowZero ? 0 : 1;
  if (!Number.isInteger(value) || value < min) {
    const expected = allowZero ? "a non-negative integer" : "a positive integer";
    throw new Error(`${name} must be ${expected} (got "${raw}")`);
  }
  return value;
}

/**
 * Express `trust proxy` ayarı. Varsayılan kapalı: uygulama doğrudan yayınlanıyorsa
 * X-Forwarded-For istemci tarafından uydurulabilir ve rate limit atlatılır. Ters
 * proxy arkasında "true", hop sayısı ("1") veya güvenilen adres/alt ağ listesi verilir.
 */
function trustProxyFromEnv(): boolean | number | string {
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw || raw.toLowerCase() === "false") return false;
  if (raw.toLowerCase() === "true") return true;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

export default () => ({
  port: parseInt(process.env.PORT ?? "3000", 10),
  auth: {
    // Kendi kendine kayıt; kapalı kurulumlarda hesapları yalnızca workspace admin'leri oluşturur.
    selfRegistration: process.env.SELF_REGISTRATION?.trim().toLowerCase() !== "false",
  },
  // Dakikalık istek limitleri; 0 ilgili limiti kapatır (bkz. common/rate-limit.ts).
  rateLimit: {
    trustProxy: trustProxyFromEnv(),
    // Oturum açmış kullanıcı (JWT veya API token) ya da anonim IP başına tüm API.
    perMinute: intFromEnv("RATE_LIMIT_PER_MINUTE", 600, { allowZero: true }),
    // Giriş/kayıt/parola değişikliği: hesap (+IP) başına, parola denemelerini yavaşlatır.
    authPerMinute: intFromEnv("AUTH_RATE_LIMIT_PER_MINUTE", 10, { allowZero: true }),
    // Aynı IP'den farklı hesaplara yapılan denemeler (credential stuffing, toplu kayıt).
    authIpPerMinute: intFromEnv("AUTH_IP_RATE_LIMIT_PER_MINUTE", 60, { allowZero: true }),
  },
  jwt: {
    secret: resolveJwtSecret(),
    expiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  },
  attachments: {
    dir: process.env.ATTACHMENTS_DIR ?? "./data/attachments",
    maxFileSizeBytes: intFromEnv(
      "ATTACHMENT_MAX_FILE_SIZE_BYTES",
      ATTACHMENT_DEFAULT_MAX_FILE_SIZE_BYTES,
    ),
    maxRequestSizeBytes: intFromEnv(
      "ATTACHMENT_MAX_REQUEST_SIZE_BYTES",
      ATTACHMENT_DEFAULT_MAX_REQUEST_SIZE_BYTES,
    ),
    maxFilesPerRequest: intFromEnv(
      "ATTACHMENT_MAX_FILES_PER_REQUEST",
      ATTACHMENT_DEFAULT_MAX_FILES_PER_REQUEST,
    ),
    allowedExtensions:
      parseExtensionList(process.env.ATTACHMENT_ALLOWED_EXTENSIONS) ??
      ATTACHMENT_DEFAULT_ALLOWED_EXTENSIONS,
  },
});
