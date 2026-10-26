/** A failed call to an AI provider. `retryable` is true for what may pass on a second try: the network, 429, 5xx, an answer that isn't usable. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** The most provider error text that is stored or shown. */
export const PROVIDER_ERROR_MAX_CHARS = 500;

/**
 * Provider error text that is safe to store and show: every occurrence of the provider key removed, then cut to
 * 500 characters. In that order, so a key that straddles the cut can't be left half there.
 */
export function scrubProviderError(text: string, credential: string | null): string {
  const clean = credential ? text.split(credential).join("") : text;
  return clean.slice(0, PROVIDER_ERROR_MAX_CHARS);
}

/**
 * The message for an HTTP error from a provider. An endpoint on a private address could be an internal
 * service that a project admin pointed the server at, so its answer is never shown or stored, only the status;
 * the text of a public provider's error helps (a wrong model name, a bad key) and is scrubbed.
 */
export function providerFailureMessage(
  status: number,
  endpointIsPrivate: boolean,
  text: string,
  credential: string | null,
): string {
  const base = `Provider answered HTTP ${status}`;
  if (endpointIsPrivate) return base;
  const detail = scrubProviderError(text, credential).trim();
  return detail ? `${base}: ${detail}` : base;
}
