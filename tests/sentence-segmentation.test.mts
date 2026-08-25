import assert from "node:assert/strict";
import test from "node:test";

import { HUMANIZATION_BENCHMARK_PASSAGES } from "../benchmarks/humanization-passages";
import { splitSentences } from "../src/lib/humanization/text";
import { analyzeWriting } from "../src/lib/humanization/analysis";

/**
 * Reassembles a segmentation into the string it came from.
 *
 * Segments carry trimmed text plus source offsets, so "reproduces the input"
 * means: the gaps between consecutive segments are whitespace only, each
 * segment's offsets address exactly its own text, and interleaving gaps with
 * segments returns the original character-for-character. A segmenter that
 * drops a clause fails this; one that merely varies where it breaks does not.
 */
function reassemble(text: string): string {
  const segments = splitSentences(text);
  let rebuilt = "";
  let cursor = 0;
  for (const segment of segments) {
    assert.ok(segment.start >= cursor, "segments must not overlap or run backwards");
    const gap = text.slice(cursor, segment.start);
    assert.equal(gap.trim(), "", `dropped non-whitespace text: ${JSON.stringify(gap)}`);
    assert.equal(text.slice(segment.start, segment.end), segment.text, "segment offsets must address its own text");
    rebuilt += gap + segment.text;
    cursor = segment.end;
  }
  const tail = text.slice(cursor);
  assert.equal(tail.trim(), "", `dropped trailing text: ${JSON.stringify(tail)}`);
  return rebuilt + tail;
}

test("segmentation is total across every benchmark passage", () => {
  // The predecessor regular expression dropped text in 23 of these 100
  // passages: a stop not followed by whitespace ("$1.2", "0.81", "et al.",
  // "doi:10.5281") made the whole alternation fail for its clause, and the
  // clause vanished. Because analyzeWriting derives rewrite targets from
  // these segments, a dropped sentence was never rewritten at all.
  for (const passage of HUMANIZATION_BENCHMARK_PASSAGES) {
    assert.equal(reassemble(passage.text), passage.text, `${passage.id} lost text during segmentation`);
  }
});

test("segmentation is total for punctuation shapes that break naive alternation", () => {
  for (const text of [
    "The board approved $1.2 million for the next phase. Work starts in May.",
    "The model achieved an F1 score of 0.81 on the held-out set. However, performance declined.",
    "The dataset is archived under doi:10.5281/zenodo.7654321 and remains open.",
    "TLS 1.3 is required for connections to https://api.example.com/v2. Older clients fail.",
    "Ready?! Let's go.",
    "No terminator at all",
    "",
    "   ",
    "\n\n",
    "Trailing whitespace after the stop.   ",
    "Multiple\n\nparagraphs\nwith newlines.",
    "Ellipsis... then more. And an end.",
  ]) {
    assert.equal(reassemble(text), text, `lost text in ${JSON.stringify(text)}`);
  }
});

test("a decimal keeps its sentence whole", () => {
  const text = "The board approved $1.2 million for the next phase. Work starts in May.";
  assert.deepEqual(
    splitSentences(text).map((segment) => segment.text),
    ["The board approved $1.2 million for the next phase.", "Work starts in May."],
  );
});

test("a title abbreviation does not split the person it introduces", () => {
  // The extractor treats "Dr. Maya Chen" as one protected person, so a split
  // through it would hand the rewriter half a protected value.
  const text = "Dr. Maya Chen reported the result. She wrote the summary herself.";
  const segments = splitSentences(text);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].text, "Dr. Maya Chen reported the result.");
});

test("a trailing abbreviation splits on the case of the next word", () => {
  assert.deepEqual(
    splitSentences("Benefits vary with canopy density (Li et al. 2019). Rainfall matters more.").map((s) => s.text),
    ["Benefits vary with canopy density (Li et al. 2019).", "Rainfall matters more."],
  );
  assert.deepEqual(
    splitSentences("She joined Acme Corp. The board approved the move.").map((s) => s.text),
    ["She joined Acme Corp.", "The board approved the move."],
  );
  assert.deepEqual(
    splitSentences("Marsh et al. found the opposite.").map((s) => s.text),
    ["Marsh et al. found the opposite."],
  );
});

test("a numbered list marker is not a sentence boundary", () => {
  assert.deepEqual(
    splitSentences("1. Draft the brief\n2. Circulate it for review").map((s) => s.text),
    ["1. Draft the brief", "2. Circulate it for review"],
  );
});

test("a sentence ending inside a quotation closes at the quote", () => {
  assert.deepEqual(
    splitSentences('She said "Stop." Then she left.').map((s) => s.text),
    ['She said "Stop."', "Then she left."],
  );
  // A lower-case word after the closing quote continues the same sentence.
  assert.deepEqual(
    splitSentences('He said "Stop." and left the room.').map((s) => s.text),
    ['He said "Stop." and left the room.'],
  );
});

test("analysis targets a sentence a naive segmenter dropped entirely", () => {
  // citation-heavy-01's shape: the clause containing "et al." used to vanish
  // before analysis ever saw it, so its generic transition was never removed.
  const text = "Canopy cover reduced soil temperature by 2.4 degrees. Moreover, benefits vary with canopy density (Li et al. 2019). Winter reverses the effect.";
  const analysis = analyzeWriting(text);
  assert.equal(analysis.sentenceCount, 3);
  assert.ok(
    analysis.targets.some((target) => target.text.includes("Li et al. 2019")),
    "the clause containing the citation must be reachable as a rewrite target",
  );
});
