import assert from "node:assert/strict";
import test from "node:test";

import {
  createHumanizationPipeline,
  DeterministicHumanizationProvider,
  HumanizationFailedError,
  ProviderError,
  type HumanizationProvider,
  type VerificationProvider,
} from "../src/lib/humanization/index";

// The seam a real model provider has to fit through. Nothing here calls an
// external API or names a vendor; these assert that the SHAPES a model call
// needs exist, so adding one is a configuration change and not a refactor.

const passable = "Furthermore, it is important to note that the API limit is 42 requests per minute.";

test("a provider reports the input/output token split and the pipeline totals it", async () => {
  const provider: HumanizationProvider = {
    name: "usage-reporting",
    async rewrite(request) {
      const text = await new DeterministicHumanizationProvider().rewrite(request);
      return { ...text, usage: { inputTokens: 120, outputTokens: 45, cachedInputTokens: 100, costUsd: 0.0003, model: "test-model-1" } };
    },
  };
  const result = await createHumanizationPipeline({ humanizationProvider: provider }).humanize({ text: passable });

  // A single estimatedTokens number cannot carry this: input, output and
  // cached input are priced differently.
  assert.equal(result.metrics.inputTokens, 120);
  assert.equal(result.metrics.outputTokens, 45);
  assert.equal(result.metrics.cachedInputTokens, 100);
  assert.equal(result.metrics.providerCostUsd, 0.0003);
  assert.deepEqual(result.providers.models, ["test-model-1"]);
});

test("verification usage is counted too, so a model-based verifier is not free", async () => {
  const verifier: VerificationProvider = {
    name: "billed-verifier",
    async verify() {
      return { passed: true, semanticScore: 1, protectedContentScore: 1, issues: [], usage: { inputTokens: 30, outputTokens: 5, costUsd: 0.00002, model: "judge-1" } };
    },
  };
  const result = await createHumanizationPipeline({ verificationProvider: verifier }).humanize({ text: passable });

  assert.equal(result.metrics.inputTokens, 30);
  assert.equal(result.metrics.outputTokens, 5);
  assert.equal(result.metrics.providerCostUsd, 0.00002);
  assert.deepEqual(result.providers.models, ["judge-1"]);
});

test("usage totals accumulate across retries rather than reporting only the last attempt", async () => {
  let call = 0;
  const provider: HumanizationProvider = {
    name: "retrying-usage",
    async rewrite(request) {
      call += 1;
      const usage = { inputTokens: 10, outputTokens: 4, costUsd: 0.0001 };
      if (call === 1) return { text: request.text.replace("42", "99"), usage };
      return { ...(await new DeterministicHumanizationProvider().rewrite(request)), usage };
    },
  };
  const result = await createHumanizationPipeline({ humanizationProvider: provider, config: { maxRetries: 1 } }).humanize({ text: passable });

  assert.equal(call, 2);
  assert.equal(result.metrics.inputTokens, 20);
  assert.equal(result.metrics.outputTokens, 8);
  assert.equal(result.metrics.providerCostUsd, 0.0002);
});

test("every result records which providers produced it", async () => {
  const result = await createHumanizationPipeline().humanize({ text: passable });
  assert.equal(result.providers.humanization, "deterministic-v1");
  assert.equal(result.providers.verification, "deterministic-semantic-v1");
  assert.equal(result.providers.evaluation, "deterministic-quality-v1");
});

test("a non-retryable provider error stops immediately instead of paying for doomed retries", async () => {
  let calls = 0;
  const provider: HumanizationProvider = {
    name: "rejecting",
    async rewrite() {
      calls += 1;
      throw new ProviderError("The request was rejected.", { kind: "invalid-request" });
    },
  };
  await assert.rejects(
    createHumanizationPipeline({ humanizationProvider: provider, config: { maxRetries: 2 } }).humanize({ text: passable }),
    (error: unknown) => error instanceof HumanizationFailedError && /invalid-request/.test(error.message),
  );
  assert.equal(calls, 1, "a 400 was retried; three doomed calls to a metered API cost real money");
});

test("a retryable provider error is retried", async () => {
  let calls = 0;
  const provider: HumanizationProvider = {
    name: "rate-limited-once",
    async rewrite(request) {
      calls += 1;
      if (calls === 1) throw new ProviderError("Slow down.", { kind: "rate-limit", retryAfterMs: 1 });
      return new DeterministicHumanizationProvider().rewrite(request);
    },
  };
  const result = await createHumanizationPipeline({ humanizationProvider: provider, config: { maxRetries: 2 } }).humanize({ text: passable });
  assert.equal(calls, 2);
  assert.equal(result.metrics.attempts, 2);
});

test("rate limits and refusals default to the right retryability", () => {
  assert.equal(new ProviderError("x", { kind: "rate-limit" }).retryable, true);
  assert.equal(new ProviderError("x", { kind: "timeout" }).retryable, true);
  assert.equal(new ProviderError("x", { kind: "server" }).retryable, true);
  assert.equal(new ProviderError("x", { kind: "refusal" }).retryable, false);
  assert.equal(new ProviderError("x", { kind: "invalid-request" }).retryable, false);
  // An explicit choice always wins over the default.
  assert.equal(new ProviderError("x", { kind: "rate-limit", retryable: false }).retryable, false);
});

test("a per-attempt deadline bounds one call, not the whole request", async () => {
  // The provider ignores the signal it is handed, which is exactly the case a
  // deadline has to survive.
  let calls = 0;
  const provider: HumanizationProvider = {
    name: "hangs-once",
    async rewrite(request) {
      calls += 1;
      if (calls === 1) return new Promise(() => undefined);
      return new DeterministicHumanizationProvider().rewrite(request);
    },
  };
  // AbortSignal.timeout uses an unref'd timer, so with a hung provider and an
  // otherwise idle loop the test runner would drain before the deadline
  // fires. A live request keeps the loop alive in production; this stands in
  // for one.
  const keepAlive = setInterval(() => undefined, 5);
  try {
    const result = await createHumanizationPipeline({
      humanizationProvider: provider,
      config: { maxRetries: 1, providerTimeoutMs: 25 },
    }).humanize({ text: passable });

    assert.equal(calls, 2, "the hung first attempt must not consume the whole request budget");
    assert.equal(result.metrics.attempts, 2);
  } finally {
    clearInterval(keepAlive);
  }
});

test("the caller's own abort still wins over a per-attempt deadline", async () => {
  const provider: HumanizationProvider = { name: "never", async rewrite() { return new Promise(() => undefined); } };
  const controller = new AbortController();
  const keepAlive = setInterval(() => undefined, 5);
  try {
    const pending = createHumanizationPipeline({
      humanizationProvider: provider,
      config: { maxRetries: 5, providerTimeoutMs: 10_000 },
    }).humanize({ text: passable, signal: controller.signal });
    controller.abort(new DOMException("Deadline exceeded.", "TimeoutError"));

    await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === "TimeoutError");
  } finally {
    clearInterval(keepAlive);
  }
});
