// The comparison surface's marking engine.
//
// docs/ACTIVATION.md names the AHA moment: "the instant a first-time
// visitor sees their own sentence rewritten beside the original, with the
// exact facts they care about visibly untouched". Three things have to
// land in one glance — it is my text, something changed and I can see
// what, and nothing I would have panicked about changed. Two plain
// paragraphs deliver only the first.
//
// This module renders the other two, entirely from data the browser
// already holds: the original the visitor typed, the preview the server
// chose to expose, and the protected-item list. It requests nothing new
// and — critically for docs/MONETIZATION.md's "diff metadata is clipped
// to exposed regions" rule — it *cannot* leak the locked remainder,
// because the locked remainder is never sent to the browser in the first
// place. Everything below is a projection of bytes already on the page.

import type { ReactNode } from "react";

type Kind = "same" | "cut" | "add" | "pending";
export interface Segment {
  kind: Kind;
  text: string;
}

/** Words with their trailing whitespace, so segments rejoin losslessly. */
function tokenize(value: string): string[] {
  return value.match(/\S+\s*/g) ?? [];
}

/** Compare on word identity only: casing, quotes and punctuation should
 *  not register as a rewrite the customer paid for. */
function normalizeToken(token: string): string {
  return token
    .trim()
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, "");
}

// Above this the quadratic table stops being free. The product caps input
// at 300 words, so this is a guard against a future cap change, not a
// case that happens today.
const MAX_TOKENS = 700;

function pushSegment(into: Segment[], kind: Kind, text: string) {
  if (!text) return;
  const last = into[into.length - 1];
  if (last && last.kind === kind) last.text += text;
  else into.push({ kind, text });
}

/**
 * Word-level diff of the original against the exposed rewrite.
 *
 * Returns one segment list per panel. The rewrite side only ever carries
 * `same` and `add`; the original side carries `same`, `cut`, and a
 * trailing `pending` run — the part of the original the exposed preview
 * has not reached yet. That tail is deliberately *not* marked as a
 * deletion: nothing was deleted there, it is simply still behind the
 * paywall, and calling it a cut would be a false evidence claim.
 */
export function diffRewrite(original: string, rewrite: string): { source: Segment[]; result: Segment[] } {
  const a = tokenize(original);
  const b = tokenize(rewrite);

  if (!a.length || !b.length || a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    return { source: [{ kind: "same", text: original }], result: [{ kind: "same", text: rewrite }] };
  }

  const an = a.map(normalizeToken);
  const bn = b.map(normalizeToken);

  // Longest common subsequence table, rows = a, cols = b.
  const width = b.length + 1;
  const lcs = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i * width + j] =
        an[i] === bn[j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  const source: Segment[] = [];
  const result: Segment[] = [];
  let i = 0;
  let j = 0;
  let lastAligned = 0; // index into `source` just past the last shared word

  while (i < a.length && j < b.length) {
    if (an[i] === bn[j]) {
      pushSegment(source, "same", a[i]);
      pushSegment(result, "same", b[j]);
      i += 1;
      j += 1;
      lastAligned = source.length;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      pushSegment(source, "cut", a[i]);
      i += 1;
    } else {
      pushSegment(result, "add", b[j]);
      j += 1;
    }
  }
  while (j < b.length) {
    pushSegment(result, "add", b[j]);
    j += 1;
  }

  const tailStart = source.length;
  while (i < a.length) {
    pushSegment(source, "cut", a[i]);
    i += 1;
  }

  // Everything after the last word the exposed rewrite matched is
  // unreached, not removed. Re-label it so the original panel reads
  // "here is where the visible rewrite stops", not "we deleted your
  // second half".
  for (let index = Math.max(lastAligned, tailStart); index < source.length; index += 1) {
    if (source[index].kind === "cut") source[index] = { kind: "pending", text: source[index].text };
  }

  return { source, result };
}

/**
 * ACT-07, applied at the display layer.
 *
 * The extractor deliberately keeps overlapping and nested spans, because
 * masking depends on the full set and narrowing it would weaken
 * protection. That set is wrong to *show*: rendered raw it reads
 * "Dr. Sarah Chen · March 14, 2024 · 14 · 2024 · 12%", which makes the
 * evidence for a precision claim look imprecise. This keeps the longest
 * span of each overlapping family, drops duplicates, and orders what is
 * left by where it appears in the text the visitor wrote.
 */
