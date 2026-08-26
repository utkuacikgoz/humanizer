import { analyzeWriting } from "./analysis";
import { DeterministicHumanizationProvider } from "./deterministic-provider";
import { DeterministicEvaluationProvider } from "./evaluation";
import { extractProtectedContent } from "./protected-content";
import { ProviderError } from "./provider-error";
import { countWords } from "./text";
import type {
  EvaluationProvider,
  EvaluationResult,
  HumanizationConfig,
  HumanizationProvider,
  HumanizationResult,
  HumanizeInput,
  ProviderUsage,
  UsageMetrics,
  VerificationIssue,
  VerificationProvider,
  VerificationResult,
} from "./types";
import { DeterministicVerificationProvider } from "./verification";

function awaitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Operation aborted.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

/**
 * Combines the caller's signal with a per-attempt deadline.
 *
 * The caller's signal bounds the whole request. Without this, a provider that
 * hangs on attempt one consumes the entire budget and the retries the config
 * paid for never happen.
 */
/**
 * The pipeline awaits on this signal rather than the caller's, so a provider
 * that never looks at the signal it was handed still cannot outlive the
 * deadline. When no deadline is configured this IS the caller's signal, which
 * is the deterministic provider's situation and the historical behaviour.
 */
function attemptSignal(signal: AbortSignal | undefined, timeoutMs: number | undefined): AbortSignal | undefined {
  if (!timeoutMs) return signal;
  const deadline = AbortSignal.timeout(timeoutMs);
  if (!signal) return deadline;
  return typeof AbortSignal.any === "function" ? AbortSignal.any([signal, deadline]) : signal;
}

/**
 * Bump when a change to extraction, analysis, rewrite, verification, or
 * evaluation logic could alter output for previously-generated jobs.
 * Persisted onto humanization_jobs so a stored job's provenance stays
 * reconstructible (see docs/ARCHITECTURE.md's "Configuration and secrets").
 */
export const PIPELINE_VERSION = 1;

export const DEFAULT_HUMANIZATION_CONFIG: Readonly<HumanizationConfig> = {
  maxRetries: 2,
  maxInputCharacters: 50_000,
  thresholds: {
    naturalness: 0.5,
    readability: 0.15,
    grammar: 0.8,
    repetition: 0.55,
    meaningPreservation: 0.72,
    toneAdherence: 0.65,
  },
};

export interface HumanizationPipelineDependencies {
  humanizationProvider?: HumanizationProvider;
  verificationProvider?: VerificationProvider;
  evaluationProvider?: EvaluationProvider;
  config?: Partial<Omit<HumanizationConfig, "thresholds">> & {
    thresholds?: Partial<HumanizationConfig["thresholds"]>;
  };
}

interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  thinkingTokens: number;
  providerCostUsd: number;
  models: Set<string>;
}

function accumulate(totals: UsageTotals, usage: ProviderUsage | ProviderUsage[] | undefined): void {
  if (!usage) return;
  // A rewrite that escalated from a cheap model to an expensive one reports
  // one entry per model. Summing them is the point: the customer's rewrite
  // consumed both, and a ledger that recorded only the winning call would
  // under-report every escalated request.
  if (Array.isArray(usage)) {
    for (const entry of usage) accumulate(totals, entry);
    return;
  }
  totals.inputTokens += usage.inputTokens ?? 0;
  totals.outputTokens += usage.outputTokens ?? 0;
  totals.cachedInputTokens += usage.cachedInputTokens ?? 0;
  totals.thinkingTokens += usage.thinkingTokens ?? 0;
  totals.providerCostUsd += usage.costUsd ?? 0;
  if (usage.model) totals.models.add(usage.model);
}

export class HumanizationFailedError extends Error {
  readonly metrics: UsageMetrics;
  readonly verification?: VerificationResult;
  readonly evaluation?: EvaluationResult;

  constructor(message: string, metrics: UsageMetrics, verification?: VerificationResult, evaluation?: EvaluationResult) {
    super(message);
    this.name = "HumanizationFailedError";
    this.metrics = metrics;
    this.verification = verification;
    this.evaluation = evaluation;
  }
}

export class HumanizationPipeline {
  private readonly humanizationProvider: HumanizationProvider;
  private readonly verificationProvider: VerificationProvider;
  private readonly evaluationProvider: EvaluationProvider;
  private readonly config: HumanizationConfig;

  constructor(dependencies: HumanizationPipelineDependencies = {}) {
    this.humanizationProvider = dependencies.humanizationProvider ?? new DeterministicHumanizationProvider();
    this.verificationProvider = dependencies.verificationProvider ?? new DeterministicVerificationProvider();
    this.evaluationProvider = dependencies.evaluationProvider ?? new DeterministicEvaluationProvider();
    this.config = {
      ...DEFAULT_HUMANIZATION_CONFIG,
      ...dependencies.config,
      thresholds: {
        ...DEFAULT_HUMANIZATION_CONFIG.thresholds,
        ...dependencies.config?.thresholds,
      },
    };
    if (!Number.isInteger(this.config.maxRetries) || this.config.maxRetries < 0) {
      throw new RangeError("maxRetries must be a non-negative integer.");
    }
  }

