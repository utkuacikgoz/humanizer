// Pure preview/paywall projection rules (ACT-01, ACT-02).
//
// Deliberately free of `cloudflare:workers`, `next/headers` and
// `next/navigation` so both the route handler and the client page can
// import it, and so plain-Node tests can assert the paywall decision
// directly instead of inferring it from rendered markup.
import { normalizeForComparison } from "@/src/lib/humanization/text";

/**
 * ACT-01. True when the pipeline handed back a candidate that is
 * materially the same text the visitor submitted.
 *
 * Derived by comparing the normalized *full* rewrite with the normalized
 * original — never from `improvements`, which counts analysis issues that
 * disappeared and can be non-zero for a byte-identical candidate (and,
 * before ACT-02, was floored to 1 regardless).
 *
 * `normalizeForComparison` folds whitespace and smart quotes, so a
 * rewrite that only re-wrapped lines or swapped ' for ’ still counts as
 * unchanged: there is nothing there a customer would pay for.
 */
export function isMateriallyUnchanged(original: string, rewrite: string): boolean {
  return normalizeForComparison(original) === normalizeForComparison(rewrite);
}

/**
 * SEC-02. The paywall must withhold a meaningful amount or not exist.
 *
 * The previous rule floored the visible slice at 8 words, so any rewrite of
 * 8 words or fewer was returned in full while the UI still rendered a
 * purchase CTA over it. Because a rewrite is often shorter than its input,
 * a 12-word submission — the documented minimum — could reach that floor,
 * and chunking a long document into ~12-word windows reconstructed the whole
 * paid rewrite for free.
 */
export const MIN_HIDDEN_WORDS = 12;

/**
 * The shortest submission that can still yield a paywallable rewrite.
 * Enforced at input validation so a visitor is told to add text up front,
 * rather than getting a rewrite the paywall cannot honestly cover.
 */
export const MIN_PAYWALLABLE_INPUT_WORDS = 25;
const MAX_VISIBLE_WORDS = 90;
const VISIBLE_FRACTION = 0.46;

export interface PreviewSplit {
  preview: string;
  hiddenWordCount: number;
  /** False when too little could be withheld for a paywall to be honest. */
  paywallable: boolean;
}

/**
 * Splits a rewrite into the visible preview and the withheld remainder.
 *
 * When the rewrite is too short to withhold MIN_HIDDEN_WORDS, this reports
 * `paywallable: false` rather than exposing everything behind a purchase
 * CTA. The caller must then deliver the result honestly — never a full
 * rewrite with a price attached to it.
 */
export function projectPreview(rewrite: string): PreviewSplit {
  const words = rewrite.trim().split(/\s+/).filter(Boolean);
  const visibleWords = Math.min(MAX_VISIBLE_WORDS, Math.floor(words.length * VISIBLE_FRACTION));
  const hiddenWordCount = words.length - visibleWords;

  if (visibleWords < 1 || hiddenWordCount < MIN_HIDDEN_WORDS) {
    return { preview: "", hiddenWordCount: 0, paywallable: false };
  }
  return { preview: words.slice(0, visibleWords).join(" "), hiddenWordCount, paywallable: true };
}

/** The subset of a preview response the paywall decision depends on. */
export interface UnlockDecisionInput {
  unchanged?: boolean;
  preview?: string;
  hiddenWordCount?: number;
}

/**
 * ACT-01. Gates the entire unlock card — button, price, and disclosure.
 *
 * There is nothing to sell unless the server actually withheld something:
 * an unchanged rewrite carries no `preview`, no `hiddenWordCount` and no
 * capability, so every branch below is false and no purchase CTA can be
 * rendered in that state.
 */
export function shouldOfferUnlock(result: UnlockDecisionInput | null | undefined): boolean {
  if (!result) return false;
  if (result.unchanged) return false;
  if (typeof result.preview !== "string" || !result.preview.trim()) return false;
  return (result.hiddenWordCount ?? 0) > 0;
}

/**
 * ACT-02. The measured count, pluralized. No floor: if the engine
 * measured zero it says zero, because a fabricated "1 improvement" is the
 * evidence claim docs/MONETIZATION.md's dark-pattern list forbids.
 */
export function improvementLabel(count: number): string {
  const safe = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  return `${safe} ${safe === 1 ? "improvement" : "improvements"}`;
}
