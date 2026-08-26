// Cheap model first, expensive model only when the cheap one failed.
//
// The rule this is built on: DO NOT GUESS which documents are hard. Word
// count does not predict difficulty — repairing fifty words of non-native
// grammar is harder than smoothing three hundred words of clean corporate
// prose — so a length heuristic sends the hard cases to the weak model and
// the easy ones to the expensive one, which is the opposite of the intent.
//
// Instead: attempt, verify, escalate. The cheap rung writes a candidate, the
// candidate is judged by the SAME gates the pipeline will judge it by, and a
// candidate that fails is thrown away and rewritten by the strong rung. The
// customer's guarantee is untouched because the same gate judges both models,
// and because the pipeline verifies the returned candidate again afterwards —
// this provider cannot promote anything past a check.
//
// What is NOT here, deliberately: a rule that skips the cheap attempt when
// the analysis reports many grammar issues, or when protected-content density
// is high. Both are plausible. Neither is measured. Shipping an unmeasured
// routing rule is how a router quietly starts sending everything to the
// expensive model while appearing to save money, so the rules wait for
// evidence from `npm run benchmark -- --provider=claude --model=...` per rung.
//
// This module must stay free of `cloudflare:workers`, `next/headers` and
// `next/navigation`.
import { analyzeWriting } from "./analysis";
import { ClaudeHumanizationProvider, type ClaudeMessagesClient, type ClaudeProviderOptions } from "./claude-provider";
import type { ClaudeModelId } from "./claude-pricing";
import { DeterministicEvaluationProvider } from "./evaluation";
import { DEFAULT_HUMANIZATION_CONFIG } from "./pipeline";
import { ProviderError } from "./provider-error";
import { normalizeForComparison } from "./text";
import type {
  EvaluationProvider,
  EvaluationThresholds,
  HumanizationProvider,
  ProviderUsage,
  RewriteRequest,
  RewriteResponse,
  VerificationProvider,
} from "./types";
import { DeterministicVerificationProvider } from "./verification";

/** Why the cheap rung's candidate was thrown away. Content-free by construction. */
export type EscalationReason =
  | "verification-failed"
  | "quality-below-threshold"
  | "no-op"
  | "provider-error";

export interface EscalationRecord {
  /** Model that produced the returned text. */
  resultModel: string;
  /** True when the cheap rung's candidate was discarded and paid for anyway. */
  escalated: boolean;
  reason?: EscalationReason;
}

export interface EscalatingClaudeProviderOptions extends Omit<ClaudeProviderOptions, "model" | "name"> {
  client: ClaudeMessagesClient;
  /**
   * [cheap, strong]. Exact model ids, never dated.
   *
   * The default pairing is a STARTING POINT, not a measured result: no API key
   * was available when this was written, so no benchmark has yet said whether
   * `claude-haiku-4-5` clears the gates often enough to be worth the escalated
   * double spend, or whether `claude-sonnet-5` is the better first rung.
   * Sweep both against the release and adversarial sets before enabling
   * routing in production, and set the ladder from that, not from this line.
   */
  ladder?: readonly [ClaudeModelId, ClaudeModelId];
  /**
   * The gates. Defaulted to the same implementations the pipeline defaults to,
   * so "did the cheap candidate pass" means exactly what it will mean when the
   * pipeline asks the same question a moment later. A caller that configures
   * the pipeline's gates must pass the same ones here or the two will disagree.
   */
  verificationProvider?: VerificationProvider;
  evaluationProvider?: EvaluationProvider;
  thresholds?: EvaluationThresholds;
  /** Observation hook for the benchmark. Never receives customer text. */
  onAttempt?: (record: EscalationRecord) => void;
}

const DEFAULT_LADDER: readonly [ClaudeModelId, ClaudeModelId] = ["claude-haiku-4-5", "claude-opus-5"];

export class EscalatingClaudeProvider implements HumanizationProvider {
  readonly name: string;
  private readonly cheap: ClaudeHumanizationProvider;
  private readonly strong: ClaudeHumanizationProvider;
  private readonly ladder: readonly [ClaudeModelId, ClaudeModelId];
  private readonly verification: VerificationProvider;
  private readonly evaluation: EvaluationProvider;
  private readonly thresholds: EvaluationThresholds;
  private readonly onAttempt?: (record: EscalationRecord) => void;

