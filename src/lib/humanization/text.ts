import type { TextRange } from "./types";

export interface TextSegment extends TextRange {
  text: string;
}

export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

export function splitSentences(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const expression = /[^.!?\n]+(?:[.!?]+(?=\s|$)|(?=\n|$))/g;
  for (const match of text.matchAll(expression)) {
    const raw = match[0];
    const leftPadding = raw.length - raw.trimStart().length;
    const value = raw.trim();
    if (!value) continue;
    const start = (match.index ?? 0) + leftPadding;
    segments.push({ text: value, start, end: start + value.length });
  }
  return segments;
}

export function normalizeForComparison(value: string): string {
  return value.normalize("NFKC").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}
