import { HUMANIZATION_BENCHMARK_PASSAGES } from "../benchmarks/humanization-passages";
import { runHumanizationBenchmark } from "../src/lib/humanization";

const summary = await runHumanizationBenchmark(HUMANIZATION_BENCHMARK_PASSAGES);
const printable = {
  passages: summary.passages,
  passed: summary.passed,
  semanticFailures: summary.semanticFailures,
  protectedContentFailures: summary.protectedContentFailures,
  averageNaturalness: summary.averageNaturalness,
  averageLatencyMs: summary.averageLatencyMs,
  estimatedTokens: summary.estimatedTokens,
  estimatedCostUsd: summary.estimatedCostUsd,
};

process.stdout.write(`${JSON.stringify(printable, null, 2)}\n`);
if (summary.semanticFailures > 0 || summary.protectedContentFailures > 0) process.exitCode = 1;
