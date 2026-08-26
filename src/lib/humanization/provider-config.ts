// Which humanization provider a runtime uses.
//
// Selection is EXPLICIT configuration, never inference. A deployment that has
// an API key sitting in its environment for some other reason does not get
// silently switched onto a metered provider, and a test run never does: with
// no configuration at all this resolves to the deterministic provider, which
// is why the whole suite runs without a key.
//
// Pure module — no SDK import, no `cloudflare:workers` — so the decision can
// be unit-tested directly.

export type HumanizationProviderName = "deterministic" | "claude";

export interface HumanizationProviderEnv {
  /** "deterministic" (default) or "claude". */
  HUMANIZATION_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  /** Depth control passed through to the model: low | medium | high | xhigh | max. */
  HUMANIZATION_EFFORT?: string;
}

export type HumanizationProviderChoice =
  | { provider: "deterministic"; reason?: "not-configured" | "missing-api-key" | "unknown-provider" }
  | {
      provider: "claude";
      apiKey: string;
      effort?: "low" | "medium" | "high" | "xhigh" | "max";
    };

const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Resolves the configured provider, failing closed to deterministic.
 *
 * "Claude requested but no key" resolves to deterministic WITH a reason, so
 * the caller can log a content-free warning. Silently serving substitution-table
 * output while the operator believes a model is running is the failure mode
 * worth naming out loud; crashing the request path is not the answer either,
 * since the deterministic engine still produces a valid, verified rewrite.
 */
export function resolveHumanizationProvider(env: HumanizationProviderEnv | undefined): HumanizationProviderChoice {
  const requested = normalize(env?.HUMANIZATION_PROVIDER);
  if (!requested || requested === "deterministic") {
    return { provider: "deterministic", reason: requested ? undefined : "not-configured" };
  }
  if (requested !== "claude") return { provider: "deterministic", reason: "unknown-provider" };

  const apiKey = (env?.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey) return { provider: "deterministic", reason: "missing-api-key" };

  const effort = normalize(env?.HUMANIZATION_EFFORT);
  return {
    provider: "claude",
    apiKey,
    ...(EFFORTS.has(effort) ? { effort: effort as "low" | "medium" | "high" | "xhigh" | "max" } : {}),
  };
}
