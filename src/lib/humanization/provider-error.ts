/**
 * The error a provider throws when the call itself failed, as distinct from a
 * candidate that came back and then failed verification.
 *
 * The pipeline treats these differently on purpose. A candidate that fails
 * verification is worth retrying: the provider is working and the next sample
 * may be better. A provider that rejected the request outright is not — three
 * doomed calls to a metered API cost real money and return the same 400 each
 * time.
 *
 * Providers must not put customer text in `message`. The pipeline copies it
 * into the retry context, and nothing in this engine may log customer writing.
 */
export type ProviderErrorKind =
  | "rate-limit"
  | "timeout"
  | "server"
  | "invalid-request"
  | "refusal"
  | "unknown";

export interface ProviderErrorOptions {
  kind: ProviderErrorKind;
  /** Defaults to true for rate-limit, timeout and server; false otherwise. */
  retryable?: boolean;
  /** Honour a provider's Retry-After when it sends one. */
  retryAfterMs?: number;
  cause?: unknown;
}

const RETRYABLE_BY_DEFAULT = new Set<ProviderErrorKind>(["rate-limit", "timeout", "server"]);

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(message: string, options: ProviderErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "ProviderError";
    this.kind = options.kind;
    this.retryable = options.retryable ?? RETRYABLE_BY_DEFAULT.has(options.kind);
    this.retryAfterMs = options.retryAfterMs;
  }
}