export function selectDisplayFacts(items: readonly string[], source: string): string[] {
  const core = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const trimmed = items.map((item) => item.trim()).filter(Boolean);
  const byLength = [...trimmed].sort((left, right) => right.length - left.length);

  const kept: string[] = [];
  for (const item of byLength) {
    const key = core(item);
    if (!key) continue;
    if (kept.some((existing) => core(existing).includes(key))) continue;
    kept.push(item);
  }

  const haystack = source.toLowerCase();
  return kept.sort((left, right) => {
    const at = haystack.indexOf(left.toLowerCase());
    const bt = haystack.indexOf(right.toLowerCase());
    return (at === -1 ? Number.MAX_SAFE_INTEGER : at) - (bt === -1 ? Number.MAX_SAFE_INTEGER : bt);
  });
}

/** Case-insensitive, longest-first, non-overlapping literal matches. */
function factRanges(text: string, facts: readonly string[]): Array<{ start: number; end: number }> {
  const haystack = text.toLowerCase();
  const ranges: Array<{ start: number; end: number }> = [];
  const ordered = [...new Set(facts.map((fact) => fact.trim()).filter((fact) => fact.length > 1))].sort(
    (left, right) => right.length - left.length,
  );

  for (const fact of ordered) {
    const needle = fact.toLowerCase();
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      const end = at + needle.length;
      if (!ranges.some((range) => at < range.end && end > range.start)) ranges.push({ start: at, end });
      from = end;
    }
  }
  return ranges.sort((left, right) => left.start - right.start);
}

function withFactMarks(text: string, facts: readonly string[], keyPrefix: string): ReactNode {
  if (!facts.length) return text;
  const ranges = factRanges(text, facts);
  if (!ranges.length) return text;

  const out: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) out.push(text.slice(cursor, range.start));
    out.push(
      <mark className="fact" key={`${keyPrefix}f${index}`}>
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

/** Each addition's position among the additions, so the marks can light
 *  up in reading order instead of all at once. Computed outside the
 *  component so the render pass itself stays free of mutation. */
function addOrdinals(segments: readonly Segment[]): number[] {
  let running = 0;
  return segments.map((segment) => (segment.kind === "add" ? (running += 1) : 0));
}

/**
 * Renders one panel's segments.
 *
 * Every mark is carried by shape as well as colour — a cut is struck
 * through, an addition sits on a solid rule, a protected fact keeps a
 * dotted rule — so the three stay distinguishable in one sentence
 * without relying on hue (ACT-04, ACT-08).
 *
 * The screen-reader path is handled by the surrounding panel, which
 * carries a plain-language summary; `del`/`ins` here keep the visual
 * marks semantic without chopping the sentence into announced fragments.
 */
export function MarkedText({
  segments,
  facts = [],
}: {
  segments: readonly Segment[];
  facts?: readonly string[];
}) {
  const addOrdinal = addOrdinals(segments);

  return (
    <>
      {segments.map((segment, index) => {
        // Marks hug their words: the trailing space a token carries stays
        // outside the highlight, so a mark never runs on past the comma
        // it ends at.
        const body = segment.text.trimEnd();
        const trail = segment.text.slice(body.length);
        const marked = withFactMarks(segment.kind === "same" ? segment.text : body, facts, `s${index}`);
        if (segment.kind === "cut")
          return (
            <span key={index}>
              <del>{marked}</del>
              {trail}
            </span>
          );
        if (segment.kind === "pending")
          return (
            <span className="pending-text" key={index}>
              {marked}
            </span>
          );
        if (segment.kind === "add")
          return (
            <span key={index}>
              <ins style={{ "--mark-index": addOrdinal[index] } as React.CSSProperties}>{marked}</ins>
              {trail}
            </span>
          );
        return <span key={index}>{marked}</span>;
      })}
    </>
  );
}

/** Plain-language count for the panel's screen-reader summary. */
export function describeMarks(segments: readonly Segment[]): string {
  const cuts = segments.filter((segment) => segment.kind === "cut").length;
  const adds = segments.filter((segment) => segment.kind === "add").length;
  const parts: string[] = [];
  if (cuts) parts.push(`${cuts} ${cuts === 1 ? "phrase" : "phrases"} removed`);
  if (adds) parts.push(`${adds} ${adds === 1 ? "phrase" : "phrases"} rewritten`);
  return parts.length ? `Marked in this passage: ${parts.join(", ")}.` : "";
}
