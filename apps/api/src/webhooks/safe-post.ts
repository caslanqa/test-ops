import * as dns from "dns";
import * as http from "http";
import * as https from "https";
import { BlockList, isIP, type LookupFunction } from "net";

/**
 * Sends a webhook without letting it reach the server's own network (SSRF). Anyone who can run a
 * project can set its webhook URL, so on a shared server an address such as http://postgres:5432,
 * a cloud metadata endpoint (169.254.169.254) or another internal service must stay out of reach.
 *
 * The address is checked at connect time, through the socket's own DNS lookup: a name that
 * resolves to a public address when saved and to a private one later (DNS rebinding) is still
 * refused. IP literals skip the lookup, so they are checked up front. Redirects are not followed.
 * WEBHOOK_ALLOW_PRIVATE_NETWORKS=true turns the check off, for installs whose CI runs on the
 * internal network.
 */

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, including cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved and broadcast
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

/** Whether `address` belongs to a private, local or reserved network. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return blocked.check(address, "ipv4");
  if (version !== 6) return true;
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) is checked as the IPv4 address it carries.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return blocked.check(mapped[1], "ipv4");
  return blocked.check(address, "ipv6");
}

export class WebhookAddressError extends Error {}

/** Checks a webhook URL before it is saved: http(s), a host, and no private IP literal. */
export function assertWebhookUrl(raw: string, allowPrivate: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookAddressError("The webhook URL isn't a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new WebhookAddressError("The webhook URL must start with https:// or http://");
  }
  if (url.username || url.password) {
    throw new WebhookAddressError("Put credentials in a header, not in the URL");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate && (host === "localhost" || (isIP(host) && isPrivateAddress(host)))) {
    throw new WebhookAddressError("The webhook URL points to a private or local network address");
  }
  return url;
}

export interface PostResult {
  status: number;
  /** The start of the response body, for showing why a call failed. */
  body: string;
}

/** POSTs `body` to `url`; rejects on network errors, timeouts and refused addresses. */
export function safePost(
  url: URL,
  body: string,
  headers: Record<string, string>,
  { allowPrivate, timeoutMs = 10_000 }: { allowPrivate: boolean; timeoutMs?: number },
): Promise<PostResult> {
  const lookup: LookupFunction = (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, "", 0);
      const list = addresses as dns.LookupAddress[];
      const refused = !allowPrivate && list.some((a) => isPrivateAddress(a.address));
      if (refused || list.length === 0) {
        return callback(new WebhookAddressError(`${hostname} resolves to a private or local network address`), "", 0);
      }
      if ((options as dns.LookupOptions).all) return (callback as (e: null, a: dns.LookupAddress[]) => void)(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };

  return new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (!allowPrivate && isIP(host) && isPrivateAddress(host)) {
      reject(new WebhookAddressError("The webhook URL points to a private or local network address"));
      return;
    }
    const request = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method: "POST",
        headers: { ...headers, "content-length": Buffer.byteLength(body) },
        lookup,
        timeout: timeoutMs,
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          if (text.length < 1000) text += chunk;
        });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: text.slice(0, 1000) }));
      },
    );
    request.on("timeout", () => request.destroy(new Error(`No answer within ${timeoutMs / 1000} s`)));
    request.on("error", reject);
    request.end(body);
  });
}
