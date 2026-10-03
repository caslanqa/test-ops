import { Logger } from "@nestjs/common";

// design-doc.md section 7-8: secrets are not baked into the image. With a default or
// weak JWT secret anyone can mint a valid session token and sign in as any user
// they like; so in production the app never starts with such a secret.
// In development only a warning is logged, so as not to break the workflow.

/** Placeholder values that appear in the repo's example files; rejected in production. */
const PLACEHOLDER_SECRETS = new Set([
  "change-me-in-production",
  "change-me",
  "changeme",
  "secret",
]);

/** Recommended minimum key length for HS256 (256 bits). */
export const MIN_JWT_SECRET_LENGTH = 32;

const DEV_FALLBACK_SECRET = "dev-only-insecure-jwt-secret";
const HOW_TO_FIX =
  "Provide a random value of at least 32 characters (e.g. `openssl rand -hex 32`) " +
  "or let `scripts/start.sh` generate one.";

/**
 * Reads the JWT signing secret from the environment and validates it.
 * With `NODE_ENV=production` it throws on a missing, placeholder or short secret;
 * since the error happens while config is loading, the app never bootstraps.
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
