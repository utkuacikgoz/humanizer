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

// ---------------------------------------------------------------------------
// SEC-26 — the disclosure, derived from the selection above.
//
// `/privacy` used to state in the present tense that no third-party AI
// provider receives customer text, and to name exactly three subprocessors.
// Setting HUMANIZATION_PROVIDER=claude made both sentences false with no code
// change, no gate and no test: one optional deploy variable stood between the
// deployment and a privacy notice that misrepresented where customer writing
// goes. The page's own promise — "we will update this page before that change
// takes effect" — was enforced by nothing but somebody's memory.
//
// So the claim is no longer written down next to the code. It is COMPUTED
// FROM the code, by the same `resolveHumanizationProvider` the pipeline calls,
// on the same environment. The page cannot say "nobody" while the runtime says
// "Anthropic", because one function answers both questions.
//
// What is written here is only what somebody can stand behind. docs/SECURITY.md's
// "Third-party AI disclosure principles" require the processor's identity,
// purpose, the categories of data sent, the hosting region, the retention
// period/settings, the training policy and how deletion propagates. Several of
// those are not established for this account — D-P05 is still Proposed and
// nobody has read the contract — so they are marked unconfirmed and the page
// says they are being confirmed. It does not invent a period, it does not
// claim zero retention, and it does not assert a compliance status.
// ---------------------------------------------------------------------------

export type ThirdPartyProviderName = Exclude<HumanizationProviderName, "deterministic">;

/**
 * One disclosable term.
 *
 * `confirmed: false` is a first-class state, not a missing value. A term
 * nobody has verified must reach the customer as "we are confirming this",
 * never as a plausible-sounding number.
 */
export interface ProcessorTerm {
  /** What the term is, in the customer's words. Plural-agnostic noun phrase. */
  label: string;
  /** Stated only when `confirmed`. Empty otherwise, deliberately. */
  statement: string;
  confirmed: boolean;
}

export interface HumanizationProcessor {
  provider: ThirdPartyProviderName;
  /** How the company must be named to a customer. */
  companyName: string;
  /** Its line in the subprocessor list. */
  role: string;
  /** The categories of text and data it receives. */
  receives: string;
  /** The categories it does not, stated because "everything" is the reader's default assumption. */
  doesNotReceive: string;
  region: ProcessorTerm;
  retention: ProcessorTerm;
  training: ProcessorTerm;
}

/**
 * The claim that may be made ONLY while no third-party processor is selected.
 *
 * Exported so that the coupling can be asserted from both ends: the page must
 * not contain this sentence except by rendering it from here, and this
 * sentence must not be produced while a metered provider is selectable.
 */
export const NO_THIRD_PARTY_AI_CLAIM =
  "Today your text is not sent to any third-party AI provider.";

/**
 * Every processor a `HumanizationProviderName` can put customer text in front
 * of.
 *
 * Keyed by the provider name, and typed as a total record over the non-
 * deterministic names, so adding a provider to the union without writing its
 * disclosure does not compile. That is the point: a provider is selectable and
 * disclosed in the same change, or it is neither.
 */
export const THIRD_PARTY_HUMANIZATION_PROCESSORS: Readonly<Record<ThirdPartyProviderName, HumanizationProcessor>> = {
  claude: {
    provider: "claude",
    companyName: "Anthropic",
    role: "runs the model that writes your rewrite",
    receives: "the text you paste, the writing mode you chose, and the instructions we send with it",
    doesNotReceive: "your email address, your account, your payment details, or anything else from your history",
    // None of these three are established. D-P05 in docs/DECISIONS.md is still
    // Proposed: nobody has recorded this account's retention setting, whether
    // zero-retention is even available on it, or what the contract says about
    // training. Writing a number here that nobody has read would be a worse
    // failure than the one this file exists to fix.
    region: { label: "where your text is processed", statement: "", confirmed: false },
    retention: { label: "how long it is kept", statement: "", confirmed: false },
    training: { label: "whether any of it is used to train models", statement: "", confirmed: false },
  },
};

export type HumanizationDisclosure =
  | { thirdParty: false; provider: "deterministic"; processors: readonly []; paragraphs: readonly string[] }
  | {
      thirdParty: true;
      provider: ThirdPartyProviderName;
      processors: readonly [HumanizationProcessor];
      paragraphs: readonly string[];
    };

function sentenceList(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function processorParagraphs(processor: HumanizationProcessor): readonly string[] {
  const terms = [processor.region, processor.retention, processor.training];
  const unconfirmed = terms.filter((term) => !term.confirmed);
  const confirmed = terms.filter((term) => term.confirmed);

  const paragraphs = [
    `Your text is sent to ${processor.companyName}, which ${processor.role}. ${processor.companyName} receives ` +
      `${processor.receives}, for the single purpose of producing the rewrite you asked for. It does not receive ` +
      `${processor.doesNotReceive}.`,
  ];

  if (confirmed.length) {
    paragraphs.push(
      `What we can state about ${processor.companyName}: ${sentenceList(confirmed.map((term) => term.statement))}`,
    );
  }

  if (unconfirmed.length) {
    // The honest shape of an unverified term: name it, say it is unverified,
    // and refuse to fill it in. Never a number nobody has read.
    paragraphs.push(
      `We are still confirming ${unconfirmed.length === 1 ? "one term" : "these terms"} with ` +
        `${processor.companyName}, under our own account: ${sentenceList(unconfirmed.map((term) => term.label))}. ` +
        `We have not verified them, so this page does not state them, and we will not describe them until we have. ` +
        `In particular we make no claim that ${processor.companyName} keeps your text for no time at all. When each ` +
        `is confirmed we will state it here and update the date at the top of this page.`,
    );
    paragraphs.push(
      `Deleting a rewrite from your history erases it from our systems at that moment. Whether deletion reaches ` +
        `${processor.companyName}'s own copy depends on the terms above, which is a further reason we will not ` +
        `describe them until they are confirmed.`,
    );
  }

  paragraphs.push(
    `If we change this provider, add another, or stop using one, we will name it here and update this page before ` +
      `that change takes effect.`,
  );
  return paragraphs;
}

/**
 * The disclosure for a given deployment's configuration.
 *
 * Takes the same environment `humanizationRuntime()` reads and asks
 * `resolveHumanizationProvider` the same question, so the notice and the
 * pipeline cannot disagree — including the fail-closed cases, where a
 * requested provider with no key resolves to the deterministic engine and no
 * customer text leaves the service, which is exactly what the page then says.
 *
 * Reads no secret: the API key on the resolved choice is never touched here.
 */
export function humanizationDisclosure(env: HumanizationProviderEnv | undefined): HumanizationDisclosure {
  const choice = resolveHumanizationProvider(env);
  if (choice.provider === "deterministic") {
    return {
      thirdParty: false,
      provider: "deterministic",
      processors: [],
      paragraphs: [
        `${NO_THIRD_PARTY_AI_CLAIM} Rewrites are produced by a deterministic engine that runs on our own ` +
          `infrastructure, so the text you paste stays within the service and no outside provider holds a copy of ` +
          `it or could train on it. If we later introduce a third-party model provider, we will name it here, ` +
          `state what it receives and its retention and training terms, and update this page before that change ` +
          `takes effect.`,
      ],
    };
  }
  const processor = THIRD_PARTY_HUMANIZATION_PROCESSORS[choice.provider];
  return {
    thirdParty: true,
    provider: choice.provider,
    processors: [processor],
    paragraphs: processorParagraphs(processor),
  };
}
