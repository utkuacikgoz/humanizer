// M3-03 (HE): generating a different version of ONE sentence of a rewrite the
// customer is already looking at, and restoring one sentence to what they
// originally wrote.
//
// This module is the engine half. It knows nothing about identity, money, or
// the database; src/lib/sentence-operations.ts owns those and calls in here.
// It must stay free of `cloudflare:workers`, `next/headers` and
// `next/navigation` imports.
//
// The invariant that makes sentence indexes meaningful at all:
//
//   **one sentence in, one sentence out.**
//
// A candidate that splits the target into two sentences, or merges it with a
// neighbour, is rejected. Without that rule, index 4 could silently mean a
// different sentence after every operation, and "restore sentence 4" would
// restore the wrong text — a quiet corruption of a paying customer's
// document, which is worse than refusing an occasional acceptable candidate.
import { analyzeWriting } from "./analysis";
import { DeterministicHumanizationProvider } from "./deterministic-provider";
import { DeterministicEvaluationProvider } from "./evaluation";
import { extractProtectedContent } from "./protected-content";
import { DEFAULT_HUMANIZATION_CONFIG } from "./pipeline";
import { countWords, normalizeForComparison, splitSentences, type TextSegment } from "./text";
import type {
  EvaluationProvider,
  EvaluationThresholds,
  HumanizationProvider,
  VerificationIssue,
  VerificationProvider,
  WritingMode,
} from "./types";
import { DeterministicVerificationProvider } from "./verification";

/**
 * Attempts allowed inside ONE sentence operation.
 *
 * Distinct from the per-sentence cap in src/lib/sentence-operations.ts: that
 * bounds how many times a customer may ask, this bounds how much work one ask
 * may do. Both exist because either alone leaves an unmetered loop.
 */
export const MAX_SENTENCE_ATTEMPTS = 2;

/**
 * The quality gate for a single sentence, derived from the whole-document
 * thresholds rather than invented alongside them, so a threshold change in
 * pipeline.ts reaches this path too.
 *
 * `readability` is the one exception and is deliberately not applied. It is a
 * Flesch score, computed as words-per-sentence and syllables-per-word; over a
 * single sentence the first term collapses to "the sentence's length", so the
 * statistic stops measuring readability and starts rejecting long sentences.
 * Meaning, protected content, grammar, repetition and tone are all still
 * enforced, and semantic verification below is the gate that actually decides.
 */
export const SENTENCE_THRESHOLDS: EvaluationThresholds = {
  ...DEFAULT_HUMANIZATION_CONFIG.thresholds,
  readability: 0,
};

export type SentenceRejectionReason =
  | "verification-failed"
  | "quality-failed"
  | "protected-content-lost"
  | "sentence-boundary-changed"
  | "provider-failed";

export type SentenceRegeneration =
  /** A verified, different candidate. `words` is what this operation may charge. */
  | { status: "applied"; text: string; sentence: string; previousSentence: string; words: number }
  /** The engine produced nothing materially different. Charges nothing. */
  | { status: "unchanged"; sentence: string }
  /** No candidate passed. Charges nothing, and nothing is returned to the caller. */
  | { status: "rejected"; reason: SentenceRejectionReason };

export interface SentenceRegenerationDeps {
  humanizationProvider?: HumanizationProvider;
  verificationProvider?: VerificationProvider;
  evaluationProvider?: EvaluationProvider;
}

export interface SentenceRegenerationRequest {
  /** The complete current rewrite the customer is looking at. */
  text: string;
  /** Index into segmentSentences(text). */
  sentenceIndex: number;
  mode: WritingMode;
  /**
   * Values the job's extraction already identified as protected. Passed in
   * rather than re-derived from the rewrite, so a protected item the rewrite
   * happens to render in a form the extractor no longer recognises is still
   * protected here.
   */
  protectedValues?: string[];
  signal?: AbortSignal;
}

