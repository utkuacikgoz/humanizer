export type WritingMode = "natural" | "professional" | "academic" | "casual";

export type ProtectedContentKind =
  | "person"
  | "company"
  | "product"
  | "date"
  | "number"
  | "percentage"
  | "currency"
  | "quotation"
  | "citation"
  | "url"
  | "technical-term"
  | "code"
  | "reference";

export interface TextRange {
  start: number;
  end: number;
}

export interface ProtectedContent extends TextRange {
  id: string;
  kind: ProtectedContentKind;
  value: string;
  normalizedValue: string;
}

export type WritingIssueKind =
  | "repetitive-length"
  | "repetitive-opening"
  | "generic-transition"
  | "parallel-structure"
  | "unnecessary-summary"
  | "excessive-qualifier"
  | "corporate-filler"
  | "robotic-vocabulary"
  | "predictable-paragraph"
  | "redundant-explanation"
  | "unnatural-transition"
  | "excessive-exposition"
  | "generic-conclusion";

export interface WritingIssue extends TextRange {
  kind: WritingIssueKind;
  severity: "low" | "medium" | "high";
  message: string;
}

export interface RewriteTarget extends TextRange {
  text: string;
  issueKinds: WritingIssueKind[];
}

export interface WritingAnalysis {
  issues: WritingIssue[];
  targets: RewriteTarget[];
  sentenceCount: number;
  paragraphCount: number;
  averageSentenceWords: number;
}

export interface RewriteRequest {
  text: string;
  mode: WritingMode;
  protectedContent: ProtectedContent[];
  analysis: WritingAnalysis;
  attempt: number;
  previousFailures: VerificationIssue[];
  signal?: AbortSignal;
}

/**
 * What one provider call actually cost.
 *
 * The deterministic provider reports nothing here. A model provider reports
 * the split, which docs/BENCHMARKS.md requires ("Input/output/total tokens by
 * stage and retry") and which a single `estimatedTokens` number cannot carry:
 * input and output are priced differently, and a cached input token is priced
 * differently again.
 */
export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Input tokens served from a provider-side cache, when the provider reports them. */
  cachedInputTokens?: number;
  /**
   * Output tokens the model spent on internal reasoning, when the provider
   * reports them.
   *
   * Included in `outputTokens`, never additive to it — this says how much of
   * that total was thinking. It is broken out because it is the single
   * largest swing factor in what a rewrite costs: thinking bills at the
   * output rate, adaptive thinking is on by default on the current models,
   * and docs/BENCHMARKS.md's arithmetic turns entirely on this number.
   */
  thinkingTokens?: number;
  costUsd?: number;
  /** The model that served the call, for provenance on a stored job. */
  model?: string;
}

export interface RewriteResponse {
  text: string;
  estimatedTokens?: number;
  estimatedCostUsd?: number;
  /**
   * What the call cost.
   *
   * An array when ONE rewrite consumed more than one model — a cheap-first
   * router that escalated spent tokens on both rungs, and reporting only the
   * winner would under-report the bill for every escalated rewrite. The
   * pipeline sums whatever it is given, so a provider that makes exactly one
   * call keeps passing a single object.
   */
  usage?: ProviderUsage | ProviderUsage[];
  /**
   * The model whose output is in `text`, when a provider used more than one.
   *
   * Distinct from every model that ran: an escalated rewrite burned tokens on
   * a model whose candidate was thrown away, and "why was this rewrite worse"
   * is a question about the one that was kept.
   */
  resultModel?: string;
}

export interface HumanizationProvider {
  readonly name: string;
  rewrite(request: RewriteRequest): Promise<RewriteResponse>;
}

export type VerificationIssueKind =
  | "missing-protected-content"
  | "altered-quantity"
  | "citation-damage"
  | "removed-claim"
  | "new-claim"
  | "changed-meaning";

export interface VerificationIssue {
  kind: VerificationIssueKind;
  message: string;
  originalRange?: TextRange;
}

export interface VerificationRequest {
  original: string;
  candidate: string;
  protectedContent: ProtectedContent[];
  signal?: AbortSignal;
}

export interface VerificationResult {
  passed: boolean;
  semanticScore: number;
  protectedContentScore: number;
  issues: VerificationIssue[];
  /** Set when verification is itself a model call, so its cost is not invisible. */
  usage?: ProviderUsage;
}

export interface VerificationProvider {
  readonly name: string;
  verify(request: VerificationRequest): Promise<VerificationResult>;
}

export interface QualityScores {
  naturalness: number;
  readability: number;
  grammar: number;
  repetition: number;
  meaningPreservation: number;
  toneAdherence: number;
}

export interface EvaluationRequest {
  original: string;
  candidate: string;
  mode: WritingMode;
  originalAnalysis: WritingAnalysis;
  candidateAnalysis: WritingAnalysis;
  verification: VerificationResult;
  signal?: AbortSignal;
}

export interface EvaluationResult {
  passed: boolean;
  scores: QualityScores;
  failedThresholds: Array<keyof QualityScores>;
  /** Set when evaluation is itself a model call (LLM-as-judge triage). */
  usage?: ProviderUsage;
}

export interface EvaluationProvider {
  readonly name: string;
  evaluate(request: EvaluationRequest, thresholds: EvaluationThresholds): Promise<EvaluationResult>;
}

export type EvaluationThresholds = QualityScores;

export interface HumanizationConfig {
  maxRetries: number;
  maxInputCharacters: number;
  thresholds: EvaluationThresholds;
  /**
   * Deadline for a SINGLE provider call, in milliseconds. A caller's own
   * signal bounds the whole pipeline; this bounds one attempt, so a provider
   * that hangs cannot consume the entire request budget on attempt one.
   * Undefined means no per-attempt deadline, which is the deterministic
   * provider's situation and the historical behaviour.
   */
  providerTimeoutMs?: number;
}

export interface HumanizeInput {
  text: string;
  mode?: WritingMode;
  protectedTerms?: string[];
  signal?: AbortSignal;
}

export interface UsageMetrics {
  attemptedWords: number;
  successfulWords: number;
  attempts: number;
  retries: number;
  latencyMs: number;
  estimatedTokens: number;
  estimatedCostUsd: number;
  /** Provider-reported totals across every stage and retry. Zero until a provider reports them. */
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** The reasoning share of `outputTokens`. Zero when no provider reported it. */
  thinkingTokens: number;
  /** Provider-reported cost, as distinct from the estimate above. */
  providerCostUsd: number;
}

/** Which providers produced a result, recorded so a stored job stays attributable. */
export interface ProviderAttribution {
  humanization: string;
  verification: string;
  evaluation: string;
  /** Models reported by any stage, de-duplicated. */
  models: string[];
  /**
   * The model that produced the returned text, when the humanization provider
   * ran more than one. Undefined when there was nothing to choose between.
   */
  resultModel?: string;
}

export interface HumanizationResult {
  original: string;
  text: string;
  mode: WritingMode;
  protectedContent: ProtectedContent[];
  analysis: WritingAnalysis;
  verification: VerificationResult;
  evaluation: EvaluationResult;
  metrics: UsageMetrics;
  improvements: number;
  providers: ProviderAttribution;
}
