import { maskProtectedContent } from "./protected-content";
import { splitSentences } from "./text";
import type { HumanizationProvider, RewriteRequest, RewriteResponse, WritingMode } from "./types";

const COMMON_REWRITES: Array<[RegExp, string]> = [
  [/\bIn today's fast-paced world,?\s*/gi, ""],
  [/\bIt is important to note that\s*/gi, ""],
  [/\bIt should be noted that\s*/gi, ""],
  [/\bIt is worth mentioning that\s*/gi, ""],
  [/\bThe fact of the matter is that\s*/gi, ""],
  [/\bNeedless to say,?\s*/gi, ""],
  [/\bFurthermore,?\s*/gi, "Also, "],
  [/\bMoreover,?\s*/gi, "More importantly, "],
  [/\bAdditionally,?\s*/gi, ""],
  // The comma is required. Without it this also matched the preposition in
  // "In addition to the survey, we interviewed 12 residents", deleting the
  // head of the phrase and shipping "To the survey, we interviewed 12
  // residents" — a sentence that no longer means anything.
  [/\bIn addition,\s*/gi, ""],
  // Also comma-gated: "moving forward is not always possible" is a gerund
  // subject, and substituting the adverbial produced "from here, is not
  // always possible".
  [/\bMoving forward,\s*/gi, "From here, "],
  [/\bIn order to\b/gi, "To"],
  [/\bdue to the fact that\b/gi, "because"],
  [/\bthe reason is because\b/gi, "the reason is that"],
  [/\beach and every\b/gi, "every"],
  [/\bend result\b/gi, "result"],
  [/\bfuture plans\b/gi, "plans"],
  [/\bbasic fundamentals\b/gi, "fundamentals"],
  [/\butilize\b/gi, "use"],
  // Only the verb. "The team gained leverage in the negotiation" became
  // "gained use", which is not English and not what the writer said.
  //
  // Without a parser, two signals distinguish the verb: something that only
  // takes a verb sits in front (a modal, the infinitive marker, a relative
  // pronoun standing in for the subject), or a determiner opens the direct
  // object behind it. Either is enough; neither means it is the noun.
  //
  // A bare "organizations leverage data" matches neither and is deliberately
  // left alone. The analysis still reports it as corporate filler, so the
  // score reflects it, and leaving filler in place is a far smaller harm
  // than corrupting a noun into nonsense.
  [/(?<=\b(?:can|could|will|would|shall|should|must|may|might|to|who|that|which)\s+)leverage\b|\bleverage\b(?=\s+(?:the|an?|our|its|their|your|his|her|these|those|this|that|every|all|both|existing)\b)/gi, "use"],
  [/\bdelve into\b/gi, "examine"],
  [/\bever-evolving\b/gi, "changing"],
  [/\bmultifaceted\b/gi, "complex"],
  [/\brobust solution\b/gi, "reliable approach"],
  [/\bstrategic alignment\b/gi, "shared priorities"],
  [/\bdrive value\b/gi, "help"],
  [/\bat scale\b/gi, "across the organization"],
  [/\bIn summary,?\s*/gi, ""],
  [/\bTo summarize,?\s*/gi, ""],
  [/\bAs we have seen,?\s*/gi, ""],
  [/\bIn conclusion,?\s*/gi, "Ultimately, "],
];

const MODE_REWRITES: Record<WritingMode, Array<[RegExp, string]>> = {
  natural: [
    [/\bcommence\b/gi, "start"],
    [/\bapproximately\b/gi, "about"],
    [/\bsubsequently\b/gi, "later"],
  ],
  professional: [
    [/\ba lot of\b/gi, "many"],
    [/\bkind of\b/gi, "somewhat"],
    [/\bget the ball rolling\b/gi, "begin"],
  ],
  academic: [
    [/\ba lot of\b/gi, "many"],
    [/\bshows\b/gi, "indicates"],
    [/\blooked at\b/gi, "examined"],
  ],
  casual: [
    [/\bapproximately\b/gi, "about"],
    [/\bnevertheless\b/gi, "still"],
    [/\btherefore\b/gi, "so"],
  ],
};

/**
 * Match the replacement's case to the text it replaces, in both directions.
 *
 * The replacement literals above are written sentence-initially ("To",
 * "From here, "), and this used to only ever ADD capitals. A mid-sentence
 * match therefore kept the literal's capital and shipped
 * "...robust frameworks To facilitate..." to a paying customer.
 */
function preserveCapitalization(before: string, after: string): string {
  if (!after || !before) return after;
  const startsUpper = before[0] === before[0].toUpperCase() && before[0] !== before[0].toLowerCase();
  return startsUpper
    ? `${after[0].toUpperCase()}${after.slice(1)}`
    : `${after[0].toLowerCase()}${after.slice(1)}`;
}

function applyRewrites(text: string, mode: WritingMode): string {
  let candidate = text;
  for (const [expression, replacement] of [...COMMON_REWRITES, ...MODE_REWRITES[mode]]) {
    candidate = candidate.replace(expression, (match) => preserveCapitalization(match.trimStart(), replacement));
  }
  return capitalizeSentenceStarts(
    candidate
      .replace(/\s+([,.;!?])/g, "$1")
      .replace(/([.!?]) {2,}/g, "$1 "),
  );
}

/**
 * Capitalize the first letter of each sentence.
 *
 * Two earlier versions of this were wrong in opposite directions. The first
 * pattern was malformed (`[.!?]\n]` reads as the class [.!?] followed by a
 * literal `\n]`), so it only ever matched `^`. Its replacement,
 * `/(^|[.!?]\s+|\n+)([a-z])/g`, fired after ANY stop followed by whitespace,
 * so an abbreviation mid-sentence produced "e.g. Spreadsheets" and
 * "i.e. Only".
 *
 * Sentence starts are now decided by the one segmenter the rest of the engine
 * uses, which knows that the stop in "e.g." does not end a sentence.
 * splitSentences is total, so every character survives the round trip.
 */
function capitalizeSentenceStarts(text: string): string {
  let result = "";
  let cursor = 0;
  for (const segment of splitSentences(text)) {
    result += text.slice(cursor, segment.start);
    result += capitalizeFirstWord(segment.text);
    cursor = segment.end;
  }
  return result + text.slice(cursor);
}

/**
 * A word that already carries an internal capital spells itself: "eBay",
 * "iPhone", "pH", "iOS". Upper-casing its first letter produced "EBay",
 * "PH" and "IPhone" whenever a deletion promoted such a word to the front of
 * a sentence — the same class of defect as the capital that was only ever
 * added and never restored.
 */
function capitalizeFirstWord(sentence: string): string {
  const first = sentence[0];
  if (!first) return sentence;
  const upper = first.toUpperCase();
  if (upper === first) return sentence;
  const word = sentence.match(/^[\p{L}\p{N}]+/u)?.[0] ?? "";
  if (/\p{Lu}/u.test(word.slice(1))) return sentence;
  return `${upper}${sentence.slice(1)}`;
}

export class DeterministicHumanizationProvider implements HumanizationProvider {
  readonly name = "deterministic-v1";

  async rewrite(request: RewriteRequest): Promise<RewriteResponse> {
    request.signal?.throwIfAborted();
    let candidate = request.text;
    for (const target of [...request.analysis.targets].sort((a, b) => b.start - a.start)) {
      const protectedWithinTarget = request.protectedContent
        .filter((item) => item.start >= target.start && item.end <= target.end)
        .map((item) => ({ ...item, start: item.start - target.start, end: item.end - target.start }));
      const masked = maskProtectedContent(target.text, protectedWithinTarget);
      const rewritten = masked.restore(applyRewrites(masked.text, request.mode));
      candidate = `${candidate.slice(0, target.start)}${rewritten}${candidate.slice(target.end)}`;
    }

    return {
      text: candidate,
      estimatedTokens: Math.ceil((request.text.length + candidate.length) / 4),
      estimatedCostUsd: 0,
    };
  }
}
