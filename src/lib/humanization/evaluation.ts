import { countWords, clampScore, splitSentences } from "./text";
import type { EvaluationProvider, EvaluationRequest, EvaluationResult, EvaluationThresholds, QualityScores, WritingMode } from "./types";

function readability(text: string): number {
  const sentences = Math.max(1, splitSentences(text).length);
  const words = Math.max(1, countWords(text));
  const syllables = (text.toLowerCase().match(/[aeiouy]+/g) ?? []).length;
  const flesch = 206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words);
  return clampScore((flesch + 40) / 140);
}

function grammar(text: string): number {
  let deductions = 0;
  if (/\s+[,.!?;]/.test(text)) deductions += 0.15;
  if (/(^|[.!?]\s+)[a-z]/.test(text)) deductions += 0.15;
  if (/\b(\w+)\s+\1\b/i.test(text)) deductions += 0.2;
  if (/\s{3,}/.test(text)) deductions += 0.1;
  return clampScore(1 - deductions);
}

function toneAdherence(text: string, mode: WritingMode): number {
  const checks: Record<WritingMode, RegExp> = {
    natural: /\b(?:herein|aforementioned|pursuant)\b/i,
    professional: /\b(?:lol|kinda|gonna|wanna)\b/i,
    academic: /\b(?:lol|awesome|super|a bunch of)\b/i,
    casual: /\b(?:herein|thereby|aforementioned|pursuant)\b/i,
  };
  return checks[mode].test(text) ? 0.55 : 0.9;
}

export class DeterministicEvaluationProvider implements EvaluationProvider {
  readonly name = "deterministic-quality-v1";

  async evaluate(request: EvaluationRequest, thresholds: EvaluationThresholds): Promise<EvaluationResult> {
    const originalIssues = request.originalAnalysis.issues.length;
    const candidateIssues = request.candidateAnalysis.issues.length;
    const improvementRatio = originalIssues ? Math.max(0, (originalIssues - candidateIssues) / originalIssues) : 1;
    const naturalness = clampScore(0.58 + improvementRatio * 0.34 - Math.min(0.2, candidateIssues * 0.025));
    const repetitiveIssues = request.candidateAnalysis.issues.filter((issue) => issue.kind === "repetitive-length" || issue.kind === "repetitive-opening" || issue.kind === "predictable-paragraph").length;
    const scores: QualityScores = {
      naturalness,
      readability: readability(request.candidate),
      grammar: grammar(request.candidate),
      repetition: clampScore(1 - Math.min(0.6, repetitiveIssues * 0.12)),
      meaningPreservation: request.verification.semanticScore,
      toneAdherence: toneAdherence(request.candidate, request.mode),
    };
    const failedThresholds = (Object.keys(scores) as Array<keyof QualityScores>).filter((key) => scores[key] < thresholds[key]);
    return { passed: failedThresholds.length === 0, scores, failedThresholds };
  }
}
