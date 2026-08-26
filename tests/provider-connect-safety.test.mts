// The four things that had to be true before HUMANIZATION_PROVIDER=claude
// could be set on a production deploy (docs/SECURITY.md, 2026-08-26):
//
//   SEC-26 — /privacy may not claim "no third-party AI provider" while one is
//            selectable. The disclosure is derived from the same resolver the
//            pipeline uses, and this file fails if the two can disagree.
//   SEC-25 — an unauthenticated caller may not spend unbounded money at a
//            metered provider. The cost guard's verdict must refuse, not log.
//   SEC-27 — the sustained-cost check must evaluate on every observation, not
//            be skipped by the per-rewrite breach it exists to accompany.
//   SEC-08 — production credentials may not be in `npm ci`'s environment.
//
// Every import here is a pure module. `cloudflare:workers`, `next/headers` and
// `next/navigation` do not resolve under plain Node, so nothing that reaches
// them may be imported, which is why the page itself is asserted as source
// text rather than rendered.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import {
  humanizationDisclosure,
  resolveHumanizationProvider,
  NO_THIRD_PARTY_AI_CLAIM,
  THIRD_PARTY_HUMANIZATION_PROCESSORS,
  type HumanizationProviderEnv,
  type ThirdPartyProviderName,
} from "../src/lib/humanization/provider-config";
import { RewriteCostGuard, type RewriteCostObservation } from "../src/lib/humanization/cost-guard";
import {
  DistributedMeteredSpendBudget,
  LocalMeteredSpendBudget,
  MAX_COST_PER_REWRITE_USD,
  METERED_SPEND_BUDGET,
} from "../src/lib/humanization/spend-budget";

const PRIVACY_PAGE = new URL("../app/privacy/page.tsx", import.meta.url);
const HUMANIZE_ROUTE = new URL("../app/api/humanize/route.ts", import.meta.url);
const DEPLOY_WORKFLOW = new URL("../.github/workflows/deploy.yml", import.meta.url);

/** Every provider name that is not the deterministic engine, from the catalog's own keys. */
const THIRD_PARTY_NAMES = Object.keys(THIRD_PARTY_HUMANIZATION_PROCESSORS) as ThirdPartyProviderName[];

function envSelecting(provider: string): HumanizationProviderEnv {
  return { HUMANIZATION_PROVIDER: provider, ANTHROPIC_API_KEY: "test-only-not-a-real-key" };
}

/** Comments are documentation, not behavior; assertions about code read the code. */
function withoutComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// ---------------------------------------------------------------------------
// SEC-26 — the privacy notice and the pipeline cannot disagree
// ---------------------------------------------------------------------------

test("SEC-26: every provider that can be selected is a provider the page names", () => {
  // The finding, as an assertion. Against the old page this fails on the first
  // provider in the catalog: the copy was a literal, so `HUMANIZATION_PROVIDER=claude`
  // produced a running Claude pipeline and a page still saying nobody gets the text.
  assert.ok(THIRD_PARTY_NAMES.length > 0, "a catalog with no processors would make this test vacuous");

  for (const name of THIRD_PARTY_NAMES) {
    const env = envSelecting(name);
    const choice = resolveHumanizationProvider(env);
    assert.equal(choice.provider, name, `${name} must actually be selectable, or this test proves nothing`);

    const disclosure = humanizationDisclosure(env);
    const prose = disclosure.paragraphs.join(" ");

    assert.equal(disclosure.thirdParty, true, `${name} sends customer text off our infrastructure`);
    assert.equal(
      prose.includes(NO_THIRD_PARTY_AI_CLAIM),
      false,
      `the page must not claim "no third-party AI provider" while ${name} is selected`,
    );

    const processor = THIRD_PARTY_HUMANIZATION_PROCESSORS[name];
    assert.ok(prose.includes(processor.companyName), `${name}'s disclosure must NAME ${processor.companyName}`);
    assert.ok(prose.includes(processor.receives), `${name}'s disclosure must say what ${processor.companyName} receives`);
    assert.ok(
      prose.includes(processor.doesNotReceive),
      `${name}'s disclosure must bound what ${processor.companyName} does not receive`,
    );
    assert.ok(
      disclosure.processors.some((entry) => entry.companyName === processor.companyName),
      `${processor.companyName} must appear in the subprocessor list, not only in prose`,
    );
  }
});

