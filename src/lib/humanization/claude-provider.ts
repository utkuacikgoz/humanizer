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
import { CLAUDE_MODEL_CAPABILITIES, toProviderUsage, type ClaudeModelId } from "./claude-pricing";
import { ProviderError } from "./provider-error";
import type { HumanizationProvider, ProviderUsage, RewriteRequest, RewriteResponse } from "./types";

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
   * Depth control. `high` is the API default; this engine defaults to `low`.
   *
   * Two reasons, and the second is the one that matters.
   *
   * Humanizing a draft is constrained rewriting, not open-ended reasoning.
   * The instructions are explicit, the input is bounded, the output shape is
   * fixed by a schema, and there is nothing to plan or search. That is the
   * shape of work `low` exists for.
   *
   * And a lower effort is SAFE HERE specifically because the pipeline
   * verifies every candidate before the customer sees it. Effort is not a
   * quality guarantee we are trading away — protected content, semantics and
   * the quality thresholds are all still gates, and a thinner candidate that
   * fails them is rejected and resampled rather than sold. That makes effort
   * a cost/rejection-rate tradeoff rather than a cost/quality one.
   *
   * So the number to watch when changing this is the VERIFICATION REJECTION
   * RATE, not a subjective read of the prose. A cheaper effort that gets
   * rejected more often is resampled more often, and a rewrite that costs two
   * calls at `low` is more expensive than one call at `medium`. Both figures
   * come out of `npm run measure:cost`, which sweeps every level and prints
   * them side by side. Set this from that output, not from taste.
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
  /**
   * Extra beta flags, appended after the refusal-fallback one.
   *
   * Exists for the cost measurement, which may need to opt into reporting it
   * does not want on the production request path. A beta flag changes what
   * the server does; adding one here is a deliberate act by a caller that
   * knows why, never a default.
   */
  extraBetas?: string[];
}

const DEFAULT_MODEL: ClaudeModelId = "claude-opus-5";
/** See ClaudeProviderOptions.effort for why this is `low` and not the API's `high`. */
const DEFAULT_EFFORT: NonNullable<ClaudeProviderOptions["effort"]> = "low";
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
    // `message` stays this engine's prose: the test below this mapping proves
    // an SDK 400 message can echo the customer's document, and the pipeline
    // copies `message` into the retry context that reaches the next prompt.
    // The API's own account — which names the offending parameter and is the
    // only way to diagnose a 400 — rides in the operator-only `diagnostic`
    // channel instead, capped because it is destined for logs.
    return new ProviderError(`The rewrite provider rejected the request (${error.status}).`, {
      kind: "invalid-request",
      diagnostic: error.message.slice(0, 300),
    });
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
  private readonly betas: string[];

  constructor(options: ClaudeProviderOptions) {
    this.client = options.client;
    this.model = options.model ?? DEFAULT_MODEL;
    this.effort = options.effort ?? DEFAULT_EFFORT;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.name = options.name ?? `claude-${this.model}`;
    this.betas = [FALLBACK_BETA, ...(options.extraBetas ?? [])];
  }

  /**
   * Returns the narrower `usage: ProviderUsage` rather than the interface's
   * `ProviderUsage | ProviderUsage[]`: one call, one usage record. The array
   * form exists for a provider that runs a model ladder, and a caller of this
   * class should not have to narrow a union that can never widen.
   */
  async rewrite(request: RewriteRequest): Promise<RewriteResponse & { usage: ProviderUsage }> {
    request.signal?.throwIfAborted();
    const fenceId = createFenceId();
    const capabilities = CLAUDE_MODEL_CAPABILITIES[this.model];

    let message: Anthropic.Beta.Messages.BetaMessage;
    try {
      message = await this.client.create(
        {
          model: this.model,
          max_tokens: this.maxTokens,
          // Adaptive is the only supported on-mode on the current generation,
          // and thinking is on by default on Opus 5. `budget_tokens` is
          // removed there and returns a 400. An older model on a cheap rung
          // accepts neither this nor `effort`, so both are omitted for it
          // rather than sent and rejected.
          ...(capabilities.adaptiveThinking ? { thinking: { type: "adaptive" as const } } : {}),
          output_config: {
            ...(capabilities.effort ? { effort: this.effort } : {}),
            // Structured output, not an assistant prefill: prefill is removed
            // on this model family and returns a 400. This is also what keeps
            // a preamble ("Here is the rewritten text:") out of the document
            // we are about to sell.
            format: { type: "json_schema" as const, schema: REWRITE_OUTPUT_SCHEMA },
          },
          betas: this.betas,
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
    // `thinking_tokens` may be absent — an older model, or a response that
    // simply did not report the breakdown. Undefined is recorded as unknown
    // rather than as zero: "no thinking happened" and "nobody said" are
    // different claims, and the whole cost question turns on this number.
    const thinkingTokens = message.usage.output_tokens_details?.thinking_tokens;
    const usage = toProviderUsage(message.model ?? this.model, this.model, {
      inputTokens: message.usage.input_tokens ?? 0,
      outputTokens: message.usage.output_tokens ?? 0,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      ...(typeof thinkingTokens === "number" ? { thinkingTokens } : {}),
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
