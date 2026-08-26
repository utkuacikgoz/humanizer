// Which humanization provider a runtime uses.
//
// Selection is EXPLICIT configuration, never inference. A deployment that has
// an API key sitting in its environment for some other reason does not get
// silently switched onto a metered provider, and a test run never does: with
// no configuration at all this resolves to the deterministic provider, which
// is why the whole suite runs without a key.
//
// Pure module — no SDK import, no `cloudflare:workers` — so the decision can
// be unit-tested directly. The model-id union is a type-only import, so
// nothing here pulls the SDK in.
import type { ClaudeModelId } from "./claude-pricing";

export type HumanizationProviderName = "deterministic" | "claude";

export interface HumanizationProviderEnv {
  /** "deterministic" (default) or "claude". */
  HUMANIZATION_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  /** "on" routes cheap-model-first with escalation. Anything else, including unset, is single-model. */
  HUMANIZATION_MODEL_ROUTING?: string;
  /** Comma-separated "cheap,strong" ladder. Only read when routing is on. */
  HUMANIZATION_MODEL_LADDER?: string;
  /** Depth control passed through to the model: low | medium | high | xhigh | max. */
  HUMANIZATION_EFFORT?: string;
}

export type HumanizationProviderChoice =
  | { provider: "deterministic"; reason?: "not-configured" | "missing-api-key" | "unknown-provider" }
  | {
      provider: "claude";
      apiKey: string;
      /** True only when routing was explicitly turned on. Single-model is the default path. */
      routing: boolean;
      ladder?: readonly [ClaudeModelId, ClaudeModelId];
      effort?: "low" | "medium" | "high" | "xhigh" | "max";
    };

const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const MODELS = new Set<string>(["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"]);

/**
 * Parses "cheap,strong".
 *
 * An unrecognised or malformed ladder resolves to undefined, which leaves the
 * router on its documented default rather than sending traffic to a model id
 * that may not exist. A typo in configuration must not become a 404 on every
 * rewrite.
 */
function parseLadder(value: string | undefined): readonly [ClaudeModelId, ClaudeModelId] | undefined {
  const parts = (value ?? "").split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
  if (parts.length !== 2) return undefined;
  if (!parts.every((part) => MODELS.has(part))) return undefined;
  if (parts[0] === parts[1]) return undefined;
  return [parts[0] as ClaudeModelId, parts[1] as ClaudeModelId];
}

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
  const routing = normalize(env?.HUMANIZATION_MODEL_ROUTING) === "on";
  const ladder = routing ? parseLadder(env?.HUMANIZATION_MODEL_LADDER) : undefined;
  return {
    provider: "claude",
    apiKey,
    routing,
    ...(ladder ? { ladder } : {}),
    ...(EFFORTS.has(effort) ? { effort: effort as "low" | "medium" | "high" | "xhigh" | "max" } : {}),
  };
}