test("SEC-26: the claim of no third-party provider survives only where it is true", () => {
  for (const env of [
    undefined,
    {},
    { HUMANIZATION_PROVIDER: "deterministic" },
    // Fail-closed selections: a provider was asked for and did not resolve, so
    // no text leaves the service and the claim is honest again.
    { HUMANIZATION_PROVIDER: "claude" },
    { HUMANIZATION_PROVIDER: "claude", ANTHROPIC_API_KEY: "   " },
    { HUMANIZATION_PROVIDER: "gpt-9", ANTHROPIC_API_KEY: "k" },
  ] satisfies Array<HumanizationProviderEnv | undefined>) {
    const disclosure = humanizationDisclosure(env);
    assert.equal(resolveHumanizationProvider(env).provider, "deterministic");
    assert.equal(disclosure.thirdParty, false, `${JSON.stringify(env)} sends nothing to a provider`);
    assert.deepEqual([...disclosure.processors], []);
    assert.ok(
      disclosure.paragraphs.join(" ").includes(NO_THIRD_PARTY_AI_CLAIM),
      "with no provider resolved, the page should still say so plainly",
    );
  }
});

test("SEC-26: an unverified term is disclosed as unverified, never invented", () => {
  // docs/SECURITY.md's disclosure principles: "The product must not claim zero
  // retention unless configuration and contract evidence support it." D-P05 is
  // still Proposed, so nobody has that evidence. A confident sentence here
  // would be a worse defect than the one this file exists to catch.
  for (const name of THIRD_PARTY_NAMES) {
    const processor = THIRD_PARTY_HUMANIZATION_PROCESSORS[name];
    const prose = humanizationDisclosure(envSelecting(name)).paragraphs.join(" ");

    for (const term of [processor.region, processor.retention, processor.training]) {
      assert.ok(prose.includes(term.label), `${name} must disclose ${term.label} one way or the other`);
      if (term.confirmed) {
        assert.notEqual(term.statement, "", `${name}: a confirmed term has to say something`);
        assert.ok(prose.includes(term.statement), `${name}: a confirmed term must reach the page`);
      } else {
        assert.equal(term.statement, "", `${name}: an unconfirmed term must not carry a statement to leak`);
        assert.ok(
          /still confirming|not verified/i.test(prose),
          `${name}: an unconfirmed term must be described as being confirmed`,
        );
      }
    }

    if ([processor.region, processor.retention, processor.training].some((term) => !term.confirmed)) {
      assert.ok(
        /make no claim that .* keeps your text for no time at all/.test(prose),
        `${name}: zero retention must be explicitly disclaimed while retention is unconfirmed`,
      );
    }
  }
});

test("SEC-26: no disclosure asserts a compliance status or a certification", () => {
  const claims = [/\bGDPR\b/i, /\bCCPA\b/i, /\bSOC\s*2\b/i, /\bHIPAA\b/i, /\bcompliant\b/i, /\bcertifi/i, /zero[- ]retention/i];
  const disclosures = [humanizationDisclosure(undefined), ...THIRD_PARTY_NAMES.map((name) => humanizationDisclosure(envSelecting(name)))];
  for (const disclosure of disclosures) {
    const prose = disclosure.paragraphs.join(" ");
    for (const claim of claims) {
      assert.equal(claim.test(prose), false, `a processor disclosure must not assert ${claim}: ${prose.slice(0, 80)}`);
    }
  }
});

test("SEC-26: /privacy derives the claim rather than keeping its own copy of it", async () => {
  // The structural half. The old page held the sentence as a literal, which is
  // exactly why one optional deploy variable could make it false. This fails
  // against that page: the literal is present and the import is not.
  const page = await readFile(PRIVACY_PAGE, "utf8");
  const code = withoutComments(page);

  assert.match(
    code,
    /import\s*\{[^}]*\bhumanizationDisclosure\b[^}]*\}\s*from\s*"@\/src\/lib\/humanization\/provider-config"/,
    "the page must ask the same module the pipeline asks",
  );
  assert.match(code, /disclosure\.paragraphs\.map\(/, "the AI-processing copy must be rendered from the disclosure");
  assert.match(code, /disclosure\.processors\.map\(/, "the subprocessor list must include the disclosed processor");

  assert.equal(
    code.includes(NO_THIRD_PARTY_AI_CLAIM),
    false,
    "the no-third-party claim must not be a literal in the page: a literal cannot be falsified by configuration",
  );
  for (const name of THIRD_PARTY_NAMES) {
    const processor = THIRD_PARTY_HUMANIZATION_PROCESSORS[name];
    assert.equal(
      code.includes(processor.companyName),
      false,
      `${processor.companyName} must reach the page from the catalog, not as hardcoded copy that can go stale`,
    );
  }
  // A hardcoded count goes wrong the moment the list grows by one.
  assert.equal(/Three companies are involved/.test(code), false, "the subprocessor count must be derived from the list");
});

