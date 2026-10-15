import type { Request } from "express";

/**
 * The address a request came to, e.g. https://testops.example.com, for links in webhook calls when
 * no public URL is configured. Behind a proxy, TRUST_PROXY makes the protocol the client's.
 */
export function requestOrigin(request: Request): string {
  return `${request.protocol}://${request.get("host")}`;
}
