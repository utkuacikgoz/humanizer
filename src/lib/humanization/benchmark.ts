import { HumanizationFailedError, HumanizationPipeline } from "./pipeline";
import type { WritingMode } from "./types";

export interface BenchmarkExpectedFact {
  kind: string;
  value: string;
}

export interface HumanizationBenchmarkPassage {
  id: string;
  category: string;
  text: string;
  mode: WritingMode;
  expectedProtectedFacts: BenchmarkExpectedFact[];
}

export interface BenchmarkPassageResult {
  id: string;
  passed: boolean;
  semanticFailure: boolean;
  protectedContentFailure: boolean;
  naturalness: number;
  latencyMs: number;
  estimatedTokens: number;
  estimatedCostUsd: number;
}

export interface BenchmarkSummary {
  passages: number;
  passed: number;
  semanticFailures: number;
  protectedContentFailures: number;
  averageNaturalness: number;
  averageLatencyMs: number;
  estimatedTokens: number;
  estimatedCostUsd: number;
  results: BenchmarkPassageResult[];
}

export async function runHumanizationBenchmark(
  passages: HumanizationBenchmarkPassage[],
  pipeline: HumanizationPipeline = new HumanizationPipeline(),
): Promise<BenchmarkSummary> {
  const results: BenchmarkPassageResult[] = [];
  for (const passage of passages) {
    try {
      const result = await pipeline.humanize({ text: passage.text, mode: passage.mode });
      const protectedValues = new Set(result.protectedContent.map((item) => `${item.kind}:${item.value}`));
      const expectedFactsFound = passage.expectedProtectedFacts.every((fact) => protectedValues.has(`${fact.kind}:${fact.value}`) && result.text.includes(fact.value));
      results.push({
        id: passage.id,
        passed: expectedFactsFound,
        semanticFailure: !result.verification.passed,
        protectedContentFailure: !expectedFactsFound || result.verification.protectedContentScore < 1,
        naturalness: result.evaluation.scores.naturalness,
        latencyMs: result.metrics.latencyMs,
        estimatedTokens: result.metrics.estimatedTokens,
        estimatedCostUsd: result.metrics.estimatedCostUsd,
      });
    } catch (error) {
      const failure = error instanceof HumanizationFailedError ? error : undefined;
      results.push({
        id: passage.id,
        passed: false,
        semanticFailure: !failure?.verification?.passed,
        protectedContentFailure: (failure?.verification?.protectedContentScore ?? 0) < 1,
        naturalness: failure?.evaluation?.scores.naturalness ?? 0,
        latencyMs: failure?.metrics.latencyMs ?? 0,
        estimatedTokens: failure?.metrics.estimatedTokens ?? 0,
        estimatedCostUsd: failure?.metrics.estimatedCostUsd ?? 0,
      });
    }
  }

  const divisor = Math.max(1, results.length);
  return {
    passages: results.length,
    passed: results.filter((result) => result.passed).length,
    semanticFailures: results.filter((result) => result.semanticFailure).length,
    protectedContentFailures: results.filter((result) => result.protectedContentFailure).length,
    averageNaturalness: Number((results.reduce((sum, result) => sum + result.naturalness, 0) / divisor).toFixed(4)),
    averageLatencyMs: Number((results.reduce((sum, result) => sum + result.latencyMs, 0) / divisor).toFixed(2)),
    estimatedTokens: results.reduce((sum, result) => sum + result.estimatedTokens, 0),
    estimatedCostUsd: Number(results.reduce((sum, result) => sum + result.estimatedCostUsd, 0).toFixed(8)),
    results,
  };
}
