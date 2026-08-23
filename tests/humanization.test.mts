import assert from "node:assert/strict";
import test from "node:test";

import { HUMANIZATION_BENCHMARK_PASSAGES } from "../benchmarks/humanization-passages";
import {
  analyzeWriting,
  countWords,
  createHumanizationPipeline,
  DeterministicHumanizationProvider,
  DeterministicVerificationProvider,
  extractProtectedContent,
  HumanizationFailedError,
  type HumanizationProvider,
} from "../src/lib/humanization/index";

test("extracts structured protected content with stable source ranges", () => {
  const text = 'Dr. Maya Chen said Acme Corp. shipped Atlas Pro 2.4 on August 12, 2026 for $18,400, a 12.5% discount. See (Chen, 2025), https://example.com/x and `retry(3)`. The API reference is doi:10.1000/xyz123. She wrote “keep v1 unchanged”.';
  const protectedContent = extractProtectedContent(text, ["v1"]);
  const values = new Set(protectedContent.map((item) => `${item.kind}:${item.value}`));

  for (const expected of [
    "person:Dr. Maya Chen",
    "company:Acme Corp",
    "product:Atlas Pro 2.4",
    "date:August 12, 2026",
    "currency:$18,400",
    "percentage:12.5%",
    "citation:(Chen, 2025)",
    "url:https://example.com/x",
    "code:`retry(3)`",
    "technical-term:API",
    "reference:doi:10.1000/xyz123",
    "quotation:“keep v1 unchanged”",
    "technical-term:v1",
  ]) assert.ok(values.has(expected), `missing ${expected}`);

  for (const item of protectedContent) {
    assert.equal(text.slice(item.start, item.end), item.value);
    assert.match(item.id, /^protected-\d+$/);
  }
});

test("analysis targets problematic sentences and leaves clean sentences alone", () => {
  const text = "The train arrived before noon. Furthermore, it is important to note that the robust solution will leverage synergy. We walked home.";
  const analysis = analyzeWriting(text);
  assert.ok(analysis.issues.some((issue) => issue.kind === "generic-transition"));
  assert.ok(analysis.issues.some((issue) => issue.kind === "robotic-vocabulary"));
  assert.ok(analysis.issues.some((issue) => issue.kind === "corporate-filler"));
  assert.equal(analysis.targets.length, 1);
  assert.match(analysis.targets[0].text, /^Furthermore/);
});

test("default pipeline rewrites only targets and preserves protected values", async () => {
  const pipeline = createHumanizationPipeline();
  const original = "The train arrived before noon. Furthermore, it is important to note that OpenAI will utilize the API for 120 requests on August 12, 2026. We walked home.";
  const result = await pipeline.humanize({ text: original, mode: "natural" });

  assert.match(result.text, /^The train arrived before noon\./);
  assert.doesNotMatch(result.text, /Furthermore|important to note|utilize/i);
  for (const value of ["OpenAI", "API", "120", "August 12, 2026"]) assert.ok(result.text.includes(value));
  assert.equal(result.verification.passed, true);
  assert.equal(result.verification.protectedContentScore, 1);
  assert.equal(result.metrics.attempts, 1);
  assert.equal(result.metrics.attemptedWords, countWords(original));
  assert.equal(result.metrics.successfulWords, countWords(original));
  assert.ok(result.improvements > 0);
});

test("default gates accept the representative generic-business demo", async () => {
  const original = "In today’s rapidly evolving business landscape, it is important to note that effective communication plays a crucial role in driving organizational success. Furthermore, companies must leverage innovative strategies in order to foster collaboration, enhance productivity, and achieve their long-term goals. In conclusion, a thoughtful approach to communication can help teams navigate challenges and unlock their full potential.";
  const result = await createHumanizationPipeline().humanize({ text: original, mode: "natural" });

  assert.equal(result.verification.passed, true);
  assert.equal(result.evaluation.passed, true);
  assert.doesNotMatch(result.text, /important to note|furthermore|leverage|in order to|in conclusion/i);
});