test("SEC-26: the shipped artifact carries the disclosure, not just the source tree", async () => {
  // `npm test` builds first (tests/rendered-html.test.mjs depends on it), so
  // this reads what would actually be deployed. A page that names the
  // processor only in a source file nobody bundled would still ship the old
  // promise. Against the pre-fix build these strings exist nowhere in dist/.
  const root = new URL("../dist/server/", import.meta.url);
  const chunks: string[] = [];
  const walk = async (directory: URL) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
      if (entry.isDirectory()) await walk(child);
      else if (entry.name.endsWith(".js")) chunks.push(await readFile(child, "utf8"));
    }
  };
  await walk(root);
  assert.ok(chunks.length > 0, "dist/server must be built — run npm run build before npm test");
  const bundle = chunks.join("\n");

  for (const name of THIRD_PARTY_NAMES) {
    const processor = THIRD_PARTY_HUMANIZATION_PROCESSORS[name];
    assert.ok(
      bundle.includes(`Your text is sent to `) && bundle.includes(processor.companyName),
      `the deployed bundle must be able to name ${processor.companyName}`,
    );
    assert.ok(bundle.includes(processor.receives), `and to say what ${processor.companyName} receives`);
  }
  assert.ok(bundle.includes(NO_THIRD_PARTY_AI_CLAIM), "and to make the honest claim when it is honest");
});

test("SEC-26: the runtime and the page read one resolver, so they cannot drift apart", async () => {
  const [page, runtime] = await Promise.all([
    readFile(PRIVACY_PAGE, "utf8"),
    readFile(new URL("../app/api/humanize/humanization-runtime.ts", import.meta.url), "utf8"),
  ]);
  assert.match(withoutComments(runtime), /resolveHumanizationProvider\(/, "the pipeline resolves the provider here");
  // And the disclosure the page renders is defined in terms of that same call
  // (see `humanizationDisclosure`), which this asserts at the source so a
  // future edit cannot quietly fork the decision.
  const config = await readFile(new URL("../src/lib/humanization/provider-config.ts", import.meta.url), "utf8");
  assert.match(
    config,
    /export function humanizationDisclosure[\s\S]{0,400}resolveHumanizationProvider\(env\)/,
    "the disclosure must be computed from the resolver, not from a second reading of the environment",
  );
  assert.match(withoutComments(page), /await\s+processorDisclosure\(\)/);
});

// ---------------------------------------------------------------------------
// SEC-25 — the guard's verdict has to refuse
// ---------------------------------------------------------------------------

class TestStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly sql: string,
    private readonly params: Array<string | number | bigint | null | Uint8Array> = [],
  ) {}
  bind(...params: Array<string | number | bigint | null | Uint8Array>) { return new TestStatement(this.sqlite, this.sql, params); }
  async first<T>() { return (this.sqlite.prepare(this.sql).get(...this.params) ?? null) as T | null; }
  async run() {
    const info = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(info.changes) }, results: [] };
  }
}

class TestD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  prepare(sql: string) { return new TestStatement(this.sqlite, sql); }
  async batch(statements: TestStatement[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

/** The real schema, from the real migrations, so a column or check constraint cannot drift. */
async function testBinding() {
  const binding = new TestD1();
  const directory = new URL("../drizzle/", import.meta.url);
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    const migration = await readFile(new URL(file, directory), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) binding.sqlite.exec(statement);
    }
  }
  return binding;
}

function budgetOf(binding: TestD1, now: () => number = () => 1_800_000_000_000) {
  return new DistributedMeteredSpendBudget(binding as unknown as D1Database, { now });
}

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

