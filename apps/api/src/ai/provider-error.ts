/** What a failed call knows beyond its message; none of it is shown or stored, it only steers the next try. */
export interface AiProviderErrorDetails {
  /** Another way of asking for the answer (another output mode) may help: the answer was unusable, or the way is refused. */
  escalate?: boolean;
  /** The server doesn't accept the way the answer was asked for (HTTP 400/422 naming it). */
  unsupportedMode?: boolean;
  /** The unusable answer, so the next try can quote it; never shown, stored or logged. */
  rawAnswer?: string;
  /** Why the answer was unusable, in a few plain words, for the next try to quote. */
  problem?: string;
}

/** A failed call to an AI provider. `retryable` is true for what may pass on another try: the network, 429, 5xx, an answer that isn't usable. */
export class AiProviderError extends Error {
  readonly escalate: boolean;
  readonly unsupportedMode: boolean;
  readonly rawAnswer?: string;
  readonly problem?: string;

  constructor(
    message: string,
    readonly retryable: boolean,
    details: AiProviderErrorDetails = {},
  ) {
    super(message);
    this.escalate = details.escalate ?? false;
    this.unsupportedMode = details.unsupportedMode ?? false;
    this.rawAnswer = details.rawAnswer;
    this.problem = details.problem;
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
