// Token prices, kept apart from the provider so a rate change is a one-line
// edit in a file with no SDK import and no network dependency.
//
// Published rates, US dollars per million tokens. Cache multipliers are the
// documented ones: a cache WRITE costs 1.25x the input rate, a cache READ
// costs 0.1x. Those two are why ProviderUsage carries a cached split at all —
// collapsing them into one "input tokens" number misprices a cached request
// by an order of magnitude.
import type { ProviderUsage } from "./types";

export interface ModelRate {
  inputPerMillion: number;
  outputPerMillion: number;
}

export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER = 0.1;

export const CLAUDE_MODEL_RATES: Record<string, ModelRate> = {
  "claude-opus-5": { inputPerMillion: 5, outputPerMillion: 25 },
  "claude-sonnet-5": { inputPerMillion: 2, outputPerMillion: 10 },
  "claude-haiku-4-5": { inputPerMillion: 1, outputPerMillion: 5 },
};

/** The model ids this engine is allowed to select. Exact ids, never dated. */
export type ClaudeModelId = "claude-opus-5" | "claude-sonnet-5" | "claude-haiku-4-5";

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Cost of one call, in dollars.
 *
 * `model` is the model that SERVED the call, which is not always the model
 * that was requested: a server-side fallback re-runs the request elsewhere and
 * bills at that model's rates. An unrecognised model falls back to the
 * requested model's rate rather than reporting zero — a silent zero would make
 * a real cost invisible, which is the exact failure this file exists to
 * prevent.
 */
export function claudeCostUsd(model: string, fallbackModel: string, counts: TokenCounts): number {
  const rate = CLAUDE_MODEL_RATES[model] ?? CLAUDE_MODEL_RATES[fallbackModel];
  if (!rate) return 0;
  const perMillion = (tokens: number, dollars: number) => (tokens / 1_000_000) * dollars;
  return (
    perMillion(counts.inputTokens, rate.inputPerMillion) +
    perMillion(counts.cacheReadTokens, rate.inputPerMillion * CACHE_READ_MULTIPLIER) +
    perMillion(counts.cacheWriteTokens, rate.inputPerMillion * CACHE_WRITE_MULTIPLIER) +
    perMillion(counts.outputTokens, rate.outputPerMillion)
  );
}

/**
 * Maps a provider's token counts into the engine's ProviderUsage.
 *
 * `inputTokens` is the total the call consumed on the input side, including
 * the cached portion, and `cachedInputTokens` says how much of that total was
 * served from cache. Reporting cached tokens outside the total would make the
 * two numbers impossible to reconcile against an invoice.
 */
export function toProviderUsage(model: string, fallbackModel: string, counts: TokenCounts): ProviderUsage {
  return {
    inputTokens: counts.inputTokens + counts.cacheReadTokens + counts.cacheWriteTokens,
    outputTokens: counts.outputTokens,
    cachedInputTokens: counts.cacheReadTokens,
    costUsd: claudeCostUsd(model, fallbackModel, counts),
    model,
  };
}
