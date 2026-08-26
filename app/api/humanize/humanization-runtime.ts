// Chooses the humanization pipeline this runtime serves requests with.
//
// Everything that can only exist inside the Workers runtime is behind a lazy
// import, the same shape app/api/humanize/route.ts already uses for D1:
// `cloudflare:workers` does not resolve under plain Node, and a static import
// would crash tests/api.test.mts at module load.
//
// The Anthropic SDK is behind a lazy import for a second reason: the default
// path is deterministic, and a deployment that never selects the model
// provider should not pay to parse an SDK it never calls.
import { createHumanizationPipeline, type HumanizationPipeline } from "@/src/lib/humanization";
import {
  costCeilingFromPlans,
  formatCostAlarm,
  RewriteCostGuard,
  type CostGuardSnapshot,
} from "@/src/lib/humanization/cost-guard";
import { resolveHumanizationProvider, type HumanizationProviderEnv } from "@/src/lib/humanization/provider-config";
import { pricingConfig } from "@/src/config/pricing";

/**
 * Deterministic: no network call, so the historical five-second budget is a
 * generous one.
 */
const DETERMINISTIC_PROCESSING_MS = 5_000;

/**
 * Model-backed: a rewrite is a round trip to a metered API, and the pipeline
 * may take a second sample when the first fails verification. The per-attempt
 * deadline is what stops one hung call from eating the whole budget — the
 * pipeline enforces it (`providerTimeoutMs`) and the provider passes the
 * signal down to the SDK, so the socket really closes.
 *
 * These two numbers are a latency/UX decision as much as an engineering one:
 * a customer waiting this long needs to be told they are waiting. Flagged for
 * product sign-off rather than decided here.
 */
const MODEL_PROCESSING_MS = 45_000;
const MODEL_ATTEMPT_MS = 20_000;

/**
 * Ceiling for one rewrite.
 *
 * The route caps input at 300 words, and docs/BENCHMARKS.md's model puts a
 * 250-word Opus rewrite between $0.011 and $0.086 depending entirely on how
 * many thinking tokens it burns. Ten cents is above the top of that range, so
 * a breach means something is genuinely running away — maximum-effort
 * thinking, a retry storm, or a router paying for both rungs on every
 * attempt — rather than a normal expensive document.
 *
 * It is not a pricing threshold. The pricing threshold is the per-word one,
 * derived from the plan catalogue below.
 */
const MAX_COST_PER_REWRITE_USD = 0.1;

/**
 * How much of the cheapest-per-word plan's revenue inference may eat before
 * this is an operational problem. Half. Not a target margin the business has
 * agreed to — a level at which somebody should be told, chosen so the alarm
 * fires while there is still room to react rather than once the plan is
 * already underwater.
 */
const TARGET_GROSS_MARGIN = 0.5;

export interface HumanizationRuntime {
  pipeline: HumanizationPipeline;
  /** Wall-clock budget for the whole request, including retries. */
  processingMs: number;
  provider: "deterministic" | "claude";
  /**
   * Undefined on the deterministic provider, which costs nothing and so has
   * nothing to guard. Present means every successful rewrite is recorded.
   */
  costGuard?: RewriteCostGuard;
}

async function readEnv(): Promise<HumanizationProviderEnv | undefined> {
  try {
    const { env } = await import("cloudflare:workers");
    return env as unknown as HumanizationProviderEnv;
  } catch {
    // Plain Node (route-level tests) has no `cloudflare:workers` module, and
    // no configuration means the deterministic provider — which is exactly
    // what a test run should get.
    return undefined;
  }
}

let cached: Promise<HumanizationRuntime> | undefined;

async function build(maxInputCharacters: number): Promise<HumanizationRuntime> {
  const choice = resolveHumanizationProvider(await readEnv());

  // Derived from the catalogue, so a price or allowance change moves the
  // alarm with it. A hardcoded number would go stale against exactly the
  // change it exists to catch.
  const costGuard = new RewriteCostGuard(
    {
      maxCostPerRewriteUsd: MAX_COST_PER_REWRITE_USD,
      maxCostPerWordUsd: costCeilingFromPlans(Object.values(pricingConfig.plans), TARGET_GROSS_MARGIN),
    },
    // Content-free by construction: formatCostAlarm emits numbers, a provider
    // name and a model id, and is the only place that formats one.
    (alarm) => console.error(formatCostAlarm(alarm)),
  );

  if (choice.provider === "deterministic") {
    if (choice.reason === "missing-api-key" || choice.reason === "unknown-provider") {
      // Content-free by construction: a reason code and a variable name, never
      // a key and never customer text. Worth saying out loud — an operator who
      // believes a model is running while substitution-table output ships is
      // the failure mode this branch exists to make visible.
      console.error(`humanization provider misconfigured (${choice.reason}); serving the deterministic engine`);
    }
    return {
      pipeline: createHumanizationPipeline({ config: { maxInputCharacters } }),
      processingMs: DETERMINISTIC_PROCESSING_MS,
      provider: "deterministic",
    };
  }

  const { ClaudeHumanizationProvider, createAnthropicMessagesClient } = await import("@/src/lib/humanization/claude-provider");
  const client = createAnthropicMessagesClient({ apiKey: choice.apiKey, timeoutMs: MODEL_ATTEMPT_MS });
  // Routing is opt-in and there is always a single-model path: with
  // HUMANIZATION_MODEL_ROUTING unset, one model answers every request and no
  // escalation logic runs at all.
  const humanizationProvider = choice.routing
    ? new (await import("@/src/lib/humanization/escalating-provider")).EscalatingClaudeProvider({
        client,
        ...(choice.ladder ? { ladder: choice.ladder } : {}),
        ...(choice.effort ? { effort: choice.effort } : {}),
      })
    : new ClaudeHumanizationProvider({
        client,
        ...(choice.effort ? { effort: choice.effort } : {}),
      });

  return {
    pipeline: createHumanizationPipeline({
      humanizationProvider,
      config: { maxInputCharacters, providerTimeoutMs: MODEL_ATTEMPT_MS },
    }),
    processingMs: MODEL_PROCESSING_MS,
    provider: "claude",
    costGuard,
  };
}

/**
 * Resolved once per isolate. Provider selection is deployment configuration;
 * re-reading it per request would buy nothing and construct a new SDK client
 * on every rewrite.
 */
export function humanizationRuntime(maxInputCharacters: number): Promise<HumanizationRuntime> {
  cached ??= build(maxInputCharacters);
  return cached;
}

/**
 * The rolling cost picture for this isolate, for an operational view.
 *
 * docs/MONETIZATION.md requires privacy-safe observability, and this is the
 * unit-economics half of it: mean cost per rewrite, cost per word, the share
 * of input tokens served from cache (near zero means prompt caching silently
 * broke and the input bill roughly tripled), and whether either ceiling is
 * currently breached. Numbers only. Undefined when no model provider is
 * configured, because then there is nothing to spend.
 *
 * Per-isolate, so it is a live signal rather than an accounting record. The
 * durable one is job_attempts, which carries a row per succeeded rewrite with
 * the model, the tokens and the cost.
 */
export async function humanizationCostSnapshot(maxInputCharacters: number): Promise<CostGuardSnapshot | undefined> {
  return (await humanizationRuntime(maxInputCharacters)).costGuard?.snapshot();
}
