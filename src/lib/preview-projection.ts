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
