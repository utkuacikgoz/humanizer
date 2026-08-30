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
  /**
   * Operator-only detail: the provider's own account of why it refused, e.g.
   * an API 400's response message naming the offending parameter.
   *
   * This is a SEPARATE channel from `message` on purpose. `message` is copied
   * into the retry context that reaches the next prompt, so it must stay this
   * engine's own prose; a provider's error body can echo the customer's text
   * (tests/claude-provider.test.mts proves it) and must never travel there.
   * `diagnostic` is read only by operator tooling — scripts/measure-cost.mts
   * — and never by the pipeline. Nothing may log customer writing, but
   * without this field the first real run of the Claude provider failed
   * 30/30 with no way to learn why from its own report.
   */
  diagnostic?: string;
  cause?: unknown;
}

const RETRYABLE_BY_DEFAULT = new Set<ProviderErrorKind>(["rate-limit", "timeout", "server"]);

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly diagnostic?: string;

  constructor(message: string, options: ProviderErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "ProviderError";
    this.kind = options.kind;
    this.retryable = options.retryable ?? RETRYABLE_BY_DEFAULT.has(options.kind);
    this.retryAfterMs = options.retryAfterMs;
    this.diagnostic = options.diagnostic;
  }
}