/**
 * The engine has ONE segmenter, and this is it.
 *
 * This module used to carry its own `segmentSentences`, written because
 * `splitSentences` was not total: a stop not followed by whitespace made its
 * single regular expression drop the clause containing it, and an index over
 * a segmentation that can lose text can select the wrong text. Changing
 * `splitSentences` was left out of scope then, because analysis targets, the
 * readability score and the benchmark thresholds all move with it and that
 * needed benchmark evidence rather than a side effect of shipping sentence
 * editing.
 *
 * That evidence now exists (docs/BENCHMARKS.md, "Recorded runs"), and
 * `splitSentences` is total and abbreviation-aware. Keeping a second
 * segmenter would be a defect in itself: wherever two segmenters disagree,
 * one of them is wrong. They disagreed on 17 of the 125 benchmark passages,
 * and the local copy was wrong in every one — its `endsSentence` treated a
 * stop with nothing alphanumeric in front of it as never ending a sentence,
 * so a sentence closing `15%.`, `(Li et al., 2024).`, `[14-16].` or
 * "`account_id`." swallowed the sentence after it.
 *
 * That is not a cosmetic difference here. Two sentences returned as one means
 * `sentenceAt(text, 4)` addresses a span twice its intended size, so
 * "regenerate sentence 4" rewrites two sentences and the one-sentence-in,
 * one-sentence-out invariant below fails silently — exactly the quiet
 * corruption of a paying customer's document this module exists to prevent.
 */
export type Sentence = TextSegment;

export const segmentSentences: (text: string) => Sentence[] = splitSentences;

/** Locates one sentence of a document, or null when the index names none. */
export function sentenceAt(text: string, index: number): Sentence | null {
  if (!Number.isInteger(index) || index < 0) return null;
  return segmentSentences(text)[index] ?? null;
}

export function sentenceCount(text: string): number {
  return segmentSentences(text).length;
}

/** Splices one sentence back into the document, leaving all surrounding whitespace intact. */
function replaceSentence(text: string, span: { start: number; end: number }, replacement: string): string {
  return `${text.slice(0, span.start)}${replacement}${text.slice(span.end)}`;
}

function isMateriallySame(a: string, b: string): boolean {
  return normalizeForComparison(a).toLowerCase() === normalizeForComparison(b).toLowerCase();
}

/**
 * Every protected value that occurs in `before` must occur at least as often
 * in `after`.
 *
 * This is a whole-document check, not a sentence-level one, and it is
 * deliberately redundant with the verification provider's own protected-content
 * scoring: verification looks at the items it can re-extract from the target
 * sentence, and this looks at the list the job recorded when it was first
 * rewritten. A value the extractor would no longer find is still caught here.
 */
export function protectedValuesSurvive(before: string, after: string, values: readonly string[]): boolean {
  for (const value of new Set(values.filter((entry) => entry.trim().length > 0))) {
    if (occurrences(after, value) < occurrences(before, value)) return false;
  }
  return true;
}

function occurrences(text: string, value: string): number {
  let count = 0;
  let cursor = text.indexOf(value);
  while (cursor >= 0) {
    count += 1;
    cursor = text.indexOf(value, cursor + value.length);
  }
  return count;
}

/**
 * Produces a verified replacement for one sentence, or explains why it did
 * not.
 *
 * Nothing is returned until it has passed, in order: the one-sentence
 * boundary rule, semantic verification against the sentence it replaces,
 * whole-document protected-value survival, and the sentence quality gate. A
 * candidate that fails any of them is discarded and the next attempt runs;
 * when the attempts are spent the operation is `rejected` and the caller
 * charges nothing.
 */
