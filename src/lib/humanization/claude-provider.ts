// A Claude-backed HumanizationProvider.
//
// The deterministic provider is a substitution table: it cannot repair
// grammar, cannot vary sentence rhythm, and cannot remove a generic
// conclusion. This one asks a model to do the rewriting, then hands the
// candidate back to the SAME verification and evaluation gates the
// deterministic provider goes through. Nothing here loosens those gates. A
// candidate that loses a protected span is rejected exactly as before.
//
// Three deliberate shapes:
//
//   * The API client is an injected interface, as src/lib/email-sender.ts
//     does it. Tests construct a recording fake and never touch the network,
//     which is what lets the whole suite run with no API key.
//   * Nothing in this file logs. Not the prompt, not the document, not the
//     API key, not a caught error object — an SDK error can carry the request
//     body, and the request body is the customer's writing.
//   * Every ProviderError message is written here from a fixed vocabulary.
//     The pipeline copies provider error messages into its retry context, so
//     a message that quoted the provider's response body would carry customer
//     text into a place it must never reach.
//
// This module must stay free of `cloudflare:workers`, `next/headers` and
// `next/navigation` so tests/*.test.mts can import it under plain Node. It is
// deliberately NOT re-exported from ./index: importing it pulls the Anthropic
// SDK in, and the default (deterministic) path should not carry that weight.
import Anthropic from "@anthropic-ai/sdk";

import { buildUserTurn, CORE_SYSTEM_PROMPT, createFenceId, MODE_INSTRUCTIONS, REWRITE_OUTPUT_SCHEMA } from "./claude-prompt";
import { toProviderUsage, type ClaudeModelId } from "./claude-pricing";
import { ProviderError } from "./provider-error";
import type { HumanizationProvider, RewriteRequest, RewriteResponse } from "./types";

/**
 * The one call this provider makes. An interface rather than the SDK client
 * itself so a test can supply a fake without a key, a network, or a mock of
 * the SDK's entire surface.
 */
export interface ClaudeMessagesClient {
  create(
    params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
    options?: { signal?: AbortSignal },
  ): Promise<Anthropic.Beta.Messages.BetaMessage>;
}

export interface ClaudeProviderOptions {
  client: ClaudeMessagesClient;
  /** Exact model id. Never a dated suffix. */
  model?: ClaudeModelId;
  /**
   * Depth control. `high` is the API default.
   *
   * `medium` is chosen here because a 200-300 word rewrite is not a reasoning
   * problem and the request path has a hard latency budget. This has NOT been
   * swept against the benchmark — no API key was available when the provider
   * was written — so treat it as a starting point, not a measured optimum.
   */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /**
   * Non-streaming ceiling. 16000 keeps the request under the SDK's HTTP
   * timeout; anything materially larger needs `.stream()` with
   * `.finalMessage()` instead of this call shape.
   */
  maxTokens?: number;
  /** Overrides the provider's reported `name`, so a router can attribute rungs. */
  name?: string;
}

const DEFAULT_MODEL: ClaudeModelId = "claude-opus-5";
const DEFAULT_MAX_TOKENS = 16_000;

/**
 * Server-side refusal fallbacks, on by default.
 *
 * Customers paste arbitrary text, so a safety classifier will decline some of
 * it. Without this the request simply stops; with it the API re-runs the same
 * request on a fallback model inside the same call and the customer gets their
 * rewrite. `"default"` routes by refusal category, so there is no model list
 * to maintain — and it pairs with the -07-01 header specifically. The -06-01
 * header is for the array form; mixing them is a 400.
 */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Wraps the real SDK.
 *
 * `maxRetries: 0` is deliberate. The pipeline already owns retry policy: it
 * decides what is retryable from ProviderError.kind and it enforces a
 * per-attempt deadline. A second, invisible retry budget inside the SDK would
 * multiply the cost of one attempt and blow through that deadline without the
 * pipeline ever seeing why.
 */
export function createAnthropicMessagesClient(config: {
  apiKey: string;
  baseURL?: string;
  timeoutMs?: number;
}): ClaudeMessagesClient {
  const client = new Anthropic({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    ...(config.timeoutMs ? { timeout: config.timeoutMs } : {}),
    maxRetries: 0,
  });
  return {
    create(params, options) {
      return client.beta.messages.create(params, options);
    },
  };
}

/** Reads a Retry-After header without assuming the SDK's error shape. */
function retryAfterMs(error: unknown): number | undefined {
  const headers = (error as { headers?: unknown }).headers;
  const raw = headers instanceof Headers
    ? headers.get("retry-after")
    : typeof headers === "object" && headers !== null
      ? (headers as Record<string, string | undefined>)["retry-after"]
      : undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) * 1000 : undefined;
}

/**
 * Maps an SDK failure onto the engine's ProviderError.
 *
 * Most-specific-first, on the SDK's typed classes rather than on error
 * message text — the pipeline's decision to retry or to stop is a spend
 * decision, and string matching on a vendor's prose is not a basis for one.
 * The `cause` is deliberately dropped: an SDK error's cause chain can carry
 * the request body.
 */
