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
import { resolveHumanizationProvider, type HumanizationProviderEnv } from "@/src/lib/humanization/provider-config";

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

export interface HumanizationRuntime {
  pipeline: HumanizationPipeline;
  /** Wall-clock budget for the whole request, including retries. */
  processingMs: number;
  provider: "deterministic" | "claude";
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
  const humanizationProvider = new ClaudeHumanizationProvider({
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
