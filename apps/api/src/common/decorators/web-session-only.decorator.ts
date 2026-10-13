import { applyDecorators, SetMetadata } from "@nestjs/common";
import { ApiForbiddenResponse } from "@nestjs/swagger";

export const WEB_SESSION_ONLY_KEY = "webSessionOnly";

/** The message of the 403 an API token gets on a web-session-only endpoint. */
export const WEB_SESSION_ONLY_MESSAGE =
  "This action is only available from a signed-in web session, not with an API token.";

/**
 * Marks endpoints (or a whole controller) that an API token may not call; AuthGuard answers 403.
 * A leaked token must not be able to keep or widen its own access, for example by minting new
 * tokens or by adding a member it controls. Declaring it on the endpoint, instead of calling a
 * check inside each service, means a new endpoint of this kind can't forget it by accident.
 */
export const WebSessionOnly = () =>
  applyDecorators(
    SetMetadata(WEB_SESSION_ONLY_KEY, true),
    ApiForbiddenResponse({ description: "Called with an API token instead of a web session" }),
  );
