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
  category: string;
  /**
   * False when the engine returned the input untouched. A no-op scores as a
   * pass under `passed` (which only checks that declared protected facts
   * survived), so without this the report cannot distinguish "handled well"
   * from "did nothing at all" — and the engine is a no-op on 10 of the 10
   * number-heavy passages.
   */
  changed: boolean;
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
  /** Passages the engine returned untouched. */
  unchanged: number;
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
        category: passage.category,
        changed: result.text !== passage.text,
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
        category: passage.category,
        changed: false,
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
    unchanged: results.filter((result) => !result.changed).length,
    semanticFailures: results.filter((result) => result.semanticFailure).length,
    protectedContentFailures: results.filter((result) => result.protectedContentFailure).length,
    averageNaturalness: Number((results.reduce((sum, result) => sum + result.naturalness, 0) / divisor).toFixed(4)),
    averageLatencyMs: Number((results.reduce((sum, result) => sum + result.latencyMs, 0) / divisor).toFixed(2)),
    estimatedTokens: results.reduce((sum, result) => sum + result.estimatedTokens, 0),
    estimatedCostUsd: Number(results.reduce((sum, result) => sum + result.estimatedCostUsd, 0).toFixed(8)),
    results,
  };
}

/**
 * What a CORRECT humanizer must do with an adversarial passage.
 *
 * `outcome: "preserve"` states that the input is already good writing and any
 * edit is an unnecessary change — the "unnecessary-change rate for
 * already-good passages" docs/BENCHMARKS.md requires and the release set does
 * not measure at all.
 */
export interface AdversarialExpectation {
  outcome: "rewrite" | "preserve";
  /** Substrings that must appear verbatim in the output. */
  mustPreserve?: string[];
  /**
   * Substrings the engine must never CREATE. Emitting one means the rewrite
   * corrupted the text ("To the survey", "gained use", "EBay"), so this is a
   * hard-safety failure.
   */
  mustNotProduce?: string[];
  /**
   * Substrings present in the INPUT that a correct humanizer should have
   * removed. Leaving one is a quality miss, not corruption, and is scored
   * separately — conflating the two would overstate the safety record.
   */
  mustRemove?: string[];
}

export interface AdversarialPassage extends HumanizationBenchmarkPassage {
  expectation: AdversarialExpectation;
  /** One line on why this case is hard. Read it before changing an expectation. */
  note: string;
}

export type AdversarialFailureKind =
  | "threw"
  | "lost-required-text"
  | "produced-forbidden-text"
  | "failed-to-remove"
  | "no-op-on-text-that-needed-rewriting"
  | "unnecessary-change"
  | "semantic-failure"
  | "protected-content-failure";

export interface AdversarialPassageResult {
  id: string;
  category: string;
  passed: boolean;
  failures: Array<{ kind: AdversarialFailureKind; detail: string }>;
}

export interface AdversarialSummary {
  passages: number;
  passed: number;
  /**
   * Correctness failures: text the engine was required to keep and dropped,
   * text it was required not to emit and emitted, a semantic failure, or a
   * protected-content failure. docs/BENCHMARKS.md requires these to be zero.
   */
  hardSafetyFailures: number;
  /**
   * Passages where every attempt was rejected and the customer would receive
   * an error rather than a rewrite. Reported separately and deliberately NOT
   * folded into hardSafetyFailures: the spec asks for a retry-exhaustion
   * budget to be set after a baseline, and no baseline has set one.
   */
  retryExhaustion: number;
  results: AdversarialPassageResult[];
}

/**
 * Runs the adversarial set.
 *
 * Unlike runHumanizationBenchmark, a passage here can only pass by producing
 * output that satisfies a stated expectation. The release-set metric counts a
 * passage as passed when every DECLARED protected fact survives — and 28 of
 * the 100 release passages declare none, so they pass whatever the engine
 * emits, including emitting the input untouched.
 */
export async function runAdversarialBenchmark(
  passages: AdversarialPassage[],
  pipeline: HumanizationPipeline = new HumanizationPipeline(),
): Promise<AdversarialSummary> {
  const results: AdversarialPassageResult[] = [];

  for (const passage of passages) {
    const failures: AdversarialPassageResult["failures"] = [];
    try {
      const result = await pipeline.humanize({ text: passage.text, mode: passage.mode });

      for (const required of passage.expectation.mustPreserve ?? []) {
        if (!result.text.includes(required)) {
          failures.push({ kind: "lost-required-text", detail: `missing ${JSON.stringify(required)}` });
        }
      }
      for (const forbidden of passage.expectation.mustNotProduce ?? []) {
        if (result.text.includes(forbidden)) {
          failures.push({ kind: "produced-forbidden-text", detail: `produced ${JSON.stringify(forbidden)}` });
        }
      }
      for (const stale of passage.expectation.mustRemove ?? []) {
        if (result.text.includes(stale)) {
          failures.push({ kind: "failed-to-remove", detail: `left ${JSON.stringify(stale)} in place` });
        }
      }
      const changed = result.text !== passage.text;
      if (passage.expectation.outcome === "rewrite" && !changed) {
        failures.push({ kind: "no-op-on-text-that-needed-rewriting", detail: "output is identical to the input" });
      }
      if (passage.expectation.outcome === "preserve" && changed) {
        failures.push({ kind: "unnecessary-change", detail: "already-good text was edited" });
      }
      if (!result.verification.passed) {
        failures.push({ kind: "semantic-failure", detail: result.verification.issues.map((issue) => issue.kind).join(", ") || "verification failed" });
      }
      if (result.verification.protectedContentScore < 1) {
        failures.push({ kind: "protected-content-failure", detail: `score ${result.verification.protectedContentScore}` });
      }
    } catch (error) {
      const failure = error instanceof HumanizationFailedError ? error : undefined;
      failures.push({
        kind: "threw",
        detail: failure
          ? `no candidate passed the gates (${failure.evaluation?.failedThresholds.join(", ") || "verification"})`
          : error instanceof Error ? error.message : "unknown error",
      });
    }

    results.push({ id: passage.id, category: passage.category, passed: failures.length === 0, failures });
  }

  const hard = new Set<AdversarialFailureKind>(["lost-required-text", "produced-forbidden-text", "semantic-failure", "protected-content-failure"]);
  return {
    passages: results.length,
    passed: results.filter((result) => result.passed).length,
    hardSafetyFailures: results.filter((result) => result.failures.some((failure) => hard.has(failure.kind))).length,
    retryExhaustion: results.filter((result) => result.failures.some((failure) => failure.kind === "threw")).length,
    results,
  };
}
