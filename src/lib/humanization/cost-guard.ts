// The control that stops a modelled cost table from becoming a silent loss.
//
// docs/BENCHMARKS.md carries an arithmetic model saying that, at roughly 1,500
// thinking tokens per rewrite, a full Starter allowance costs more in
// inference than Starter earns. A model is a prediction. This is the thing
// that notices when the prediction was wrong, in production, on the day it
// starts being wrong rather than at the end of the month.
//
// Two alarms, because there are two different failures:
//
//   * A SINGLE rewrite that costs more than its ceiling. Usually a runaway:
//     a document that provoked an enormous amount of thinking, a retry storm,
//     a router escalating both rungs at maximum effort.
//   * A SUSTAINED cost per word above what the cheapest plan can carry. No
//     individual rewrite looks wrong; the business is simply losing money on
//     every one of them. This is the failure a per-request ceiling cannot see
//     and the one that can run for a month unnoticed.
//
// Nothing here reads or logs customer text. An observation is a handful of
// numbers, a provider name and a model id.
//
// This module must stay free of `cloudflare:workers`, `next/headers` and
// `next/navigation`.

export interface RewriteCostObservation {
  /** Provider-reported cost for the whole rewrite, including retries and both router rungs. */
  costUsd: number;
  /** Successful words delivered. The denominator the plans are sold in. */
  words: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** The reasoning share of `outputTokens`. The largest swing factor in cost. */
  thinkingTokens: number;
  attempts: number;
  providerName: string;
  /** The model whose output was kept, when the provider ran more than one. */
  resultModel?: string;
}

export type CostAlarmKind = "per-rewrite-ceiling" | "sustained-cost-per-word";

export interface CostAlarm {
  kind: CostAlarmKind;
  /** The figure that breached, in dollars: per rewrite, or per word. */
  observedUsd: number;
  ceilingUsd: number;
  /** How many rewrites the figure is computed over. 1 for a per-rewrite breach. */
  sample: number;
  providerName: string;
  resultModel?: string;
}

export interface CostGuardThresholds {
  /**
   * Ceiling for one rewrite. A breach is a runaway, not a pricing problem.
   */
  maxCostPerRewriteUsd: number;
  /**
   * Ceiling for the rolling mean cost per successful word.
   *
   * Derived, not invented: it is a share of what the LEAST generous active
   * plan earns per word. Deriving it is the point — a hardcoded number goes
   * stale the moment a price or an allowance changes, and the failure it is
   * supposed to catch is exactly a price/allowance/cost mismatch.
   */
  maxCostPerWordUsd: number;
  /** Rewrites held in the rolling window. */
  windowSize?: number;
  /**
   * Rewrites required before the sustained alarm may fire. Three expensive
   * documents in a row are not a trend, and an alarm that cries on the first
   * one gets muted by whoever is on call.
   */
  minimumSample?: number;
  /**
   * Observations between repeats of a still-breaching sustained alarm. The
   * alarm fires on the way in and then at intervals; it does not log on every
   * rewrite for the rest of the month.
   */
  repeatEvery?: number;
}

export interface CostGuardSnapshot {
  rewrites: number;
  words: number;
  meanCostPerRewriteUsd: number;
  costPerWordUsd: number;
  costPer1000WordsUsd: number;
  /** Share of input tokens served from cache. Near zero means caching silently broke. */
  cachedInputShare: number;
  /**
   * Mean reasoning tokens per rewrite. The number to watch: it bills at the
   * output rate and it is what moves a plan from profitable to underwater.
   */
  meanThinkingTokens: number;
  meanAttempts: number;
  /** Rewrites that individually breached the per-rewrite ceiling. */
  perRewriteBreaches: number;
  /** True while the rolling mean is above the per-word ceiling. */
  sustainedBreach: boolean;
  thresholds: { maxCostPerRewriteUsd: number; maxCostPerWordUsd: number };
}

interface WindowEntry {
  costUsd: number;
  words: number;
  inputTokens: number;
  cachedInputTokens: number;
  thinkingTokens: number;
  attempts: number;
}

