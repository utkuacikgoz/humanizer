import type { TextRange } from "./types";

export interface TextSegment extends TextRange {
  text: string;
}

export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

/**
 * Abbreviations that are always followed by more of the same sentence: a
 * title takes a name, "Fig." takes a number. The stop after one of these
 * never ends a sentence, whatever follows it, which is what keeps
 * "Dr. Maya Chen" — one protected person to the extractor — in one piece.
 */
const TITLE_ABBREVIATIONS = new Set(["dr", "prof", "mr", "mrs", "ms", "sr", "jr", "st", "mt", "fig", "no", "vol", "ed", "pp"]);

/**
 * Abbreviations that can end a sentence as easily as continue one:
 * "...for Acme Corp. The board approved..." against "...Li et al. found...".
 * The case of the next word decides, which is the only signal available
 * without a language model and is right for ordinary English prose.
 * Deliberately small and English-only; every entry is a form this product's
 * own copy, benchmark corpus, or protected-content extractor already
 * produces.
 */
const TRAILING_ABBREVIATIONS = new Set([
  "inc", "corp", "co", "ltd", "llc", "plc", "dept", "est",
  "vs", "etc", "al", "eg", "ie", "cf", "approx",
]);

/** Closing delimiters that may sit between a terminator and the sentence break. */
const CLOSING_DELIMITERS = "\"'”’)]}»";

/**
 * Splits text into sentences.
 *
 * This replaced a single regular expression, `/[^.!?\n]+(?:[.!?]+(?=\s|$)|(?=\n|$))/g`,
 * which was **not total**: any run it could not match was silently dropped.
 * A stop that is not followed by whitespace — the one inside a decimal, a
 * version number, a DOI, an initialism — made the whole alternation fail for
 * the clause containing it, so "The board approved $1." disappeared outright
 * from "The board approved $1.2 million for the next phase."
 *
 * That was not only a scoring bug. `analyzeWriting` derives its rewrite
 * targets from these segments, so a dropped sentence was never analyzed and
 * therefore never rewritten: the customer paid for a passage the engine had
 * quietly skipped. It affected 23 of the 100 benchmark passages.
 *
 * The scanner below guarantees two properties the regular expression did not:
 *
 *   1. **Total.** Every character of the input belongs to exactly one segment
 *      or to a whitespace-only gap between two segments. Nothing is dropped.
 *      `tests/humanization.test.mts` asserts this over the whole corpus.
 *   2. **Abbreviation-aware.** "Dr. Maya Chen reported ..." is one sentence,
 *      not a sentence reading "Dr." followed by another. The extractor treats
 *      "Dr. Maya Chen" as a single protected person, so a split through it
 *      would hand the rewriter half a protected value.
 *
 * Known limits, all shared with any rule-based segmenter and all documented
 * rather than hidden: a sentence that genuinely ends in an abbreviation whose
 * next word is lower-case is not split; a sentence ending "at 8 p.m." is not
 * split, because each stop there follows a single letter and reads as an
 * initial; and non-English sentence conventions are not modelled at all.
 */
export function splitSentences(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let start = 0;

  const push = (from: number, to: number) => {
    const slice = text.slice(from, to);
    const lead = slice.length - slice.trimStart().length;
    const value = slice.trim();
    if (!value) return;
    segments.push({ text: value, start: from + lead, end: from + lead + value.length });
  };

  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === "\n") {
      push(start, index);
      start = index + 1;
      index += 1;
      continue;
    }
    if (character !== "." && character !== "!" && character !== "?") {
      index += 1;
      continue;
    }

    // Consume a run of terminators ("?!", "...") so it ends one sentence.
    let last = index;
    while (last + 1 < text.length && ".!?".includes(text[last + 1])) last += 1;

    // A quotation or parenthetical may close after the terminator and before
    // the break: `She said "Stop." Then she left.` ends a sentence at the
    // quote, not at the stop.
    let close = last;
    while (close + 1 < text.length && CLOSING_DELIMITERS.includes(text[close + 1])) close += 1;
    const closed = close > last;

    const breakAt = close + 1 >= text.length || /\s/.test(text[close + 1]);
    // Behind a closing delimiter the abbreviation list cannot help, so the
    // case of the next word is the only signal: a lower-case word continues
    // the sentence (`He said "Stop." and left.`).
    const nextVisible = text.slice(close + 1).match(/\S/)?.[0];
    const closedBreak = closed && (nextVisible === undefined || nextVisible.toLowerCase() !== nextVisible);
    const terminates = character !== "." || index !== last || endsSentence(text, index, start);

    if (!breakAt || (closed && !closedBreak) || (!closed && !terminates)) {
      index = last + 1;
      continue;
    }

    push(start, close + 1);
    start = close + 1;
    index = close + 1;
  }
  push(start, text.length);

  return segments;
}

/** False when the stop at `dot` belongs to an abbreviation, an initial, or a list marker. */
function endsSentence(text: string, dot: number, segmentStart: number): boolean {
  const word = text.slice(segmentStart, dot).match(/[\p{L}\p{N}]+$/u)?.[0];
  // Nothing alphanumeric immediately precedes the stop, so there is no
  // abbreviation to protect: the stop closes a percentage, a parenthetical,
  // a bracketed citation, or a quotation ("12%.", "(Li et al. 2019).",
  // "[4].", '"the whole thing".'). Returning false here — as the first cut of
  // this scanner did — swallowed the following sentence into this one, and
  // "12%." is one of the most common shapes in the number-heavy corpus.
  if (!word) return true;
  // A single-letter word is an initial ("J. Doe"), not the end of a sentence.
  if (/^\p{L}$/u.test(word)) return false;
  if (/^\d+$/.test(word)) {
    // A bare number that is the whole segment so far is a list marker ("1. First").
    return text.slice(segmentStart, dot).trim() !== word;
  }

  const lower = word.toLowerCase();
  if (TITLE_ABBREVIATIONS.has(lower)) return false;
  if (TRAILING_ABBREVIATIONS.has(lower)) {
    const next = text.slice(dot + 1).match(/\S/)?.[0];
    // A lower-case next word continues the sentence; anything else starts one.
    return next === undefined || next.toLowerCase() !== next;
  }
  return true;
}

export function normalizeForComparison(value: string): string {
  return value.normalize("NFKC").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}
