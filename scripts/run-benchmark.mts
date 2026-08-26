import { HUMANIZATION_ADVERSARIAL_PASSAGES } from "../benchmarks/humanization-adversarial";
import { HUMANIZATION_BENCHMARK_PASSAGES } from "../benchmarks/humanization-passages";
import { countWords, createHumanizationPipeline, runAdversarialBenchmark, runHumanizationBenchmark, type HumanizationPipeline } from "../src/lib/humanization";

// Which engine this run measures.
//
// Default is the deterministic provider, so `npm run benchmark` works on a
// machine that has never had an API key and produces the frozen baseline the
// change protocol compares against. `--provider=claude` measures the model
// provider and REQUIRES ANTHROPIC_API_KEY: the alternative — quietly falling
// back to the deterministic engine and printing the numbers under a Claude
// heading — would be a fabricated measurement.
const requested = (process.argv.find((argument) => argument.startsWith("--provider="))?.split("=")[1] ?? "deterministic").toLowerCase();
const model = process.argv.find((argument) => argument.startsWith("--model="))?.split("=")[1];
const effort = process.argv.find((argument) => argument.startsWith("--effort="))?.split("=")[1];
const ladderArgument = process.argv.find((argument) => argument.startsWith("--ladder="))?.split("=")[1];
const ladder = ladderArgument?.split(",").map((part) => part.trim()) as ["claude-opus-5" | "claude-sonnet-5" | "claude-haiku-4-5", "claude-opus-5" | "claude-sonnet-5" | "claude-haiku-4-5"] | undefined;

// Escalation observations, collected by the router's content-free hook.
const escalations: Array<{ resultModel: string; escalated: boolean; reason?: string }> = [];

async function buildPipeline(): Promise<{ pipeline: HumanizationPipeline; label: string }> {
  if (requested === "deterministic") {
    return { pipeline: createHumanizationPipeline(), label: "deterministic-v1" };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    process.stderr.write("--provider=claude needs ANTHROPIC_API_KEY. Refusing to print deterministic numbers under a Claude heading.\n");
    process.exit(2);
  }
  const { ClaudeHumanizationProvider, createAnthropicMessagesClient } = await import("../src/lib/humanization/claude-provider");
  const client = createAnthropicMessagesClient({ apiKey });
  const provider = requested === "claude-routed"
    ? new (await import("../src/lib/humanization/escalating-provider")).EscalatingClaudeProvider({
        client,
        ...(ladder ? { ladder } : {}),
        ...(effort ? { effort: effort as "low" | "medium" | "high" | "xhigh" | "max" } : {}),
        onAttempt: (record) => {
          escalations.push(record);
        },
      })
    : new ClaudeHumanizationProvider({
        client,
        ...(model ? { model: model as "claude-opus-5" | "claude-sonnet-5" | "claude-haiku-4-5" } : {}),
        ...(effort ? { effort: effort as "low" | "medium" | "high" | "xhigh" | "max" } : {}),
      });
  return { pipeline: createHumanizationPipeline({ humanizationProvider: provider, config: { providerTimeoutMs: 120_000 } }), label: provider.name };
}

const { pipeline, label } = await buildPipeline();
const release = await runHumanizationBenchmark(HUMANIZATION_BENCHMARK_PASSAGES, pipeline);
const adversarial = await runAdversarialBenchmark(HUMANIZATION_ADVERSARIAL_PASSAGES, pipeline);

const lines: string[] = [];
const write = (line = "") => lines.push(line);

write(`Provider under test: ${label}`);
write();
write("Release set (frozen, 100 passages)");
write(JSON.stringify({
  passages: release.passages,
  passed: release.passed,
  unchanged: release.unchanged,
  semanticFailures: release.semanticFailures,
  protectedContentFailures: release.protectedContentFailures,
  averageNaturalness: release.averageNaturalness,
  averageLatencyMs: release.averageLatencyMs,
  estimatedTokens: release.estimatedTokens,
  estimatedCostUsd: release.estimatedCostUsd,
}, null, 2));

