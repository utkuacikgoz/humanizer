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
}

export interface RewriteResponse {
  text: string;
  estimatedTokens?: number;
  estimatedCostUsd?: number;
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
}

export interface VerificationResult {
  passed: boolean;
  semanticScore: number;
  protectedContentScore: number;
  issues: VerificationIssue[];
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
}

export interface EvaluationResult {
  passed: boolean;
  scores: QualityScores;
  failedThresholds: Array<keyof QualityScores>;
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
}

export interface HumanizeInput {
  text: string;
  mode?: WritingMode;
  protectedTerms?: string[];
}

export interface UsageMetrics {
  attemptedWords: number;
  successfulWords: number;
  attempts: number;
  retries: number;
  latencyMs: number;
  estimatedTokens: number;
  estimatedCostUsd: number;
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
}
