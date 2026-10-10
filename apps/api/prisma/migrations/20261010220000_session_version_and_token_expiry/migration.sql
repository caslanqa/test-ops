-- Session and API token lifetimes (FR-073, design-doc section 8).
--
-- users.sessionVersion is carried in every session token; a password change raises it, which
-- ends the sessions signed in before the change. Existing sessions carry no version and count
-- as version 0, so nobody is signed out by this migration. api_tokens.expiresAt is optional;
-- existing tokens keep working without an expiry date.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "api_tokens" ADD COLUMN     "expiresAt" TIMESTAMP(3);
