// The control that stops docs/BENCHMARKS.md's modelled cost table from
// becoming a silent monthly loss. No network, no key: the guard is arithmetic
// over numbers a provider already reported.
import assert from "node:assert/strict";
import test from "node:test";

import { pricingConfig } from "../src/config/pricing";
import {
  costCeilingFromPlans,
  formatCostAlarm,
  RewriteCostGuard,
  type CostAlarm,
  type RewriteCostObservation,
} from "../src/lib/humanization/cost-guard";

function observation(overrides: Partial<RewriteCostObservation> = {}): RewriteCostObservation {
  return {
    costUsd: 0.002,
    words: 250,
    inputTokens: 1900,
    outputTokens: 330,
    cachedInputTokens: 1500,
    thinkingTokens: 0,
    attempts: 1,
    providerName: "claude-claude-opus-5",
    resultModel: "claude-opus-5",
    ...overrides,
  };
}

test("one runaway rewrite alarms immediately, without waiting for a trend", () => {
  const alarms: CostAlarm[] = [];
  const guard = new RewriteCostGuard({ maxCostPerRewriteUsd: 0.1, maxCostPerWordUsd: 0.0001 }, (alarm) => alarms.push(alarm));

  assert.equal(guard.record(observation()), undefined);
  const alarm = guard.record(observation({ costUsd: 0.42 }));

  assert.equal(alarm?.kind, "per-rewrite-ceiling");
  assert.equal(alarm?.observedUsd, 0.42);
  assert.equal(alarm?.sample, 1);
  assert.deepEqual(alarms, [alarm]);
  assert.equal(guard.snapshot().perRewriteBreaches, 1);
});

test("a sustained loss alarms even though no single rewrite looks wrong", () => {
  // This is the failure a per-request ceiling cannot see: every rewrite is
  // individually cheap, and the business is losing money on all of them.
  const alarms: CostAlarm[] = [];
  const guard = new RewriteCostGuard(
    { maxCostPerRewriteUsd: 1, maxCostPerWordUsd: 0.0001, minimumSample: 10 },
    (alarm) => alarms.push(alarm),
  );

  // $0.05 for 250 words is $0.0002/word — double the ceiling, and nowhere
  // near the $1 per-rewrite ceiling.
  let raised: CostAlarm | undefined;
  for (let index = 0; index < 10; index += 1) raised = guard.record(observation({ costUsd: 0.05 })) ?? raised;

  assert.equal(raised?.kind, "sustained-cost-per-word");
  assert.equal(Number(raised?.observedUsd.toFixed(6)), 0.0002);
  assert.equal(raised?.sample, 10);
  assert.equal(guard.snapshot().sustainedBreach, true);
});

test("the sustained alarm waits for a sample, so three expensive documents do not page anyone", () => {
  const alarms: CostAlarm[] = [];
  const guard = new RewriteCostGuard(
    { maxCostPerRewriteUsd: 1, maxCostPerWordUsd: 0.0001, minimumSample: 25 },
    (alarm) => alarms.push(alarm),
  );
  for (let index = 0; index < 24; index += 1) guard.record(observation({ costUsd: 0.05 }));
  assert.deepEqual(alarms, [], "24 observations is not a trend");

  guard.record(observation({ costUsd: 0.05 }));
  assert.equal(alarms.length, 1);
});

test("a breach that persists logs on entry and then at intervals, not on every rewrite", () => {
  const alarms: CostAlarm[] = [];
  const guard = new RewriteCostGuard(
    { maxCostPerRewriteUsd: 1, maxCostPerWordUsd: 0.0001, minimumSample: 5, repeatEvery: 20 },
    (alarm) => alarms.push(alarm),
  );
  for (let index = 0; index < 60; index += 1) guard.record(observation({ costUsd: 0.05 }));

  // Entry at the fifth, then every twentieth after it. An alarm that logged
  // 56 times gets muted by whoever is on call.
  assert.equal(alarms.length, 3);
  assert.ok(alarms.every((alarm) => alarm.kind === "sustained-cost-per-word"));
});

test("costs come back under the ceiling and the guard clears", () => {
  const guard = new RewriteCostGuard({ maxCostPerRewriteUsd: 1, maxCostPerWordUsd: 0.0001, minimumSample: 5, windowSize: 10 });
  for (let index = 0; index < 10; index += 1) guard.record(observation({ costUsd: 0.05 }));
  assert.equal(guard.snapshot().sustainedBreach, true);

  for (let index = 0; index < 10; index += 1) guard.record(observation({ costUsd: 0.001 }));
  assert.equal(guard.snapshot().sustainedBreach, false, "the window has to be able to roll out of a breach");
});

test("a rewrite that delivered nothing still counts its cost against zero words", () => {
  // A provider quietly producing no-ops spends money and bills the customer
  // nothing. That is an economic failure, and averaging it away would hide it.
  const guard = new RewriteCostGuard({ maxCostPerRewriteUsd: 1, maxCostPerWordUsd: 1 });
  guard.record(observation({ costUsd: 0.01, words: 250 }));
  guard.record(observation({ costUsd: 0.01, words: 0 }));

  const snapshot = guard.snapshot();
  assert.equal(snapshot.rewrites, 2);
  assert.equal(snapshot.words, 250);
  assert.equal(Number(snapshot.costPerWordUsd.toFixed(6)), 0.00008, "both rewrites' cost over one rewrite's words");
});