test("SEC-25: the window's budget runs out and admission is refused", async () => {
  const binding = await testBinding();
  const budget = budgetOf(binding);
  const affordable = Math.floor(METERED_SPEND_BUDGET.maxUsdPerWindow / MAX_COST_PER_REWRITE_USD);

  const admissions = [];
  for (let index = 0; index < 50; index += 1) admissions.push(await budget.admit(MAX_COST_PER_REWRITE_USD));

  const admitted = admissions.filter((admission) => admission.admitted);
  const refused = admissions.filter((admission) => !admission.admitted);
  assert.equal(admitted.length, affordable, "the window may fund exactly what it can pay for");
  assert.equal(refused.length, 50 - affordable, "and every request past that is refused, not merely logged");
  assert.ok(refused.every((admission) => !admission.admitted && admission.retryAfterSeconds > 0), "a refusal must say when to come back");
});

test("SEC-25: fifty rewrites at fifty times the ceiling no longer produce fifty alarms and zero refusals", async () => {
  // The finding, driven. Old behaviour: `record()`'s return value was
  // discarded, so this loop served 50 rewrites, logged 50 alarms and refused
  // nothing — roughly $250 of simulated spend. There was no budget to admit
  // against at all, so this test cannot even be written against that code.
  const binding = await testBinding();
  const budget = budgetOf(binding);
  const guard = new RewriteCostGuard({ maxCostPerRewriteUsd: MAX_COST_PER_REWRITE_USD, maxCostPerWordUsd: 0.0000475 });

  let served = 0;
  let refused = 0;
  let spentUsd = 0;
  const runawayCostUsd = MAX_COST_PER_REWRITE_USD * 50;

  for (let index = 0; index < 50; index += 1) {
    const admission = await budget.admit(MAX_COST_PER_REWRITE_USD);
    if (!admission.admitted) {
      refused += 1;
      continue;
    }
    served += 1;
    spentUsd += runawayCostUsd;
    const alarm = guard.record(observation({ costUsd: runawayCostUsd }));
    await budget.settle(admission.reservation, runawayCostUsd, {
      exhaust: alarm?.kind === "sustained-cost-per-word" || guard.snapshot().sustainedBreach,
    });
  }

  assert.equal(served, 1, "one runaway rewrite is enough to exhaust the window it was admitted into");
  assert.equal(refused, 49, "and the other forty-nine are refused rather than served and logged");
  assert.equal(spentUsd, runawayCostUsd, "$5 of exposure instead of $250");
  assert.ok(guard.snapshot().perRewriteBreaches >= 1, "the alarm still fires — it is just no longer the only thing that happens");
});

test("SEC-25: a settled rewrite gives back what it did not spend, so the budget is dollars and not requests", async () => {
  const binding = await testBinding();
  const budget = budgetOf(binding);
  const cheapUsd = 0.002;

  // Twenty cheap rewrites cost $0.04 in total, well inside a $0.50 window; a
  // budget that counted requests at the reserved ceiling would have refused
  // after five and throttled traffic it could easily afford.
  for (let index = 0; index < 20; index += 1) {
    const admission = await budget.admit(MAX_COST_PER_REWRITE_USD);
    assert.equal(admission.admitted, true, `cheap rewrite ${index} should still be affordable`);
    if (admission.admitted) await budget.settle(admission.reservation, cheapUsd);
  }

  const row = binding.sqlite.prepare("SELECT request_count FROM preview_guard_windows WHERE client_key LIKE 'budget:%'").get() as { request_count: number };
  assert.equal(row.request_count, Math.round(20 * cheapUsd * 1_000_000), "the counter holds actual spend, in micro-dollars");
});

test("SEC-25: the reservation is atomic, so concurrent isolates cannot both take the last of it", async () => {
  const binding = await testBinding();
  const budget = () => budgetOf(binding);
  const affordable = Math.floor(METERED_SPEND_BUDGET.maxUsdPerWindow / MAX_COST_PER_REWRITE_USD);

  // Separate instances, as separate isolates would be: the ceiling has to live
  // in the shared store, not in any one of them.
  const results = await Promise.all(
    Array.from({ length: 40 }, () => budget().admit(MAX_COST_PER_REWRITE_USD)),
  );
  assert.equal(results.filter((admission) => admission.admitted).length, affordable);
});

test("SEC-25: the budget refuses when its store cannot be reached", async () => {
  const broken = {
    prepare() {
      return {
        bind() {
          return { run: async () => { throw new Error("D1_ERROR: no such table"); } };
        },
      };
    },
  };
  const budget = new DistributedMeteredSpendBudget(broken as unknown as D1Database);
  const admission = await budget.admit(MAX_COST_PER_REWRITE_USD);
  assert.equal(admission.admitted, false, "an unreachable counter is an unmetered provider, so the answer is no");
});