export function mapAnthropicError(error: unknown): ProviderError {
  if (error instanceof Anthropic.APIUserAbortError) {
    return new ProviderError("The rewrite call was aborted.", { kind: "timeout" });
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new ProviderError("The rewrite call timed out.", { kind: "timeout" });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ProviderError("The rewrite provider is rate limiting.", { kind: "rate-limit", retryAfterMs: retryAfterMs(error) });
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    // Not retryable, and not a customer-visible detail: three more calls with
    // a bad key cost the same and fail the same.
    return new ProviderError("The rewrite provider rejected these credentials.", { kind: "invalid-request" });
  }
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) {
    return new ProviderError(`The rewrite provider rejected the request (${error.status}).`, { kind: "invalid-request" });
  }
  if (error instanceof Anthropic.APIError) {
    const status = typeof error.status === "number" ? error.status : 0;
    if (status >= 500 || status === 408 || status === 409 || status === 529) {
      return new ProviderError(`The rewrite provider failed (${status}).`, { kind: "server" });
    }
    if (status === 0) {
      // Connection-level failure: no response, so nothing to price and worth
      // another attempt.
      return new ProviderError("The rewrite provider could not be reached.", { kind: "server" });
    }
    return new ProviderError(`The rewrite provider returned ${status}.`, { kind: "unknown" });
  }
  return new ProviderError("The rewrite provider failed.", { kind: "unknown" });
}

function textOf(message: Anthropic.Beta.Messages.BetaMessage): string {
  let text = "";
  for (const block of message.content) {
    if (block.type === "text") text += block.text;
  }
  return text;
}

/**
 * Pulls the rewrite out of a structured response.
 *
 * `output_config.format` constrains the response to the schema, so this is
 * the happy path; the failure branches exist because a truncated response is
 * still valid JSON's prefix and nothing else, and returning a half-document
 * to a paying customer is worse than retrying.
 */
export function parseRewrite(message: Anthropic.Beta.Messages.BetaMessage): string {
  if (message.stop_reason === "max_tokens") {
    throw new ProviderError("The rewrite was truncated.", { kind: "unknown", retryable: true });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(textOf(message));
  } catch {
    // The message text is the customer's rewritten document. It is never put
    // into the error.
    throw new ProviderError("The rewrite provider returned an unparseable response.", { kind: "unknown", retryable: true });
  }
  const rewrite = (parsed as { rewrite?: unknown } | null)?.rewrite;
  if (typeof rewrite !== "string" || !rewrite.trim()) {
    throw new ProviderError("The rewrite provider returned no text.", { kind: "unknown", retryable: true });
  }
  return rewrite.trim();
}

export class ClaudeHumanizationProvider implements HumanizationProvider {
  readonly name: string;
  private readonly client: ClaudeMessagesClient;
  private readonly model: ClaudeModelId;
  private readonly effort: NonNullable<ClaudeProviderOptions["effort"]>;
  private readonly maxTokens: number;

  constructor(options: ClaudeProviderOptions) {
    this.client = options.client;
    this.model = options.model ?? DEFAULT_MODEL;
    this.effort = options.effort ?? "medium";
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.name = options.name ?? `claude-${this.model}`;
  }

  async rewrite(request: RewriteRequest): Promise<RewriteResponse> {
    request.signal?.throwIfAborted();
    const fenceId = createFenceId();

    let message: Anthropic.Beta.Messages.BetaMessage;
    try {
      message = await this.client.create(
        {
          model: this.model,
          max_tokens: this.maxTokens,
          // Adaptive is the only supported on-mode on Opus 5, and thinking is
          // on there by default. `budget_tokens` is removed and returns a 400.
          thinking: { type: "adaptive" },
          output_config: {
            effort: this.effort,
            // Structured output, not an assistant prefill: prefill is removed
            // on this model family and returns a 400. This is also what keeps
            // a preamble ("Here is the rewritten text:") out of the document
            // we are about to sell.
            format: { type: "json_schema", schema: REWRITE_OUTPUT_SCHEMA },
          },
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          // Order is tools -> system -> messages. Both system blocks are
          // byte-stable, so the breakpoints land on a prefix that repeats
          // across every request; the customer's text is in the user turn,
          // after the last breakpoint. If cache_read_input_tokens stays zero
          // across repeated calls, something above this line started varying.
          system: [
            { type: "text", text: CORE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
            { type: "text", text: MODE_INSTRUCTIONS[request.mode], cache_control: { type: "ephemeral" } },
          ],
          messages: [{ role: "user", content: buildUserTurn(request, fenceId) }],
        },
        { signal: request.signal },
      );
    } catch (error) {
      throw mapAnthropicError(error);
    }

    // Checked BEFORE the content is read. A refused turn has a stop_details
    // category and content that is not a rewrite.
    if (message.stop_reason === "refusal") {
      const category = message.stop_details?.category ?? "unspecified";
      // Non-retryable by default for this kind: the same text refused three
      // times costs three times as much and the customer is charged for none
      // of it, because the pipeline only debits successful words.
      throw new ProviderError(`The rewrite provider declined this text (${category}).`, { kind: "refusal" });
    }

    const text = parseRewrite(message);
    const usage = toProviderUsage(message.model ?? this.model, this.model, {
      inputTokens: message.usage.input_tokens ?? 0,
      outputTokens: message.usage.output_tokens ?? 0,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    });

    return {
      text,
      // These two are the legacy estimate fields the benchmark reports. Filled
      // from the provider's real counts rather than a characters/4 guess: a
      // measured number is strictly better than an estimate, and the split
      // that pricing actually needs is on `usage`.
      estimatedTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
      estimatedCostUsd: usage.costUsd ?? 0,
      usage,
    };
  }
}
