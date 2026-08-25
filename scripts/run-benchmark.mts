import { HUMANIZATION_ADVERSARIAL_PASSAGES } from "../benchmarks/humanization-adversarial";
import { HUMANIZATION_BENCHMARK_PASSAGES } from "../benchmarks/humanization-passages";
import { runAdversarialBenchmark, runHumanizationBenchmark } from "../src/lib/humanization";

const release = await runHumanizationBenchmark(HUMANIZATION_BENCHMARK_PASSAGES);
const adversarial = await runAdversarialBenchmark(HUMANIZATION_ADVERSARIAL_PASSAGES);

const lines: string[] = [];
const write = (line = "") => lines.push(line);

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