test("retries failed candidates without charging failed attempts", async () => {
  const deterministic = new DeterministicHumanizationProvider();
  const attempts: number[] = [];
  const provider: HumanizationProvider = {
    name: "fail-once",
    async rewrite(request) {
      attempts.push(request.attempt);
      if (request.attempt === 1) return { text: request.text.replace("42", "99") };
      assert.ok(request.previousFailures.some((failure) => failure.kind === "altered-quantity"));
      return deterministic.rewrite(request);
    },
  };
  const pipeline = createHumanizationPipeline({ humanizationProvider: provider, config: { maxRetries: 1 } });
  const original = "Furthermore, it is important to note that the API limit is 42 requests.";
  const words = countWords(original);
  const result = await pipeline.humanize({ text: original });

  assert.deepEqual(attempts, [1, 2]);
  assert.equal(result.metrics.attemptedWords, words * 2);
  assert.equal(result.metrics.successfulWords, words);
  assert.equal(result.metrics.retries, 1);
  assert.ok(result.text.includes("42"));
});

test("exhausted retries expose no rejected candidate and record zero successful words", async () => {
  const provider: HumanizationProvider = {
    name: "always-corrupt",
    async rewrite(request) {
      return { text: request.text.replace("42", "99") };
    },
  };
  const pipeline = createHumanizationPipeline({ humanizationProvider: provider, config: { maxRetries: 2 } });
  const original = "Furthermore, the API limit is 42 requests.";

  await assert.rejects(
    pipeline.humanize({ text: original }),
    (error: unknown) => {
      assert.ok(error instanceof HumanizationFailedError);
      assert.equal(error.metrics.attemptedWords, countWords(original) * 3);
      assert.equal(error.metrics.successfulWords, 0);
      assert.equal(error.metrics.attempts, 3);
      assert.equal("text" in error, false);
      return true;
    },
  );
});

test("quality thresholds are configurable", async () => {
  const pipeline = createHumanizationPipeline({
    config: { maxRetries: 0, thresholds: { naturalness: 1 } },
  });
  await assert.rejects(
    pipeline.humanize({ text: "Furthermore, we utilize a robust solution." }),
    (error: unknown) => error instanceof HumanizationFailedError && error.evaluation?.failedThresholds.includes("naturalness") === true,
  );
});

test("verification catches altered quantities, missing citations, and changed negation", async () => {
  const verifier = new DeterministicVerificationProvider();
  const original = "The API did not exceed 42 requests (Chen, 2025).";
  const protectedContent = extractProtectedContent(original);
  const result = await verifier.verify({ original, candidate: "The API exceeded 99 requests.", protectedContent });

  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.kind === "altered-quantity"));
  assert.ok(result.issues.some((issue) => issue.kind === "citation-damage"));
  assert.ok(result.issues.some((issue) => issue.kind === "changed-meaning"));
});

test("benchmark dataset contains exactly 100 passages, ten per required category", () => {
  const required = [
    "obvious ChatGPT prose",
    "academic",
    "professional",
    "marketing",
    "casual",
    "technical",
    "non-native English",
    "citation-heavy",
    "number-heavy",
    "long-form",
  ];
  assert.equal(HUMANIZATION_BENCHMARK_PASSAGES.length, 100);
  assert.equal(new Set(HUMANIZATION_BENCHMARK_PASSAGES.map((passage) => passage.id)).size, 100);
  for (const category of required) {
    assert.equal(HUMANIZATION_BENCHMARK_PASSAGES.filter((passage) => passage.category === category).length, 10);
  }
});

test("every declared benchmark fact is extracted from its source at the expected kind", () => {
  for (const passage of HUMANIZATION_BENCHMARK_PASSAGES) {
    const actual = new Set(extractProtectedContent(passage.text).map((item) => `${item.kind}:${item.value}`));
    for (const fact of passage.expectedProtectedFacts) {
      assert.ok(actual.has(`${fact.kind}:${fact.value}`), `${passage.id} does not extract ${fact.kind}:${fact.value}`);
    }
  }
});