test("SEC-25: a window that has rolled starts from a full budget", async () => {
  const binding = await testBinding();
  let clock = 1_800_000_000_000;
  const budget = budgetOf(binding, () => clock);
  const affordable = Math.floor(METERED_SPEND_BUDGET.maxUsdPerWindow / MAX_COST_PER_REWRITE_USD);

  for (let index = 0; index < affordable; index += 1) assert.equal((await budget.admit(MAX_COST_PER_REWRITE_USD)).admitted, true);
  assert.equal((await budget.admit(MAX_COST_PER_REWRITE_USD)).admitted, false);

  clock += METERED_SPEND_BUDGET.windowMs;
  assert.equal((await budget.admit(MAX_COST_PER_REWRITE_USD)).admitted, true, "a refusal has to clear, or it is an outage");
});

test("SEC-25: the isolate-local fallback enforces the same ceiling", async () => {
  const budget = new LocalMeteredSpendBudget();
  const affordable = Math.floor(METERED_SPEND_BUDGET.maxUsdPerWindow / MAX_COST_PER_REWRITE_USD);
  let admitted = 0;
  for (let index = 0; index < 20; index += 1) if ((await budget.admit(MAX_COST_PER_REWRITE_USD)).admitted) admitted += 1;
  assert.equal(admitted, affordable);
});

