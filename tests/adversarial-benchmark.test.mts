import assert from "node:assert/strict";
import test from "node:test";

import { HUMANIZATION_ADVERSARIAL_PASSAGES } from "../benchmarks/humanization-adversarial";
import { HUMANIZATION_BENCHMARK_PASSAGES } from "../benchmarks/humanization-passages";
import { runAdversarialBenchmark, runHumanizationBenchmark } from "../src/lib/humanization/index";

/**
 * The number of adversarial passages the engine passes today. It is a
 * RATCHET, not a target: raise it when the engine improves, never lower it to
 * turn a run green. A drop means a regression and the failure inventory
 * printed by `npm run benchmark` names it.
 */
const ADVERSARIAL_PASSING_FLOOR = 17;

test("the adversarial set covers every hard-case kind the brief requires", () => {
  const categories = new Set(HUMANIZATION_ADVERSARIAL_PASSAGES.map((passage) => passage.category));
  for (const required of [
    "nested quotation",
    "citation",
    "numbers and units",
    "mixed-case acronym",
    "list",
    "very long sentence",
    "already natural",
    "meaning-breaking rewrite",
  ]) {
    assert.ok(categories.has(required), `adversarial set is missing the ${required} category`);
  }
});

test("every adversarial passage explains why it is hard and has a unique id", () => {
  const ids = new Set<string>();
  for (const passage of HUMANIZATION_ADVERSARIAL_PASSAGES) {
    assert.ok(passage.note.trim().length > 20, `${passage.id} needs a note explaining the case`);
    assert.equal(ids.has(passage.id), false, `duplicate adversarial id ${passage.id}`);
    ids.add(passage.id);
  }
});

test("the adversarial set contains cases the engine genuinely fails", async () => {
  // A suite nothing fails measures nothing. If this ever passes 25/25 the
  // set has stopped being adversarial and needs harder cases, not applause.
  const summary = await runAdversarialBenchmark(HUMANIZATION_ADVERSARIAL_PASSAGES);
  assert.ok(summary.passed < summary.passages, "no adversarial case fails; the set is too easy to detect a regression");
});

test("the engine corrupts nothing in the adversarial set", async () => {
  // Hard-safety: required text dropped, forbidden text created, a semantic
  // failure, or a protected-content failure. This must stay zero.
  const summary = await runAdversarialBenchmark(HUMANIZATION_ADVERSARIAL_PASSAGES);
  const offenders = summary.results
    .filter((result) => result.failures.some((failure) => ["lost-required-text", "produced-forbidden-text", "semantic-failure", "protected-content-failure"].includes(failure.kind)))
    .map((result) => `${result.id}: ${result.failures.map((failure) => failure.detail).join("; ")}`);
  assert.deepEqual(offenders, []);
  assert.equal(summary.hardSafetyFailures, 0);
});

test("adversarial pass count does not regress", async () => {
  const summary = await runAdversarialBenchmark(HUMANIZATION_ADVERSARIAL_PASSAGES);
  assert.ok(
    summary.passed >= ADVERSARIAL_PASSING_FLOOR,
    `adversarial passes fell to ${summary.passed}, below the ${ADVERSARIAL_PASSING_FLOOR} floor`,
  );
});

test("the release-set pass metric is reported alongside the no-op rate", async () => {
  // `passed` counts a passage as passed when every DECLARED protected fact
  // survives. 28 of the 100 passages declare none, so they pass whatever the
  // engine emits — including the input verbatim. The no-op count is what
  // stops that from reading as success.
  const summary = await runHumanizationBenchmark(HUMANIZATION_BENCHMARK_PASSAGES);
  assert.equal(summary.passages, 100);
  assert.equal(summary.semanticFailures, 0);
  assert.equal(summary.protectedContentFailures, 0);
  assert.ok(summary.unchanged > 0, "the no-op rate must be measured, not assumed to be zero");

  const numberHeavy = summary.results.filter((result) => result.category === "number-heavy");
  assert.equal(numberHeavy.length, 10);
  assert.equal(
    numberHeavy.every((result) => result.passed),
    true,
    "every number-heavy passage is reported as passed",
  );
  // ...and yet the engine changes none of them. Both facts are true at once,
  // which is exactly why the pass metric alone cannot detect a regression.
  assert.equal(numberHeavy.filter((result) => !result.changed).length, 10);
});

test("declared expected protected facts are absent from most of the release set", () => {
  const withoutFacts = HUMANIZATION_BENCHMARK_PASSAGES.filter((passage) => passage.expectedProtectedFacts.length === 0);
  assert.equal(withoutFacts.length, 28, "the count of unconditionally-passing passages changed; re-read docs/BENCHMARKS.md");
});
