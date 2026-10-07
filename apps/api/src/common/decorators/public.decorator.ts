import { applyDecorators, SetMetadata } from "@nestjs/common";
import { ApiExtension } from "@nestjs/swagger";

export const IS_PUBLIC_KEY = "isPublic";

/** OpenAPI extension that main.ts turns into `security: []` (and removes from the document). */
export const OPENAPI_PUBLIC_EXTENSION = "x-testops-public";

/**
 * Marks endpoints that need no auth, such as login, health/ready and the public run
 * share link. The same marker drives the OpenAPI document, so the docs can't drift
 * from what AuthGuard actually enforces.
 */
export const Public = () =>
  applyDecorators(SetMetadata(IS_PUBLIC_KEY, true), ApiExtension(OPENAPI_PUBLIC_EXTENSION, true));