// `passed` only asks whether the DECLARED protected facts survived, and 28 of
// the 100 release passages declare none — those pass whatever comes out,
// including the input verbatim. The no-op column is what makes that visible.
write();
write("Release set by category (no-op = engine returned the input untouched)");
const categories = new Map<string, { total: number; passed: number; unchanged: number }>();
for (const result of release.results) {
  const entry = categories.get(result.category) ?? { total: 0, passed: 0, unchanged: 0 };
  entry.total += 1;
  if (result.passed) entry.passed += 1;
  if (!result.changed) entry.unchanged += 1;
  categories.set(result.category, entry);
}
for (const [category, entry] of categories) {
  write(`  ${category.padEnd(24)} passed ${entry.passed}/${entry.total}   no-op ${String(entry.unchanged).padStart(2)}/${entry.total}`);
}

// Economics. docs/BENCHMARKS.md asks for "estimated and realized cost per
// humanization and per 1,000 successful words", and a margin that is a guess
// is not a margin. These figures are derived from what the provider actually
// reported for this run; on the deterministic provider they are legitimately
// zero.
const releaseWords = HUMANIZATION_BENCHMARK_PASSAGES.reduce((sum, passage) => sum + countWords(passage.text), 0);
const perRewrite = release.estimatedCostUsd / Math.max(1, release.passages);
const perThousandWords = (release.estimatedCostUsd / Math.max(1, releaseWords)) * 1000;
write();
write("Economics (release set, from reported usage)");
write(JSON.stringify({
  words: releaseWords,
  totalCostUsd: Number(release.estimatedCostUsd.toFixed(6)),
  costPerRewriteUsd: Number(perRewrite.toFixed(6)),
  costPer1000WordsUsd: Number(perThousandWords.toFixed(6)),
  // The Pro plan sells 50,000 words a month for $9.99.
  costOf50000WordsUsd: Number((perThousandWords * 50).toFixed(2)),
  grossMarginAt9_99: release.estimatedCostUsd === 0 ? null : Number((((9.99 - perThousandWords * 50) / 9.99) * 100).toFixed(1)),
}, null, 2));

if (escalations.length) {
  // Routing economics. An escalated rewrite pays for BOTH models, so a high
  // escalation rate is not a saving — it is the expensive model plus a
  // surcharge. This block is what says which of those happened.
  const escalated = escalations.filter((record) => record.escalated);
  const byReason = new Map<string, number>();
  for (const record of escalated) byReason.set(record.reason ?? "unknown", (byReason.get(record.reason ?? "unknown") ?? 0) + 1);
  const byModel = new Map<string, number>();
  for (const record of escalations) byModel.set(record.resultModel, (byModel.get(record.resultModel) ?? 0) + 1);
  write();
  write("Routing");
  write(JSON.stringify({
    rewrites: escalations.length,
    escalated: escalated.length,
    escalationRate: Number((escalated.length / escalations.length).toFixed(4)),
    escalationReasons: Object.fromEntries(byReason),
    resultsByModel: Object.fromEntries(byModel),
  }, null, 2));
}

write();
write(`Adversarial set (hard cases, ${adversarial.passages} passages)`);
write(JSON.stringify({
  passages: adversarial.passages,
  passed: adversarial.passed,
  hardSafetyFailures: adversarial.hardSafetyFailures,
  retryExhaustion: adversarial.retryExhaustion,
}, null, 2));

const failed = adversarial.results.filter((result) => !result.passed);
if (failed.length) {
  write();
  write("Adversarial failures");
  for (const result of failed) {
    write(`  ${result.id} (${result.category})`);
    for (const failure of result.failures) write(`      ${failure.kind}: ${failure.detail}`);
  }
}

process.stdout.write(`${lines.join("\n")}\n`);

// Gates. Hard-safety failures are correctness: text the engine was required
// to keep and dropped, text it was required not to create and created, a
// semantic failure, or a protected-content failure. Everything else --
// quality misses, no-ops, retry exhaustion -- is reported loudly and does NOT
// gate, because docs/BENCHMARKS.md says those budgets must be calibrated
// against a baseline and no baseline has calibrated them. Do not add a gate
// here by inventing a number, and do not remove one to turn a run green.
if (release.semanticFailures > 0 || release.protectedContentFailures > 0 || adversarial.hardSafetyFailures > 0) {
  process.exitCode = 1;
}