const DEFAULT_WINDOW = 200;
const DEFAULT_MINIMUM_SAMPLE = 25;
const DEFAULT_REPEAT_EVERY = 100;

/**
 * Derives the per-word ceiling from the plan catalogue.
 *
 * `targetGrossMargin` is the share of revenue that must survive inference
 * cost. At 0.5, the alarm fires when inference has eaten half of what the
 * cheapest-per-word plan earns — well before the plan is underwater, which is
 * the only useful time to find out.
 *
 * This reads prices; it never sets them. Which price, which allowance and
 * which margin the business wants are the owner's decisions
 * (docs/MONETIZATION.md).
 */
export function costCeilingFromPlans(
  plans: ReadonlyArray<{ monthlyPrice: number; wordLimit: number }>,
  targetGrossMargin = 0.5,
): number {
  const revenuePerWord = plans
    .filter((plan) => plan.wordLimit > 0 && plan.monthlyPrice > 0)
    .map((plan) => plan.monthlyPrice / plan.wordLimit);
  if (!revenuePerWord.length) return Number.POSITIVE_INFINITY;
  // The WORST plan sets the ceiling. A plan that sells four times the words
  // for twice the price earns less per word, and it is the one that goes
  // underwater first — averaging the plans together would hide it.
  return Math.min(...revenuePerWord) * (1 - targetGrossMargin);
}

export class RewriteCostGuard {
  private readonly window: WindowEntry[] = [];
  private readonly thresholds: Required<CostGuardThresholds>;
  private readonly onAlarm?: (alarm: CostAlarm) => void;
  private perRewriteBreaches = 0;
  private sustainedBreach = false;
  private sinceLastSustainedAlarm = 0;

  constructor(thresholds: CostGuardThresholds, onAlarm?: (alarm: CostAlarm) => void) {
    this.thresholds = {
      windowSize: DEFAULT_WINDOW,
      minimumSample: DEFAULT_MINIMUM_SAMPLE,
      repeatEvery: DEFAULT_REPEAT_EVERY,
      ...thresholds,
    };
    this.onAlarm = onAlarm;
  }

  /**
   * Records one completed rewrite and returns an alarm if it raised one.
   *
   * Only SUCCESSFUL rewrites belong here: a failed one debits no words, so it
   * has no denominator and would drag the per-word figure to infinity. Its
   * cost is real and is still worth watching, but not through this alarm.
   */
  record(observation: RewriteCostObservation): CostAlarm | undefined {
    this.window.push({
      costUsd: observation.costUsd,
      words: Math.max(0, observation.words),
      inputTokens: observation.inputTokens,
      cachedInputTokens: observation.cachedInputTokens,
      thinkingTokens: observation.thinkingTokens,
      attempts: observation.attempts,
    });
    if (this.window.length > this.thresholds.windowSize) this.window.shift();

    // SEC-27. BOTH checks evaluate on EVERY observation, and the sustained
    // one runs first so that a per-rewrite breach cannot skip it.
    //
    // The bug this replaces: the per-rewrite branch below used to `return`
    // before the sustained evaluation, so `sustainedBreach` stayed false for
    // exactly the runaway it exists to catch. Sixty rewrites at $5.00 each
    // reported `sustainedBreach: false` while a fifty-five-times cheaper
    // regime reported `true` — the economically worse state read clean.
    // `humanizationCostSnapshot()` and the spend budget both read that flag,
    // so a wrong value is a control that does not fire.
    const sustained = this.evaluateSustained(observation);

    if (observation.costUsd > this.thresholds.maxCostPerRewriteUsd) {
      this.perRewriteBreaches += 1;
      // A sustained alarm that came due on this same observation is still
      // logged; it is a different failure with a different response, and
      // swallowing it here would recreate the finding one level down. The
      // per-rewrite breach is the more specific verdict, so it is the one
      // returned to the caller.
      if (sustained) this.raise(sustained);
      return this.raise({
        kind: "per-rewrite-ceiling",
        observedUsd: observation.costUsd,
        ceilingUsd: this.thresholds.maxCostPerRewriteUsd,
        sample: 1,
        providerName: observation.providerName,
        ...(observation.resultModel ? { resultModel: observation.resultModel } : {}),
      });
    }

