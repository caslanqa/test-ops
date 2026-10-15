import type { Request } from "express";

/**
 * The address a request came to, e.g. https://testops.example.com. It comes from headers the
 * client sends (Host, or X-Forwarded-Host behind a proxy), so it is only used when a project admin
 * saves a webhook, never from the request that starts a run.
 */
export function requestOrigin(request: Request): string {
  return `${request.protocol}://${request.get("host")}`;
}
