// Cheap-model-first routing with escalation, against injected fakes.
//
// No network, no API key. Every model call in this file is a canned reply
// from a queue, and the assertions are about which rung ran, what it cost,
// and what the customer was allowed to receive.
import assert from "node:assert/strict";
import test from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";

import { jobAttempts } from "../db/schema";
import { persistHumanizationJob } from "../db/repository";
import { createTestDatabase } from "./helpers/sqlite-db.mjs";

import type { ClaudeMessagesClient } from "../src/lib/humanization/claude-provider";
import { EscalatingClaudeProvider, type EscalationRecord } from "../src/lib/humanization/escalating-provider";
import { resolveHumanizationProvider } from "../src/lib/humanization/provider-config";
import { createHumanizationPipeline, extractProtectedContent, HumanizationFailedError, analyzeWriting, ProviderError } from "../src/lib/humanization/index";
import type { RewriteRequest } from "../src/lib/humanization/types";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Reply = Anthropic.Beta.Messages.BetaMessage;

function reply(rewrite: string, model: string, tokens = { input: 100, output: 100 }): Reply {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model,
    container: null,
    context_management: null,
    diagnostics: null,
    content: [{ type: "text", text: JSON.stringify({ rewrite }), citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: {
      input_tokens: tokens.input,
      output_tokens: tokens.output,
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: 500,
      inference_geo: null,
      iterations: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
      speed: null,
    } as Reply["usage"],
  } as Reply;
}

/** Answers per requested model, so a test says what each rung returns. */
function clientByModel(answers: Record<string, Reply | Error>): ClaudeMessagesClient & { models: string[] } {
  const models: string[] = [];
  return {
    models,
    async create(params: Params) {
      models.push(params.model);
      const answer = answers[params.model];
      if (!answer) throw new Error(`no canned answer for ${params.model}`);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

// A passage with filler the analysis reports, a protected number, and enough
// content for the verifier to measure coverage against.
const ORIGINAL =
  "Furthermore, it is important to note that the pilot covered 42 clinics. In addition, the team reported that waiting times fell across every site during the trial period.";
const GOOD = "The pilot covered 42 clinics. Waiting times fell across every site during the trial.";
const LOSES_THE_NUMBER = "The pilot covered dozens of clinics. Waiting times fell everywhere during the trial.";

function request(overrides: Partial<RewriteRequest> = {}): RewriteRequest {
  return {
    text: ORIGINAL,
    mode: "professional",
    protectedContent: extractProtectedContent(ORIGINAL),
    analysis: analyzeWriting(ORIGINAL),
    attempt: 1,
    previousFailures: [],
    ...overrides,
  };
}

test("a cheap candidate that clears the gates is returned, and the strong model is never called", async () => {
  const client = clientByModel({ "claude-haiku-4-5": reply(GOOD, "claude-haiku-4-5") });
  const records: EscalationRecord[] = [];
  const provider = new EscalatingClaudeProvider({ client, onAttempt: (record) => records.push(record) });

  const result = await provider.rewrite(request());

  assert.deepEqual(client.models, ["claude-haiku-4-5"], "the whole point is not paying for the second rung");
  assert.equal(result.text, GOOD);
  assert.equal(result.resultModel, "claude-haiku-4-5");
  assert.deepEqual(records, [{ resultModel: "claude-haiku-4-5", escalated: false }]);
});

test("a cheap candidate that fails verification is discarded and the strong model rewrites it", async () => {
  const client = clientByModel({
    "claude-haiku-4-5": reply(LOSES_THE_NUMBER, "claude-haiku-4-5"),
    "claude-opus-5": reply(GOOD, "claude-opus-5"),
  });
  const records: EscalationRecord[] = [];
  const provider = new EscalatingClaudeProvider({ client, onAttempt: (record) => records.push(record) });

  const result = await provider.rewrite(request());

  assert.deepEqual(client.models, ["claude-haiku-4-5", "claude-opus-5"]);
  assert.equal(result.text, GOOD);
  assert.equal(result.resultModel, "claude-opus-5");
  assert.deepEqual(records, [{ resultModel: "claude-opus-5", escalated: true, reason: "verification-failed" }]);
});

test("escalation reuses the pipeline's gate rather than a second, weaker one", async () => {
  // The proof: hand the router a verifier that rejects everything, and it
  // escalates even on a candidate the default gate would have passed. The
  // decision is the gate's, not a private approximation of it.
  const client = clientByModel({
    "claude-haiku-4-5": reply(GOOD, "claude-haiku-4-5"),
    "claude-opus-5": reply(GOOD, "claude-opus-5"),
  });
  const provider = new EscalatingClaudeProvider({
    client,
    verificationProvider: {
      name: "always-rejects",
      async verify() {
        return { passed: false, semanticScore: 0, protectedContentScore: 0, issues: [] };
      },
    },
  });
  await provider.rewrite(request());
  assert.deepEqual(client.models, ["claude-haiku-4-5", "claude-opus-5"]);
});

test("a cheap model that hands back the input escalates instead of selling a no-op", async () => {
  const client = clientByModel({
    "claude-haiku-4-5": reply(ORIGINAL, "claude-haiku-4-5"),
    "claude-opus-5": reply(GOOD, "claude-opus-5"),
  });
  const records: EscalationRecord[] = [];
  const provider = new EscalatingClaudeProvider({ client, onAttempt: (record) => records.push(record) });

  const result = await provider.rewrite(request());
  assert.equal(result.resultModel, "claude-opus-5");
  assert.equal(records[0].reason, "no-op");
});

test("already-good text is not escalated just because the cheap model left it alone", async () => {
  // The unnecessary-change defect the adversarial set exists to catch. Text
  // with nothing wrong with it should not be churned by an expensive model.
  const clean = "The pilot covered 42 clinics. Waiting times fell at every site, and the team says the trial will run for another year before anyone decides what to do next.";
  const client = clientByModel({ "claude-haiku-4-5": reply(clean, "claude-haiku-4-5") });
  const provider = new EscalatingClaudeProvider({ client });

  const result = await provider.rewrite(request({ text: clean, protectedContent: extractProtectedContent(clean), analysis: analyzeWriting(clean) }));
  assert.deepEqual(client.models, ["claude-haiku-4-5"]);
  assert.equal(result.text, clean);
});

test("an escalated rewrite bills for both models, with the cached split intact", async () => {
  const client = clientByModel({
    "claude-haiku-4-5": reply(LOSES_THE_NUMBER, "claude-haiku-4-5", { input: 1000, output: 1000 }),
    "claude-opus-5": reply(GOOD, "claude-opus-5", { input: 1000, output: 1000 }),
  });
  const result = await createHumanizationPipeline({
    humanizationProvider: new EscalatingClaudeProvider({ client }),
  }).humanize({ text: ORIGINAL });

  // 1000 fresh + 500 cached, twice.
  assert.equal(result.metrics.inputTokens, 3000);
  assert.equal(result.metrics.outputTokens, 2000);
  assert.equal(result.metrics.cachedInputTokens, 1000);
  // haiku: 1000@$1 + 500@$0.10 + 1000@$5 = 0.00605
  // opus:  1000@$5 + 500@$0.50 + 1000@$25 = 0.03025
  assert.equal(result.metrics.providerCostUsd, 0.0363);
  assert.deepEqual(result.providers.models.sort(), ["claude-haiku-4-5", "claude-opus-5"]);
});

test("attribution names the model that produced the returned text, not merely the ones that ran", async () => {
  const client = clientByModel({
    "claude-haiku-4-5": reply(LOSES_THE_NUMBER, "claude-haiku-4-5"),
    "claude-opus-5": reply(GOOD, "claude-opus-5"),
  });
  const result = await createHumanizationPipeline({
    humanizationProvider: new EscalatingClaudeProvider({ client }),
  }).humanize({ text: ORIGINAL });

  assert.equal(result.providers.resultModel, "claude-opus-5", "'why was this rewrite worse' is a question about the kept candidate");
  assert.equal(result.providers.humanization, "claude-routed(claude-haiku-4-5->claude-opus-5)");
});

test("a transient cheap-rung failure escalates; a rejected request does not pay twice", async () => {
  const transient = clientByModel({
    "claude-haiku-4-5": new Anthropic.InternalServerError(500, undefined, "boom", new Headers()),
    "claude-opus-5": reply(GOOD, "claude-opus-5"),
  });
  const escalated = await new EscalatingClaudeProvider({ client: transient }).rewrite(request());
  assert.equal(escalated.resultModel, "claude-opus-5");

  const rejected = clientByModel({
    "claude-haiku-4-5": new Anthropic.BadRequestError(400, undefined, "bad", new Headers()),
    "claude-opus-5": reply(GOOD, "claude-opus-5"),
  });
  await assert.rejects(
    new EscalatingClaudeProvider({ client: rejected }).rewrite(request()),
    (error: unknown) => error instanceof ProviderError && error.kind === "invalid-request",
  );
  assert.deepEqual(rejected.models, ["claude-haiku-4-5"], "a 400 fails the same way on the other rung");
});

test("routing cannot promote a candidate past the pipeline's gate", async () => {
  // Both rungs lose the protected number. Escalation is not a way to get a
  // bad candidate accepted — the pipeline still rejects it and charges zero.
  const client = clientByModel({
    "claude-haiku-4-5": reply(LOSES_THE_NUMBER, "claude-haiku-4-5"),
    "claude-opus-5": reply(LOSES_THE_NUMBER, "claude-opus-5"),
  });
  const pipeline = createHumanizationPipeline({
    humanizationProvider: new EscalatingClaudeProvider({ client }),
    config: { maxRetries: 0 },
  });
  await assert.rejects(pipeline.humanize({ text: ORIGINAL }), (error: unknown) => {
    assert.ok(error instanceof HumanizationFailedError);
    assert.equal(error.verification?.passed, false);
    assert.equal(error.metrics.successfulWords, 0, "a failed rewrite debits nothing, however many models ran");
    return true;
  });
});

test("quota debits successful words once, not once per model that ran", async () => {
  const client = clientByModel({
    "claude-haiku-4-5": reply(LOSES_THE_NUMBER, "claude-haiku-4-5"),
    "claude-opus-5": reply(GOOD, "claude-opus-5"),
  });
  const result = await createHumanizationPipeline({
    humanizationProvider: new EscalatingClaudeProvider({ client }),
  }).humanize({ text: ORIGINAL });

  assert.equal(result.metrics.successfulWords, ORIGINAL.trim().split(/\s+/).length);
  assert.equal(result.metrics.attempts, 1, "escalation happens inside one pipeline attempt");
});

test("the ladder is configurable and the rungs are exactly what was asked for", async () => {
  const client = clientByModel({
    "claude-sonnet-5": reply(LOSES_THE_NUMBER, "claude-sonnet-5"),
    "claude-opus-5": reply(GOOD, "claude-opus-5"),
  });
  const provider = new EscalatingClaudeProvider({ client, ladder: ["claude-sonnet-5", "claude-opus-5"] });
  assert.equal(provider.name, "claude-routed(claude-sonnet-5->claude-opus-5)");
  await provider.rewrite(request());
  assert.deepEqual(client.models, ["claude-sonnet-5", "claude-opus-5"]);
});

test("routing is opt-in, and single-model is the path when it is not asked for", () => {
  const single = resolveHumanizationProvider({ HUMANIZATION_PROVIDER: "claude", ANTHROPIC_API_KEY: "k" });
  assert.deepEqual(single, { provider: "claude", apiKey: "k", routing: false });

  const routed = resolveHumanizationProvider({
    HUMANIZATION_PROVIDER: "claude",
    ANTHROPIC_API_KEY: "k",
    HUMANIZATION_MODEL_ROUTING: "on",
    HUMANIZATION_MODEL_LADDER: "claude-sonnet-5, claude-opus-5",
  });
  assert.deepEqual(routed, { provider: "claude", apiKey: "k", routing: true, ladder: ["claude-sonnet-5", "claude-opus-5"] });
});

test("a malformed ladder falls back to the documented default instead of a model id that may not exist", () => {
  for (const ladder of ["", "claude-opus-5", "gpt-4,claude-opus-5", "claude-opus-5,claude-opus-5", "a,b,c"]) {
    const choice = resolveHumanizationProvider({
      HUMANIZATION_PROVIDER: "claude",
      ANTHROPIC_API_KEY: "k",
      HUMANIZATION_MODEL_ROUTING: "on",
      HUMANIZATION_MODEL_LADDER: ladder,
    });
    assert.deepEqual(choice, { provider: "claude", apiKey: "k", routing: true }, `ladder ${JSON.stringify(ladder)}`);
  }
});

test("the ladder is ignored entirely when routing is off", () => {
  const choice = resolveHumanizationProvider({
    HUMANIZATION_PROVIDER: "claude",
    ANTHROPIC_API_KEY: "k",
    HUMANIZATION_MODEL_LADDER: "claude-sonnet-5,claude-opus-5",
  });
  assert.deepEqual(choice, { provider: "claude", apiKey: "k", routing: false });
});

test("the model that produced a rewrite outlives the request", async () => {
  // Without this the answer to "why was this rewrite worse" disappears the
  // moment the response is sent. job_attempts was reserved for exactly this
  // and had never been written.
  const db = await createTestDatabase();
  const persisted = await persistHumanizationJob(db, {
    mode: "natural",
    clientFingerprint: "hashed-client-fingerprint",
    idempotencyKey: crypto.randomUUID(),
    contentFingerprint: "hashed-content-fingerprint",
    inputWordCount: 40,
    successfulWordCount: 40,
    pipelineVersion: 1,
    original: "The original text.",
    result: "The rewritten text.",
    protectedContent: [],
    previewProjection: {
      preview: "The rewritten",
      hiddenWordCount: 2,
      issuesImproved: 1,
      naturalness: "Strong",
      meaningPreservation: "High",
      protectedItems: [],
    },
    attribution: {
      providerName: "claude-routed(claude-haiku-4-5->claude-opus-5)",
      resultModel: "claude-opus-5",
      attempts: 1,
      inputTokens: 3000,
      outputTokens: 2000,
      cachedInputTokens: 1000,
      costUsd: 0.0363,
      latencyMs: 4210.5,
    },
  });

  const [row] = await db.select().from(jobAttempts).where(eq(jobAttempts.jobId, persisted.jobId));
  assert.equal(row.stage, "rewrite");
  assert.equal(row.status, "succeeded");
  assert.equal(row.providerName, "claude-routed(claude-haiku-4-5->claude-opus-5)");
  assert.equal(row.providerModel, "claude-opus-5", "the rung that won, not merely a rung that ran");
  assert.equal(row.tokensUsed, 5000);
  assert.equal(row.costUsd, 0.0363);
  assert.equal(row.latencyMs, 4211);
});

test("a job persisted without attribution writes no attempt row at all", async () => {
  const db = await createTestDatabase();
  const persisted = await persistHumanizationJob(db, {
    mode: "natural",
    clientFingerprint: "hashed-client-fingerprint",
    idempotencyKey: crypto.randomUUID(),
    contentFingerprint: "hashed-content-fingerprint",
    inputWordCount: 40,
    successfulWordCount: 40,
    pipelineVersion: 1,
    original: "The original text.",
    result: "The rewritten text.",
    protectedContent: [],
    previewProjection: {
      preview: "The rewritten",
      hiddenWordCount: 2,
      issuesImproved: 1,
      naturalness: "Strong",
      meaningPreservation: "High",
      protectedItems: [],
    },
  });
  const rows = await db.select().from(jobAttempts).where(eq(jobAttempts.jobId, persisted.jobId));
  assert.equal(rows.length, 0);
});