  constructor(options: EscalatingClaudeProviderOptions) {
    this.ladder = options.ladder ?? DEFAULT_LADDER;
    const rung = (model: ClaudeModelId) =>
      new ClaudeHumanizationProvider({
        client: options.client,
        model,
        name: `claude-${model}`,
        ...(options.effort ? { effort: options.effort } : {}),
        ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
      });
    this.cheap = rung(this.ladder[0]);
    this.strong = rung(this.ladder[1]);
    this.verification = options.verificationProvider ?? new DeterministicVerificationProvider();
    this.evaluation = options.evaluationProvider ?? new DeterministicEvaluationProvider();
    this.thresholds = options.thresholds ?? DEFAULT_HUMANIZATION_CONFIG.thresholds;
    this.onAttempt = options.onAttempt;
    this.name = `claude-routed(${this.ladder[0]}->${this.ladder[1]})`;
  }

  async rewrite(request: RewriteRequest): Promise<RewriteResponse> {
    const spent: ProviderUsage[] = [];

    let cheapCandidate: (RewriteResponse & { usage: ProviderUsage }) | undefined;
    let reason: EscalationReason | undefined;
    try {
      cheapCandidate = await this.cheap.rewrite(request);
      spent.push(cheapCandidate.usage);
      reason = await this.rejectionReason(request, cheapCandidate.text);
    } catch (error) {
      // A rejected request (a 400, a bad key, a refusal that survived the
      // server-side fallback chain) fails the same way on the other rung and
      // costs the same to find out. Only a transient failure is worth paying
      // the second model for.
      if (error instanceof ProviderError && !error.retryable) throw error;
      reason = "provider-error";
    }

    if (cheapCandidate && !reason) {
      this.onAttempt?.({ resultModel: cheapCandidate.usage.model ?? this.ladder[0], escalated: false });
      return { ...cheapCandidate, usage: spent, resultModel: cheapCandidate.usage.model ?? this.ladder[0] };
    }

    // Escalation. The cheap rung's tokens are still in `spent`: they were
    // bought and burned, and a ledger that dropped them would price an
    // escalated rewrite as though only one model ran.
    // If this throws, the cheap rung's tokens are lost from the ledger: the
    // pipeline only accumulates usage from a rewrite that RETURNED. That
    // under-reports spend on a failed request, which is a pre-existing shape
    // of the pipeline rather than something routing introduced — noted here
    // because routing makes it twice as expensive when it happens.
    const strongCandidate = await this.strong.rewrite(request);
    spent.push(strongCandidate.usage);
    const resultModel = strongCandidate.usage.model ?? this.ladder[1];
    this.onAttempt?.({ resultModel, escalated: true, reason });

    return {
      text: strongCandidate.text,
      estimatedTokens: spent.reduce((sum, entry) => sum + (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0), 0),
      estimatedCostUsd: spent.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0),
      usage: spent,
      resultModel,
    };
  }

  /**
   * Runs the pipeline's own gates against the cheap candidate.
   *
   * Deliberately the same classes, the same thresholds, and the same protected
   * spans the pipeline will use — not a cheaper approximation. A second,
   * weaker gate here would be a way to let a cheap candidate through that the
   * real gate would have rejected, which is the one thing routing must not do.
   * Both defaults are pure and local, so this costs nothing and calls nothing.
   */
  private async rejectionReason(request: RewriteRequest, candidate: string): Promise<EscalationReason | undefined> {
    const verification = await this.verification.verify({
      original: request.text,
      candidate,
      protectedContent: request.protectedContent,
      signal: request.signal,
    });
    if (!verification.passed) return "verification-failed";

    const candidateAnalysis = analyzeWriting(candidate);
    const evaluation = await this.evaluation.evaluate(
      {
        original: request.text,
        candidate,
        mode: request.mode,
        originalAnalysis: request.analysis,
        candidateAnalysis,
        verification,
        signal: request.signal,
      },
      this.thresholds,
    );
    if (!evaluation.passed) return "quality-below-threshold";

    // A model that hands back the input is not a rewrite the customer can be
    // sold, and the route treats that outcome as terminal. Escalating is the
    // one chance to turn it into something. Text that arrived with nothing
    // wrong with it is exempt: leaving good prose alone is correct, and
    // paying the expensive model to churn it would be the unnecessary-change
    // defect the adversarial set exists to catch.
    if (request.analysis.issues.length === 0) return undefined;
    if (normalizeForComparison(candidate) === normalizeForComparison(request.text)) return "no-op";
    if (candidateAnalysis.issues.length >= request.analysis.issues.length) return "no-op";
    return undefined;
  }
}
