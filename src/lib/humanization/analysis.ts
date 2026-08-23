import type { WritingAnalysis, WritingIssue, WritingIssueKind } from "./types";
import { countWords, splitSentences } from "./text";

const MARKERS: Array<{ kind: WritingIssueKind; severity: WritingIssue["severity"]; expression: RegExp; message: string }> = [
  { kind: "generic-transition", severity: "medium", expression: /\b(?:furthermore|moreover|additionally|in addition|on the other hand)\b/gi, message: "Generic transition makes the prose feel templated." },
  { kind: "unnecessary-summary", severity: "medium", expression: /\b(?:in summary|to summarize|as we have seen|in conclusion)\b/gi, message: "The passage restates its conclusion mechanically." },
  { kind: "excessive-qualifier", severity: "low", expression: /\b(?:very|really|quite|rather|somewhat|arguably|generally|typically|essentially|potentially)\b/gi, message: "A qualifier weakens the sentence." },
  { kind: "corporate-filler", severity: "high", expression: /\b(?:leverage|synergy|best-in-class|robust solution|drive value|at scale|moving forward|strategic alignment|value-added)\b/gi, message: "Corporate filler obscures the point." },
  { kind: "robotic-vocabulary", severity: "high", expression: /\b(?:delve(?:s|d)? into|multifaceted|ever-evolving|tapestry|realm|underscores|pivotal|crucial to note|it is important to note|in today's fast-paced world|stands as a testament)\b/gi, message: "Stock AI vocabulary makes the sentence sound robotic." },
  { kind: "redundant-explanation", severity: "medium", expression: /\b(?:the reason (?:is )?because|due to the fact that|each and every|end result|future plans|basic fundamentals)\b/gi, message: "The sentence explains the same idea twice." },
  { kind: "excessive-exposition", severity: "medium", expression: /\b(?:it should be noted that|it is worth mentioning that|needless to say|the fact of the matter is that)\b/gi, message: "A throat-clearing phrase delays the point." },
  { kind: "generic-conclusion", severity: "medium", expression: /\b(?:the possibilities are endless|only time will tell|a brighter future|make a lasting impact)\b/gi, message: "The conclusion is generic rather than specific." },
  { kind: "parallel-structure", severity: "low", expression: /\bnot only\b[\s\S]{0,100}\bbut also\b/gi, message: "The parallel construction is overused." },
];

function opening(text: string): string {
  return text.toLowerCase().replace(/^["'“‘(]+/, "").match(/[\p{L}\p{N}]+/u)?.[0] ?? "";
}

export function analyzeWriting(text: string): WritingAnalysis {
  const sentences = splitSentences(text);
  const issues: WritingIssue[] = [];

  for (const marker of MARKERS) {
    marker.expression.lastIndex = 0;
    for (const match of text.matchAll(marker.expression)) {
      issues.push({ kind: marker.kind, severity: marker.severity, message: marker.message, start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
    }
  }

  const lengths = sentences.map((sentence) => countWords(sentence.text));
  for (let index = 2; index < sentences.length; index += 1) {
    const group = lengths.slice(index - 2, index + 1);
    if (Math.max(...group) - Math.min(...group) <= 2) {
      const sentence = sentences[index];
      issues.push({ kind: "repetitive-length", severity: "low", message: "Several consecutive sentences have the same rhythm.", start: sentence.start, end: sentence.end });
    }
    const currentOpening = opening(sentences[index].text);
    if (currentOpening && currentOpening === opening(sentences[index - 1].text) && currentOpening === opening(sentences[index - 2].text)) {
      const sentence = sentences[index];
      issues.push({ kind: "repetitive-opening", severity: "medium", message: "Several sentences begin the same way.", start: sentence.start, end: sentence.end });
    }
  }

  const paragraphs = text.split(/\n\s*\n/).filter((paragraph) => paragraph.trim());
  if (paragraphs.length >= 3 && paragraphs.every((paragraph) => splitSentences(paragraph).length === splitSentences(paragraphs[0]).length)) {
    issues.push({ kind: "predictable-paragraph", severity: "low", message: "Every paragraph follows the same shape.", start: 0, end: text.length });
  }

  const targets = sentences.flatMap((sentence) => {
    const relevant = issues.filter((issue) => issue.start < sentence.end && issue.end > sentence.start);
    return relevant.length
      ? [{ ...sentence, issueKinds: [...new Set(relevant.map((issue) => issue.kind))] }]
      : [];
  });

  return {
    issues: issues.sort((a, b) => a.start - b.start || a.end - b.end),
    targets,
    sentenceCount: sentences.length,
    paragraphCount: paragraphs.length,
    averageSentenceWords: sentences.length ? Number((lengths.reduce((sum, length) => sum + length, 0) / sentences.length).toFixed(2)) : 0,
  };
}
