import { isPrivateAddress, safePost, WebhookAddressError, type PostResult } from "../../webhooks/safe-post";
import { AiProviderError, providerFailureMessage } from "../provider-error";

/** The most of a provider's answer that is read; a model answer is far smaller. */
export const MAX_ANSWER_CHARS = 2 * 1024 * 1024;

export interface CallOptions {
  credential: string | null;
  requestTimeoutMs: number;
  /** A message for an HTTP error the adapter recognises (say, a server without structured output), or null. */
  explainFailure?: (status: number, body: string) => string | null;
}

/**
 * POSTs JSON to a provider and returns the parsed answer. Private addresses are allowed (a model on the same
 * machine or network is a supported setup); link-local, multicast and reserved ones are not, redirects are not
 * followed, and the call has one deadline. Every failure is an AiProviderError that says whether a retry may help.
 * `endpointIsPrivate` says whether the answer came from a private address (an unknown one counts as private), so a
 * caller decides how much of the answer an error message may show.
 */
export async function callProvider(
  url: URL,
  body: unknown,
  headers: Record<string, string>,
  { credential, requestTimeoutMs, explainFailure }: CallOptions,
): Promise<{ answer: unknown; endpointIsPrivate: boolean }> {
  let result: PostResult;
  try {
    result = await safePost(
      url,
      JSON.stringify(body),
      { "content-type": "application/json", accept: "application/json", ...headers },
      { allowPrivate: true, refuseReserved: true, refuseCleartextPublic: true, maxChars: MAX_ANSWER_CHARS, timeoutMs: requestTimeoutMs },
    );
  } catch (error) {
    if (error instanceof WebhookAddressError) throw new AiProviderError(error.message, false);
    const reason = (error as NodeJS.ErrnoException).message || (error as NodeJS.ErrnoException).code || "network error";
    throw new AiProviderError(`Couldn't reach the provider: ${reason}`, true);
  }
  if (result.truncated) throw new AiProviderError("The provider's answer is larger than 2 MiB", false);
  if (result.status < 200 || result.status >= 300) {
    const explained = explainFailure?.(result.status, result.body);
    // An explained failure is the server refusing the way the answer was asked for. It is no use asking again the
    // same way; in Automatic the next try asks another way.
    if (explained) throw new AiProviderError(explained, false, { unsupportedMode: true, escalate: true });
    // Not knowing where the answer came from counts as private: the safe way to be wrong.
    const isPrivate = isPrivateAddress(result.remoteAddress ?? "");
    throw new AiProviderError(
      providerFailureMessage(result.status, isPrivate, result.body, credential),
      result.status === 429 || result.status >= 500,
    );
  }
  // Not knowing where the answer came from counts as private: the safe way to be wrong.
  const endpointIsPrivate = isPrivateAddress(result.remoteAddress ?? "");
  try {
    return { answer: JSON.parse(result.body), endpointIsPrivate };
  } catch {
    throw new AiProviderError("The provider's answer isn't JSON; check the endpoint", false);
  }
}

/** A token count from a provider's usage block; local servers sometimes leave it out, which counts as 0. */
export function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