    return sustained ? this.raise(sustained) : undefined;
  }

  /**
   * Updates the sustained-breach state from the whole rolling window and
   * returns the alarm if this observation is one that should fire.
   *
   * Split out of `record()` so that the state transition happens exactly once
   * per observation regardless of which branch the caller takes afterwards.
   */
  private evaluateSustained(observation: RewriteCostObservation): CostAlarm | undefined {
    const snapshot = this.snapshot();
    const breaching =
      this.window.length >= this.thresholds.minimumSample &&
      snapshot.words > 0 &&
      snapshot.costPerWordUsd > this.thresholds.maxCostPerWordUsd;

    if (!breaching) {
      // Leaving the breach is silent on purpose. A recovery notification is a
      // second thing to page on and this alarm is about a trend, not an edge.
      this.sustainedBreach = false;
      this.sinceLastSustainedAlarm = 0;
      return undefined;
    }

    const entering = !this.sustainedBreach;
    this.sustainedBreach = true;
    this.sinceLastSustainedAlarm += 1;
    if (!entering && this.sinceLastSustainedAlarm < this.thresholds.repeatEvery) return undefined;
    this.sinceLastSustainedAlarm = 0;

    return {
      kind: "sustained-cost-per-word",
      observedUsd: snapshot.costPerWordUsd,
      ceilingUsd: this.thresholds.maxCostPerWordUsd,
      sample: this.window.length,
      providerName: observation.providerName,
      ...(observation.resultModel ? { resultModel: observation.resultModel } : {}),
    };
  }

  snapshot(): CostGuardSnapshot {
    const rewrites = this.window.length;
    const totals = this.window.reduce(
      (sum, entry) => ({
        cost: sum.cost + entry.costUsd,
        words: sum.words + entry.words,
        input: sum.input + entry.inputTokens,
        cached: sum.cached + entry.cachedInputTokens,
        thinking: sum.thinking + entry.thinkingTokens,
        attempts: sum.attempts + entry.attempts,
      }),
      { cost: 0, words: 0, input: 0, cached: 0, thinking: 0, attempts: 0 },
    );
    const costPerWordUsd = totals.words ? totals.cost / totals.words : 0;
    return {
      rewrites,
      words: totals.words,
      meanCostPerRewriteUsd: rewrites ? totals.cost / rewrites : 0,
      costPerWordUsd,
      costPer1000WordsUsd: costPerWordUsd * 1000,
      cachedInputShare: totals.input ? totals.cached / totals.input : 0,
      meanThinkingTokens: rewrites ? totals.thinking / rewrites : 0,
      meanAttempts: rewrites ? totals.attempts / rewrites : 0,
      perRewriteBreaches: this.perRewriteBreaches,
      sustainedBreach: this.sustainedBreach,
      thresholds: {
        maxCostPerRewriteUsd: this.thresholds.maxCostPerRewriteUsd,
        maxCostPerWordUsd: this.thresholds.maxCostPerWordUsd,
      },
    };
  }

  private raise(alarm: CostAlarm): CostAlarm {
    this.onAlarm?.(alarm);
    return alarm;
  }
}

/**
 * The one line an alarm is allowed to log.
 *
 * Numbers, a provider name and a model id. No document, no fingerprint, no
 * account. Built here rather than at the call site so there is exactly one
 * place to audit for a leak.
 */
export function formatCostAlarm(alarm: CostAlarm): string {
  const observed = alarm.observedUsd.toFixed(6);
  const ceiling = alarm.ceilingUsd.toFixed(6);
  const model = alarm.resultModel ?? "unreported";
  return alarm.kind === "per-rewrite-ceiling"
    ? `humanization cost alarm: one rewrite cost $${observed} against a $${ceiling} ceiling (provider=${alarm.providerName}, model=${model})`
    : `humanization cost alarm: cost per word is $${observed} against a $${ceiling} ceiling over ${alarm.sample} rewrites (provider=${alarm.providerName}, model=${model})`;
}
