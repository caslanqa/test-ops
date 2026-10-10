import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import { OPENAPI_PUBLIC_EXTENSION } from "./common/decorators/public.decorator";
import { BULK_RESULTS_MAX_ITEMS } from "./runs/dto/bulk-submit-results.dto";

const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "options", "head", "trace"] as const;

/** Describes a per-minute limit in the API description; 0 means the limit is turned off. */
function perMinute(limit: number, who: string): string {
  return limit > 0 ? `${limit} requests per minute ${who}` : `no limit ${who}`;
}

/** A byte count as MiB for the API description, e.g. 10485760 → "10 MiB". */
function mebibytes(bytes: number): string {
  return `${Number((bytes / 1024 / 1024).toFixed(1))} MiB`;
}

/**
 * Builds the OpenAPI document served at /api/docs (FR-070, FR-077).
 *
 * DTO schemas come from the @nestjs/swagger CLI plugin (nest-cli.json). Prisma enums are
 * const objects rather than TS enums, which the plugin can't infer, so DTO enum fields
 * declare @ApiProperty({ enum }) explicitly; tests/smoke/openapi.mjs guards both.
 *
 * Security mirrors AuthGuard: every operation requires the bearer token unless its
 * handler is marked @Public(), which adds OPENAPI_PUBLIC_EXTENSION. Setting it per
 * operation (instead of per controller) means a new endpoint is documented as
 * protected by default, exactly as the guard treats it.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = app.get(ConfigService);
  const general = config.get<number>("rateLimit.perMinute", 600);
  const auth = config.get<number>("rateLimit.authPerMinute", 10);
  const maxJsonBody = config.get<number>("http.maxJsonBodyBytes")!;

  const description = [
    "REST API for TestOps (v1). Every endpoint below is under `/api/v1`.",
    "",
    "**Authentication:** send `Authorization: Bearer <token>`, using an API token (create one under " +
      "**Account → API tokens** in the app) or the session token returned by `POST /api/v1/auth/login`. " +
      "Choose **Authorize** to try requests from this page.",
    "",
    "**Errors** are JSON: `{ \"statusCode\": 404, \"message\": \"…\", \"error\": \"Not Found\" }`. " +
      "Validation failures return 400 with `message` as a list of problems.",
    "",
    `**Rate limits:** ${perMinute(general, "per user (per IP when signed out)")}; sign-in, registration and ` +
      `password changes are limited to ${perMinute(auth, "per account")}. Responses carry ` +
      "`X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`; an exceeded limit returns 429 " +
      "with a `Retry-After` header in seconds.",
    "",
    `**Request size:** JSON request bodies may be up to ${mebibytes(maxJsonBody)}, and a bulk result ` +
      `upload holds up to ${BULK_RESULTS_MAX_ITEMS} results; larger requests return 413.`,
  ].join("\n");

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("TestOps API")
      .setDescription(description)
      // The API version, not the release: this document is public, and the exact release
      // would tell an anonymous visitor which known issues apply (see GET /system/info).
      .setVersion("v1")
      .addBearerAuth()
      .build(),
  );

  for (const pathItem of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method] as (Record<string, unknown> & { security?: unknown }) | undefined;
      if (!operation) continue;
      const isPublic = operation[OPENAPI_PUBLIC_EXTENSION] === true;
      delete operation[OPENAPI_PUBLIC_EXTENSION];
      operation.security = isPublic ? [] : [{ bearer: [] }];
    }
  }
  return document;
}