  async humanize(input: HumanizeInput): Promise<HumanizationResult> {
    input.signal?.throwIfAborted();
    const original = input.text.trim();
    if (!original) throw new TypeError("Text is required.");
    if (original.length > this.config.maxInputCharacters) {
      throw new RangeError(`Text exceeds the ${this.config.maxInputCharacters}-character limit.`);
    }

    const startedAt = performance.now();
    const wordCount = countWords(original);
    const mode = input.mode ?? "natural";
    const protectedContent = extractProtectedContent(original, input.protectedTerms);
    const analysis = analyzeWriting(original);
    let attemptedWords = 0;
    let estimatedTokens = 0;
    let estimatedCostUsd = 0;
    const totals: UsageTotals = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, thinkingTokens: 0, providerCostUsd: 0, models: new Set() };
    let previousFailures: VerificationIssue[] = [];
    let lastVerification: VerificationResult | undefined;
    let lastEvaluation: EvaluationResult | undefined;

    for (let attempt = 1; attempt <= this.config.maxRetries + 1; attempt += 1) {
      attemptedWords += wordCount;
      try {
        const callSignal = attemptSignal(input.signal, this.config.providerTimeoutMs);
        const rewrite = await awaitWithSignal(this.humanizationProvider.rewrite({
          text: original,
          mode,
          protectedContent,
          analysis,
          attempt,
          previousFailures,
          signal: callSignal,
        }), callSignal);
        input.signal?.throwIfAborted();
        estimatedTokens += rewrite.estimatedTokens ?? 0;
        estimatedCostUsd += rewrite.estimatedCostUsd ?? 0;
        accumulate(totals, rewrite.usage);
        lastVerification = await awaitWithSignal(
          this.verificationProvider.verify({ original, candidate: rewrite.text, protectedContent, signal: callSignal }),
          callSignal,
        );
        input.signal?.throwIfAborted();
        accumulate(totals, lastVerification.usage);
        const candidateAnalysis = analyzeWriting(rewrite.text);
        lastEvaluation = await awaitWithSignal(this.evaluationProvider.evaluate(
          { original, candidate: rewrite.text, mode, originalAnalysis: analysis, candidateAnalysis, verification: lastVerification, signal: callSignal },
          this.config.thresholds,
        ), callSignal);
        accumulate(totals, lastEvaluation.usage);

        if (lastVerification.passed && lastEvaluation.passed) {
          return {
            original,
            text: rewrite.text,
            mode,
            protectedContent,
            analysis,
            verification: lastVerification,
            evaluation: lastEvaluation,
            metrics: {
              attemptedWords,
              successfulWords: wordCount,
              attempts: attempt,
              retries: attempt - 1,
              latencyMs: Number((performance.now() - startedAt).toFixed(2)),
              estimatedTokens,
              estimatedCostUsd: Number(estimatedCostUsd.toFixed(8)),
              inputTokens: totals.inputTokens,
              outputTokens: totals.outputTokens,
              cachedInputTokens: totals.cachedInputTokens,
              thinkingTokens: totals.thinkingTokens,
              providerCostUsd: Number(totals.providerCostUsd.toFixed(8)),
            },
            improvements: Math.max(0, analysis.issues.length - candidateAnalysis.issues.length),
            providers: {
              humanization: this.humanizationProvider.name,
              verification: this.verificationProvider.name,
              evaluation: this.evaluationProvider.name,
              models: [...totals.models],
              ...(rewrite.resultModel ? { resultModel: rewrite.resultModel } : {}),
            },
          };
        }
        previousFailures = lastVerification.issues.length
          ? lastVerification.issues
          : lastEvaluation.failedThresholds.map((threshold) => ({ kind: "changed-meaning" as const, message: `Candidate missed the ${threshold} quality threshold.` }));
      } catch (error) {
        if (input.signal?.aborted) throw error;
        // A candidate that failed verification is worth another sample. A
        // provider that rejected the request outright is not: retrying a 400
        // or a refusal buys the same answer at the same price. Only a
        // ProviderError can say which it is, so anything else keeps the
        // historical retry behaviour.
        if (error instanceof ProviderError && !error.retryable) {
          throw new HumanizationFailedError(
            `The ${this.humanizationProvider.name} provider rejected the request (${error.kind}).`,
            this.usageMetrics(attemptedWords, attempt, startedAt, estimatedTokens, estimatedCostUsd, totals),
            lastVerification,
            lastEvaluation,
          );
        }
        previousFailures = [{ kind: "changed-meaning", message: error instanceof Error ? error.message : "Rewrite provider failed." }];
      }
    }

    const attempts = this.config.maxRetries + 1;
    throw new HumanizationFailedError(
      "No candidate passed semantic verification and the configured quality thresholds.",
      this.usageMetrics(attemptedWords, attempts, startedAt, estimatedTokens, estimatedCostUsd, totals),
      lastVerification,
      lastEvaluation,
    );
  }

  private usageMetrics(
    attemptedWords: number,
    attempts: number,
    startedAt: number,
    estimatedTokens: number,
    estimatedCostUsd: number,
    totals: UsageTotals,
  ): UsageMetrics {
    return {
      attemptedWords,
      successfulWords: 0,
      attempts,
      retries: Math.max(0, attempts - 1),
      latencyMs: Number((performance.now() - startedAt).toFixed(2)),
      estimatedTokens,
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(8)),
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cachedInputTokens: totals.cachedInputTokens,
      thinkingTokens: totals.thinkingTokens,
      providerCostUsd: Number(totals.providerCostUsd.toFixed(8)),
    };
  }
}

export function createHumanizationPipeline(dependencies?: HumanizationPipelineDependencies): HumanizationPipeline {
  return new HumanizationPipeline(dependencies);
}