test("the snapshot exposes the cache share, because silent cache loss triples the input bill", () => {
  const guard = new RewriteCostGuard({ maxCostPerRewriteUsd: 1, maxCostPerWordUsd: 1 });
  guard.record(observation({ inputTokens: 2000, cachedInputTokens: 1500 }));
  assert.equal(guard.snapshot().cachedInputShare, 0.75);

  const cold = new RewriteCostGuard({ maxCostPerRewriteUsd: 1, maxCostPerWordUsd: 1 });
  cold.record(observation({ inputTokens: 2000, cachedInputTokens: 0 }));
  assert.equal(cold.snapshot().cachedInputShare, 0, "zero across repeated calls means the prefix stopped matching");
});

test("the per-word ceiling is derived from the plan catalogue, not hardcoded", () => {
  // Derivation is the point: a hardcoded number goes stale against exactly
  // the price or allowance change the alarm exists to catch.
  const ceiling = costCeilingFromPlans(Object.values(pricingConfig.plans), 0.5);

  // Pro earns $19 for 200,000 words = $0.000095/word; Starter earns
  // Starter earns $9.99/50,000 = $0.0001998/word; Pro earns
  // $39.99/200,000 = $0.00019995. Pro was the weaker plan by a factor of two
  // until its price was raised to match Starter's per-word rate, so the two
  // now sit within a rounding error and Starter is marginally the worse.
  assert.equal(Number(ceiling.toFixed(9)), 0.0000999);

  const shifted = costCeilingFromPlans([{ monthlyPrice: 20, wordLimit: 50_000 }], 0.5);
  assert.equal(Number(shifted.toFixed(9)), 0.0002, "a price change must move the alarm with it");
});

test("the worst plan sets the ceiling, because it goes underwater first", () => {
  const plans = [
    { monthlyPrice: 9.99, wordLimit: 50_000 },
    { monthlyPrice: 19, wordLimit: 200_000 },
  ];
  const worst = costCeilingFromPlans(plans, 0);
  assert.equal(Number(worst.toFixed(9)), 0.000095, "averaging the plans together would hide the weaker one");
});

test("an alarm line carries numbers, a provider and a model, and nothing else", () => {
  const line = formatCostAlarm({
    kind: "per-rewrite-ceiling",
    observedUsd: 0.42,
    ceilingUsd: 0.1,
    sample: 1,
    providerName: "claude-routed(claude-sonnet-5->claude-opus-5)",
    resultModel: "claude-opus-5",
  });
  assert.match(line, /\$0\.420000/);
  assert.match(line, /\$0\.100000/);
  assert.match(line, /claude-opus-5/);
  // Whatever else changes, a log line must never grow a way to carry text.
  assert.equal(/[a-z]{4,} [a-z]{4,} [a-z]{4,} [a-z]{4,} [a-z]{4,} [a-z]{4,}/.test(line.replace(/humanization cost alarm: /, "")), false);
});

test("an unreported model does not break the alarm line", () => {
  const line = formatCostAlarm({
    kind: "sustained-cost-per-word",
    observedUsd: 0.0002,
    ceilingUsd: 0.0000475,
    sample: 200,
    providerName: "deterministic-v1",
  });
  assert.match(line, /unreported/);
  assert.match(line, /200 rewrites/);
});

test("mean thinking tokens is on the snapshot, because it is the number that decides the margin", () => {
  const guard = new RewriteCostGuard({ maxCostPerRewriteUsd: 1, maxCostPerWordUsd: 1 });
  guard.record(observation({ thinkingTokens: 400 }));
  guard.record(observation({ thinkingTokens: 1600 }));
  assert.equal(guard.snapshot().meanThinkingTokens, 1000);
});

// `npm run measure:cost` — the script that replaces the modelled table with a
// measured one. Exercised as a subprocess with the key deliberately removed,
// so the suite proves the refusal without ever making a call.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

async function measureCost(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const environment = { ...process.env };
  delete environment.ANTHROPIC_API_KEY;
  try {
    const { stdout, stderr } = await run(process.execPath, ["--import", "tsx", "scripts/measure-cost.mts", ...args], {
      cwd: new URL("..", import.meta.url).pathname,
      env: environment,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

test("measure:cost refuses without a key rather than printing modelled numbers", async () => {
  const result = await measureCost([]);

  assert.equal(result.code, 2);
  assert.match(result.stderr, /needs a real ANTHROPIC_API_KEY/);
  // The specific failure being prevented: deterministic or modelled figures
  // appearing under a heading that says they were measured.
  assert.equal(/MEASURED/.test(result.stdout), false);
  assert.equal(/costPerRewriteUsd/.test(result.stdout), false);
  assert.equal(result.stdout.trim(), "");
});

test("measure:cost --dry-run shows what it would measure and prints no cost figure", async () => {
  const result = await measureCost(["--dry-run"]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /DRY RUN — nothing was measured and no API call was made\./);
  assert.match(result.stdout, /"plannedCalls": 50/);
  for (const forbidden of [/MEASURED/, /costPerRewrite/, /grossMargin/, /inferenceUsd/, /\$\d/]) {
    assert.equal(forbidden.test(result.stdout), false, `a dry run must not print ${forbidden}`);
  }
});

test("measure:cost composes documents the length the product actually accepts", async () => {
  // The release corpus has a median passage of 20 words against the 200-300
  // the route accepts. Projecting a plan's economics from 20-word fragments
  // charges a full rewrite's fixed overhead against a twelfth of the words.
  const result = await measureCost(["--dry-run"]);
  const report = JSON.parse(result.stdout.slice(result.stdout.indexOf("{"), result.stdout.lastIndexOf("}") + 1));

  assert.equal(report.corpus, "composed");
  assert.ok(report.wordsPerDocument.median >= 180, `median ${report.wordsPerDocument.median} is not a real document`);
  assert.ok(report.wordsPerDocument.max <= 300, "the route rejects more than 300 words");
});

test("measure:cost rejects an effort level that does not exist", async () => {
  const result = await measureCost(["--dry-run", "--efforts=turbo"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Unknown effort/);
});