export async function regenerateSentence(
  request: SentenceRegenerationRequest,
  deps: SentenceRegenerationDeps = {},
): Promise<SentenceRegeneration> {
  const humanizationProvider = deps.humanizationProvider ?? new DeterministicHumanizationProvider();
  const verificationProvider = deps.verificationProvider ?? new DeterministicVerificationProvider();
  const evaluationProvider = deps.evaluationProvider ?? new DeterministicEvaluationProvider();

  const span = sentenceAt(request.text, request.sentenceIndex);
  if (!span) return { status: "rejected", reason: "sentence-boundary-changed" };

  const target = span.text;
  const protectedValues = request.protectedValues ?? [];
  // Only the recorded values that actually appear in this sentence are handed
  // to the rewriter as terms to mask; the survival check below still uses the
  // whole list against the whole document.
  //
  // A value the extractor already recognises is deliberately NOT handed back
  // to it. extractProtectedContent keys its dedupe on kind as well as span, so
  // re-supplying a detected entity as a custom term produces two items over
  // one span - "Dr. Elena Marsh" as both `person` and `technical-term`. The
  // verifier then requires each to survive on its own, and a candidate that
  // contains the name once can only satisfy one of them, so every regeneration
  // of a sentence containing a protected value rejected. Feeding detected
  // values back is unique to this path, which is why the extractor's own
  // behaviour is right for /api/humanize and wrong here.
  const detected = extractProtectedContent(target);
  const alreadyCovered = new Set(detected.map((item) => item.normalizedValue));
  const termsInSentence = protectedValues.filter(
    (value) => value.trim() && target.includes(value) && !alreadyCovered.has(normalizeForComparison(value)),
  );
  const protectedContent = termsInSentence.length ? extractProtectedContent(target, termsInSentence) : detected;
  const analysis = analyzeWriting(target);

  let previousFailures: VerificationIssue[] = [];
  let lastRejection: SentenceRejectionReason = "quality-failed";
  let sawUnchanged = false;

  for (let attempt = 1; attempt <= MAX_SENTENCE_ATTEMPTS; attempt += 1) {
    request.signal?.throwIfAborted();
    let candidate: string;
    try {
      const rewrite = await humanizationProvider.rewrite({
        text: target,
        mode: request.mode,
        protectedContent,
        analysis,
        attempt,
        previousFailures,
        signal: request.signal,
      });
      candidate = rewrite.text.trim();
    } catch (error) {
      if (request.signal?.aborted) throw error;
      // Never carry the provider's error text forward into anything stored or
      // returned: it can quote the sentence it failed on.
      lastRejection = "provider-failed";
      previousFailures = [{ kind: "changed-meaning", message: "The rewrite provider failed." }];
      continue;
    }

    if (!candidate) {
      lastRejection = "provider-failed";
      continue;
    }
    if (isMateriallySame(candidate, target)) {
      sawUnchanged = true;
      continue;
    }
    if (segmentSentences(candidate).length !== 1) {
      lastRejection = "sentence-boundary-changed";
      continue;
    }

    const verification = await verificationProvider.verify({
      original: target,
      candidate,
      protectedContent,
      signal: request.signal,
    });
    if (!verification.passed) {
      lastRejection = "verification-failed";
      previousFailures = verification.issues;
      continue;
    }

    const nextText = replaceSentence(request.text, span, candidate);
    if (!protectedValuesSurvive(request.text, nextText, protectedValues)) {
      lastRejection = "protected-content-lost";
      previousFailures = [{ kind: "missing-protected-content", message: "Protected content did not survive." }];
      continue;
    }

    const evaluation = await evaluationProvider.evaluate({
      original: target,
      candidate,
      mode: request.mode,
      originalAnalysis: analysis,
      candidateAnalysis: analyzeWriting(candidate),
      verification,
      signal: request.signal,
    }, SENTENCE_THRESHOLDS);
    if (!evaluation.passed) {
      lastRejection = "quality-failed";
      previousFailures = evaluation.failedThresholds.map((threshold) => ({
        kind: "changed-meaning" as const,
        message: `Candidate missed the ${threshold} quality threshold.`,
      }));
      continue;
    }

    return {
      status: "applied",
      text: nextText,
      sentence: candidate,
      previousSentence: target,
      words: countWords(candidate),
    };
  }

  // A run whose only outcome was "the engine reproduced this sentence" is not
  // a failure to report as one: there is nothing wrong with the sentence, the
  // engine simply has no different version of it. Either way the debit is zero.
  return sawUnchanged ? { status: "unchanged", sentence: target } : { status: "rejected", reason: lastRejection };
}

/**
 * Restores one sentence of the rewrite to the corresponding sentence of the
 * customer's own original text. Generates nothing, so it charges nothing.
 *
 * Refuses when the two documents no longer have the same number of sentences.
 * The one-sentence-in-one-sentence-out rule keeps them aligned through every
 * sentence operation, so a mismatch means the alignment was never there (the
 * rewrite itself merged or split sentences) and index N in the rewrite is not
 * index N in the original. Refusing is the only honest answer: restoring the
 * wrong sentence would silently corrupt the document.
 */
export function restoreSentence(input: {
  text: string;
  original: string;
  sentenceIndex: number;
}): { status: "applied"; text: string; sentence: string; previousSentence: string }
  | { status: "unchanged"; sentence: string }
  | { status: "rejected"; reason: "sentence-boundary-changed" } {
  const span = sentenceAt(input.text, input.sentenceIndex);
  const originalSentences = segmentSentences(input.original);
  if (!span || originalSentences.length !== sentenceCount(input.text)) {
    return { status: "rejected", reason: "sentence-boundary-changed" };
  }

  const restored = originalSentences[input.sentenceIndex].text;
  if (isMateriallySame(restored, span.text)) return { status: "unchanged", sentence: span.text };

  return {
    status: "applied",
    text: replaceSentence(input.text, span, restored),
    sentence: restored,
    previousSentence: span.text,
  };
}
