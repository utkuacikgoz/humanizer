import { maskProtectedContent } from "./protected-content";
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
  [/\bIn addition,?\s*/gi, ""],
  [/\bMoving forward,?\s*/gi, "From here, "],
  [/\bIn order to\b/gi, "To"],
  [/\bdue to the fact that\b/gi, "because"],
  [/\bthe reason is because\b/gi, "the reason is that"],
  [/\beach and every\b/gi, "every"],
  [/\bend result\b/gi, "result"],
  [/\bfuture plans\b/gi, "plans"],
  [/\bbasic fundamentals\b/gi, "fundamentals"],
  [/\butilize\b/gi, "use"],
  [/\bleverage\b/gi, "use"],
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

function preserveCapitalization(before: string, after: string): string {
  if (!after || !before || before[0] !== before[0].toUpperCase()) return after;
  return `${after[0].toUpperCase()}${after.slice(1)}`;
}

function applyRewrites(text: string, mode: WritingMode): string {
  let candidate = text;
  for (const [expression, replacement] of [...COMMON_REWRITES, ...MODE_REWRITES[mode]]) {
    candidate = candidate.replace(expression, (match) => preserveCapitalization(match.trimStart(), replacement));
  }
  return candidate
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/([.!?]) {2,}/g, "$1 ")
    .replace(/(^|[.!?]\n]\s+)([a-z])/g, (_match, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`);
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
