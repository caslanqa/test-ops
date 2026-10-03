import { resolveJwtSecret } from "./jwt-secret";
import {
  ATTACHMENT_DEFAULT_ALLOWED_EXTENSIONS,
  ATTACHMENT_DEFAULT_MAX_FILES_PER_REQUEST,
  ATTACHMENT_DEFAULT_MAX_FILE_SIZE_BYTES,
  ATTACHMENT_DEFAULT_MAX_REQUEST_SIZE_BYTES,
} from "../attachments/attachments.constants";

/** Normalizes a comma-separated extension list ("png, .JPG,log"); undefined if empty. */
function parseExtensionList(value: string | undefined): string[] | undefined {
  const list = (value ?? "")
    .split(",")
    .map((ext) => ext.trim().replace(/^\./, "").toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

/**
 * Reads a numeric env value. Compose passes undefined variables as empty
 * strings, so an empty value also counts as "not set"; a non-numeric value
 * fails at startup instead of silently becoming a NaN limit. `allowZero` is
 * for settings where 0 means "disabled" (e.g. rate limit).
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
 * Express `trust proxy` setting. Off by default: if the app is exposed directly, the
 * client can forge X-Forwarded-For and bypass the rate limit. Behind a reverse
 * proxy, set "true", a hop count ("1") or a list of trusted addresses/subnets.
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
    // Self-registration; on closed installs only workspace admins create accounts.
    selfRegistration: process.env.SELF_REGISTRATION?.trim().toLowerCase() !== "false",
  },
  // Per-minute request limits; 0 disables that limit (see common/rate-limit.ts).
  rateLimit: {
    trustProxy: trustProxyFromEnv(),
    // The whole API, per signed-in user (JWT or API token) or per anonymous IP.
    perMinute: intFromEnv("RATE_LIMIT_PER_MINUTE", 600, { allowZero: true }),
    // Login/sign-up/password change: per account (+IP), slows down password attempts.
    authPerMinute: intFromEnv("AUTH_RATE_LIMIT_PER_MINUTE", 10, { allowZero: true }),
    // Attempts against different accounts from the same IP (credential stuffing, mass sign-up).
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
