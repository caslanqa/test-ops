import { resolveJwtSecret } from "./jwt-secret";
import {
  ATTACHMENT_DEFAULT_ALLOWED_EXTENSIONS,
  ATTACHMENT_DEFAULT_MAX_FILES_PER_REQUEST,
  ATTACHMENT_DEFAULT_MAX_FILE_SIZE_BYTES,
  ATTACHMENT_DEFAULT_MAX_REQUEST_SIZE_BYTES,
} from "../attachments/attachments.constants";

/**
 * Default for the largest JSON body of the bulk result upload: room for 500 results with their
 * failure messages (FR-074). Express's own 100 KB default rejected realistic CI uploads. All other
 * JSON requests keep the 100 KB default.
 */
const JSON_DEFAULT_MAX_REQUEST_SIZE_BYTES = 10 * 1024 * 1024;

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

/**
 * The key that encrypts saved AI provider keys: 32 bytes written as 64 hex characters. Empty means
 * none is set, and then a provider key can't be saved. A value that is not a valid key fails at
 * startup: a mistyped key would otherwise only show when saved keys can't be read.
 */
function aiEncryptionKeyFromEnv(): Buffer | null {
  const raw = process.env.AI_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      "AI_ENCRYPTION_KEY must be 64 hexadecimal characters (32 bytes); generate one with: openssl rand -hex 32",
    );
  }
  return Buffer.from(raw, "hex");
}

export default () => ({
  port: parseInt(process.env.PORT ?? "3000", 10),
  ai: {
    encryptionKey: aiEncryptionKeyFromEnv(),
  },
  // Set at image build time from the release version (Dockerfile ARG APP_VERSION); "dev" for local builds.
  version: process.env.APP_VERSION?.trim() || "dev",
  auth: {
    // Self-registration; on closed installs people join through workspace invitation links.
    selfRegistration: process.env.SELF_REGISTRATION?.trim().toLowerCase() !== "false",
  },
  // Every user's own DEMO workspace with an example project (DemoService). On unless
  // DEMO_WORKSPACE=false; turning it off makes no new ones and keeps the existing ones.
  demo: {
    enabled: process.env.DEMO_WORKSPACE?.trim().toLowerCase() !== "false",
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
  http: {
    // The bulk result upload only; other JSON bodies stay at 100 KB, and multipart attachment
    // uploads have their own limits below.
    maxJsonBodyBytes: intFromEnv(
      "JSON_MAX_REQUEST_SIZE_BYTES",
      JSON_DEFAULT_MAX_REQUEST_SIZE_BYTES,
    ),
  },
  webhooks: {
    // Lets webhooks reach private and local addresses, for CI on the internal network (see
    // webhooks/safe-post.ts). Off by default, so a shared server can't be used to probe its own network.
    allowPrivateNetworks: process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS?.trim().toLowerCase() === "true",
  },
  // The app's public address, for links sent to CI; Coolify sets SERVICE_URL_APP_3000. Without
  // either, the address the request came to is used.
  publicUrl: (process.env.PUBLIC_URL?.trim() || process.env.SERVICE_URL_APP_3000?.trim() || "").replace(/\/+$/, "") || null,
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
