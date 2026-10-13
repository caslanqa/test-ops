import { ForbiddenException } from "@nestjs/common";
import type { AuthenticatedUser } from "./decorators/current-user.decorator";

/**
 * Operations that open or widen access for other people (invitations, role changes) need a
 * signed-in person. An API token is meant for automation and can outlive the permissions it was
 * created with, so it must not be able to create persistent access, such as an invitation link
 * that lets someone join long after the token is revoked.
 */
export function requireWebSession(user: AuthenticatedUser) {
  if (user.authMethod !== "jwt") {
    throw new ForbiddenException(
      "API tokens cannot manage workspace members; sign in to the web app.",
    );
  }
}