test("SEC-25: the route no longer discards the cost guard's verdict", async () => {
  const route = await readFile(HUMANIZE_ROUTE, "utf8");
  const code = withoutComments(route);

  // The exact line the finding is about: a bare call, return value dropped.
  assert.equal(
    /(?:^|[^.\w])runtime\.costGuard\?\.record\(/m.test(code.replace(/const\s+\w+\s*=\s*runtime\.costGuard\?\.record\(/g, "ASSIGNED(")),
    false,
    "record()'s verdict must be bound to something that acts on it",
  );
  assert.match(code, /const\s+costAlarm\s*=\s*runtime\.costGuard\?\.record\(/, "the verdict must be captured");
  assert.match(code, /exhaust:\s*costAlarm\?\.kind === "sustained-cost-per-word"/, "and it must reach the budget");
});

test("SEC-25: the route admits against the budget before it calls the provider, and only when nobody else is paying", async () => {
  const code = withoutComments(await readFile(HUMANIZE_ROUTE, "utf8"));
  const admit = code.indexOf("spendBudget.admit(");
  const humanize = code.indexOf("runtime.pipeline.humanize(");

  assert.ok(admit > 0, "the route must reserve spend against the shared budget");
  assert.ok(humanize > 0);
  assert.ok(admit < humanize, "money is reserved before it is spent, or the ceiling is decoration");
  assert.match(
    code,
    /runtime\.provider !== "deterministic" && !paidReservation/,
    "the ceiling covers rewrites no word ledger is paying for; the deterministic engine costs nothing",
  );
  // A terminal answer, not a 500 and not a silent success.
  assert.match(code, /MeteredSpendExhaustedError/);
  assert.match(code, /status:\s*503,[\s\S]{0,200}"retry-after":\s*String\(error\.retryAfterSeconds\)/);
  assert.match(code, /No usage was charged/);
});

// ---------------------------------------------------------------------------
// SEC-27 — the trend check must run during the runaway
// ---------------------------------------------------------------------------

test("SEC-27: a window of uniformly over-ceiling rewrites reports sustainedBreach", () => {
  // Scenario A from the finding: 60 rewrites at $5.00 each, $0.025/word
  // against a $0.0000475 ceiling. Old behaviour: `sustainedBreach: false`,
  // because the per-rewrite branch returned before the trend was evaluated.
  const guard = new RewriteCostGuard({ maxCostPerRewriteUsd: 0.1, maxCostPerWordUsd: 0.0000475 });
  for (let index = 0; index < 60; index += 1) guard.record(observation({ costUsd: 5 }));

  const snapshot = guard.snapshot();
  assert.equal(snapshot.sustainedBreach, true, "the economically worst state must not read clean");
  assert.equal(snapshot.perRewriteBreaches, 60, "and the per-rewrite alarm still counts every one of them");
  assert.equal(Number(snapshot.costPerWordUsd.toFixed(6)), 0.02);
});

test("SEC-27: the cheaper regime still reports it too, so the flag now orders the two correctly", () => {
  const runaway = new RewriteCostGuard({ maxCostPerRewriteUsd: 0.1, maxCostPerWordUsd: 0.0000475 });
  const cheaper = new RewriteCostGuard({ maxCostPerRewriteUsd: 0.1, maxCostPerWordUsd: 0.0000475 });
  for (let index = 0; index < 60; index += 1) {
    runaway.record(observation({ costUsd: 5 }));
    cheaper.record(observation({ costUsd: 0.09 }));
  }
  assert.equal(cheaper.snapshot().sustainedBreach, true);
  assert.equal(runaway.snapshot().sustainedBreach, true);
  assert.ok(
    runaway.snapshot().costPerWordUsd > cheaper.snapshot().costPerWordUsd,
    "the worse regime must not be the one that reads clean",
  );
});

test("SEC-27: both alarms are raised when both come due on the same observation", () => {
  const raised: string[] = [];
  const guard = new RewriteCostGuard(
    { maxCostPerRewriteUsd: 0.1, maxCostPerWordUsd: 0.0000475, minimumSample: 5 },
    (alarm) => raised.push(alarm.kind),
  );
  for (let index = 0; index < 5; index += 1) guard.record(observation({ costUsd: 5 }));

  assert.ok(raised.includes("sustained-cost-per-word"), "the trend alarm must not be swallowed by the per-rewrite one");
  assert.ok(raised.includes("per-rewrite-ceiling"));
});

// ---------------------------------------------------------------------------
// SEC-08 — the install step is not where the production credential set lives
// ---------------------------------------------------------------------------

/** Every secret the deploy job declares. The exposure is the whole list, not any one of them. */
const DEPLOY_SECRETS = [
  "CF_API_TOKEN",
  "CF_ACCOUNT_ID",
  "CF_D1_ID",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_STARTER",
  "STRIPE_PRICE_PRO",
  "PREVIEW_GUARD_SECRET",
  "RESEND_API_KEY",
  "ANTHROPIC_API_KEY",
  "AUTH_EMAIL_FROM",
];

test("SEC-08: dependency install runs no lifecycle scripts", async () => {
  // YAML comments explain the flag and would otherwise match the search for
  // an unguarded invocation of it.
  const workflow = (await readFile(DEPLOY_WORKFLOW, "utf8"))
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
  assert.match(workflow, /npm ci --ignore-scripts/, "a compromised transitive dependency must not get to execute at all");
  assert.equal(/npm ci(?! --ignore-scripts)/.test(workflow), false, "every npm ci in the deploy must disable scripts");
});

test("SEC-08: no production credential is in the install step's environment", async () => {
  const workflow = await readFile(DEPLOY_WORKFLOW, "utf8");
  // The install step and its own env block, from `- run: npm ci` to the next
  // step marker.
  const start = workflow.indexOf("- run: npm ci");
  assert.ok(start > 0, "the install step must still exist");
  const rest = workflow.slice(start);
  const end = rest.indexOf("\n      - ");
  const step = end === -1 ? rest : rest.slice(0, end);

  for (const secret of DEPLOY_SECRETS) {
    assert.match(
      step,
      new RegExp(`^\\s+${secret}:\\s*""\\s*$`, "m"),
      `${secret} must be blanked for the install step, so an install script reads nothing`,
    );
  }
});

test("SEC-08: every secret the Worker needs still survives a deploy", async () => {
  // Guards the narrowing above against itself: `wrangler deploy --secrets-file`
  // REPLACES the Worker's whole secret set, so a secret dropped while tidying
  // the job's environment is deleted from the running Worker on the next
  // deploy. This duplicates tests/security-blockers.test.mts deliberately —
  // that suite is where the requirement lives, this is the one that runs
  // beside the change that could break it.
  const workflow = await readFile(DEPLOY_WORKFLOW, "utf8");
  for (const secret of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_STARTER", "STRIPE_PRICE_PRO", "PREVIEW_GUARD_SECRET", "RESEND_API_KEY", "ANTHROPIC_API_KEY"]) {
    assert.match(workflow, new RegExp(`"${secret}=\\$${secret}"`), `${secret} must be written into the secrets file`);
  }
});
