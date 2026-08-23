import { analyzeWriting } from "./analysis";
import { DeterministicHumanizationProvider } from "./deterministic-provider";
import { DeterministicEvaluationProvider } from "./evaluation";
import { extractProtectedContent } from "./protected-content";
import { countWords } from "./text";
import type {
  EvaluationProvider,
  EvaluationResult,
  HumanizationConfig,
  HumanizationProvider,
  HumanizationResult,
  HumanizeInput,
  UsageMetrics,
  VerificationIssue,
  VerificationProvider,
  VerificationResult,
} from "./types";
import { DeterministicVerificationProvider } from "./verification";

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
    let previousFailures: VerificationIssue[] = [];
    let lastVerification: VerificationResult | undefined;
    let lastEvaluation: EvaluationResult | undefined;

    for (let attempt = 1; attempt <= this.config.maxRetries + 1; attempt += 1) {
      attemptedWords += wordCount;
      try {
        const rewrite = await this.humanizationProvider.rewrite({
          text: original,
          mode,
          protectedContent,
          analysis,
          attempt,
          previousFailures,
        });
        estimatedTokens += rewrite.estimatedTokens ?? 0;
        estimatedCostUsd += rewrite.estimatedCostUsd ?? 0;
        lastVerification = await this.verificationProvider.verify({ original, candidate: rewrite.text, protectedContent });
        const candidateAnalysis = analyzeWriting(rewrite.text);
        lastEvaluation = await this.evaluationProvider.evaluate(
          { original, candidate: rewrite.text, mode, originalAnalysis: analysis, candidateAnalysis, verification: lastVerification },
          this.config.thresholds,
        );

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
            },
            improvements: Math.max(0, analysis.issues.length - candidateAnalysis.issues.length),
          };
        }
        previousFailures = lastVerification.issues.length
          ? lastVerification.issues
          : lastEvaluation.failedThresholds.map((threshold) => ({ kind: "changed-meaning" as const, message: `Candidate missed the ${threshold} quality threshold.` }));
      } catch (error) {
        previousFailures = [{ kind: "changed-meaning", message: error instanceof Error ? error.message : "Rewrite provider failed." }];
      }
    }

    const attempts = this.config.maxRetries + 1;
    throw new HumanizationFailedError(
      "No candidate passed semantic verification and the configured quality thresholds.",
      {
        attemptedWords,
        successfulWords: 0,
        attempts,
        retries: Math.max(0, attempts - 1),
        latencyMs: Number((performance.now() - startedAt).toFixed(2)),
        estimatedTokens,
        estimatedCostUsd: Number(estimatedCostUsd.toFixed(8)),
      },
      lastVerification,
      lastEvaluation,
    );
  }
}

export function createHumanizationPipeline(dependencies?: HumanizationPipelineDependencies): HumanizationPipeline {
  return new HumanizationPipeline(dependencies);
}
