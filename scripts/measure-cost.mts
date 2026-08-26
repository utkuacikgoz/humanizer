// `npm run measure:cost` — turns docs/BENCHMARKS.md's modelled cost table
// into a measured one.
//
// It sweeps `output_config.effort`, runs real rewrites through the real
// pipeline, and reports, per level, what the provider actually charged and
// how often the pipeline rejected the candidate. Those two numbers have to be
// read together: a cheaper effort that gets rejected more often is resampled
// more often, and two calls at `low` cost more than one at `medium`.
//
// It measures. It does not decide. Which effort, which model, which price and
// which allowance are decisions for the owner (docs/MONETIZATION.md); this
// script exists so those decisions are made against figures instead of
// arithmetic.
//
// WITHOUT A KEY IT REFUSES. It never prints a modelled number under a
// measured heading — that is the failure this whole exercise is correcting.
import { HUMANIZATION_BENCHMARK_PASSAGES } from "../benchmarks/humanization-passages";
import { pricingConfig } from "../src/config/pricing";
import { createHumanizationPipeline, countWords, HumanizationFailedError } from "../src/lib/humanization";
import type { VerificationProvider, VerificationRequest, VerificationResult, WritingMode } from "../src/lib/humanization/types";
import { DeterministicVerificationProvider } from "../src/lib/humanization/verification";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];

function flag(name: string): string | undefined {
  return process.argv.find((argument) => argument.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

const dryRun = process.argv.includes("--dry-run");
const model = (flag("model") ?? "claude-opus-5") as "claude-opus-5" | "claude-sonnet-5" | "claude-haiku-4-5";
const efforts = (flag("efforts")?.split(",").map((value) => value.trim()) ?? [...EFFORTS]) as Effort[];
const sampleLimit = Number(flag("samples") ?? 10);
const mode = (flag("mode") ?? "natural") as WritingMode;
const corpusKind = flag("corpus") ?? "composed";
const extraBetas = flag("betas")?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];

for (const effort of efforts) {
  if (!(EFFORTS as readonly string[]).includes(effort)) {
    process.stderr.write(`Unknown effort ${JSON.stringify(effort)}. Valid: ${EFFORTS.join(", ")}\n`);
    process.exit(2);
  }
}

/**
 * The corpus problem, stated rather than papered over.
 *
 * The release set's 100 passages have a median of 20 words. The product
 * accepts 200-300. Cost per rewrite is dominated by a fixed prompt overhead —
 * a ~1,500 token system prefix, plus however much thinking the model does
 * regardless of length — so a 20-word passage pays nearly a full rewrite's
 * price for a twelfth of the words. Extrapolating cost per 1,000 words from
 * the raw corpus therefore reports a figure several times worse than the
 * product will really see.
 *
 * So the default corpus is COMPOSED: same-category passages joined into
 * documents of 200-300 words, matching what the route actually accepts. They
 * are project-owned, purpose-written text either way, and joining them
 * changes nothing about provenance. They are used ONLY for cost measurement
 * and never as a quality gate — the release set stays frozen and unjoined.
 *
 * `--corpus=raw` measures the unjoined passages instead. Both are reported
 * with their word distribution so the reader can see which one they are
 * looking at.
 */
function composedCorpus(): Array<{ id: string; text: string; words: number }> {
  const byCategory = new Map<string, string[]>();
  for (const passage of HUMANIZATION_BENCHMARK_PASSAGES) {
    byCategory.set(passage.category, [...(byCategory.get(passage.category) ?? []), passage.text]);
  }
  const documents: Array<{ id: string; text: string; words: number }> = [];
  for (const [category, texts] of byCategory) {
    let buffer: string[] = [];
    let words = 0;
    let index = 1;
    const flush = () => {
      if (!buffer.length) return;
      documents.push({ id: `${category}-${index}`, text: buffer.join(" "), words });
      index += 1;
      buffer = [];
      words = 0;
    };
    for (const text of texts) {
      buffer.push(text);
      words += countWords(text);
      if (words >= 200) flush();
    }
    // A tail under 200 words is still closer to a real document than a
    // 20-word fragment, so it is kept rather than discarded.
    if (words >= 120) flush();
  }
  return documents;
}

function rawCorpus(): Array<{ id: string; text: string; words: number }> {
  return HUMANIZATION_BENCHMARK_PASSAGES.map((passage) => ({
    id: passage.id,
    text: passage.text,
    words: countWords(passage.text),
  }));
}

const corpus = (corpusKind === "raw" ? rawCorpus() : composedCorpus()).slice(0, sampleLimit);
if (!corpus.length) {
  process.stderr.write("The corpus selection produced no documents.\n");
  process.exit(2);
}

/** Counts verdicts. The rejection rate is half of what decides an effort level. */
class CountingVerifier implements VerificationProvider {
  readonly name = "deterministic-semantic-v1";
  private readonly inner = new DeterministicVerificationProvider();
  verdicts = 0;
  rejections = 0;

  async verify(request: VerificationRequest): Promise<VerificationResult> {
    const result = await this.inner.verify(request);
    this.verdicts += 1;
    if (!result.passed) this.rejections += 1;
    return result;
  }
}

interface Sample {
  costUsd: number;
  words: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  thinkingTokens: number;
  thinkingReported: boolean;
  attempts: number;
  latencyMs: number;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

/**
 * The 95th percentile by nearest-rank.
 *
 * At the default sample size this IS the maximum, and the report says so
 * rather than dressing an order statistic up as a distribution.
 */
function p95(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];
}

const lines: string[] = [];
const write = (line = "") => lines.push(line);

const corpusWords = corpus.map((document) => document.words).sort((a, b) => a - b);

// --dry-run shows WHAT would be measured and how many calls it would take,
// and makes no API call. It prints no cost figure of any kind: there is no
// honest cost number to print without having spent the money, and a plausible
// one under this heading is the exact failure this script exists to prevent.
if (dryRun) {
  process.stdout.write(`${[
    "DRY RUN — nothing was measured and no API call was made.",
    "",
    JSON.stringify({
      model,
      mode,
      efforts,
      corpus: corpusKind,
      documents: corpus.length,
      wordsPerDocument: {
        min: corpusWords[0],
        median: corpusWords[Math.floor(corpusWords.length / 2)],
        max: corpusWords[corpusWords.length - 1],
      },
      plannedCalls: corpus.length * efforts.length,
      documentIds: corpus.map((document) => document.id),
    }, null, 2),
    "",
    "Re-run with ANTHROPIC_API_KEY set and without --dry-run to measure.",
    "",
  ].join("\n")}`);
  process.exit(0);
}

const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
if (!apiKey) {
  process.stderr.write(
    [
      "measure:cost needs a real ANTHROPIC_API_KEY. It makes real API calls and reports real usage.",
      "",
      "It will not fall back to the deterministic provider and it will not print the modelled",
      "figures from docs/BENCHMARKS.md, because a modelled number under a measured heading is",
      "exactly the problem this script exists to fix.",
      "",
      "  ANTHROPIC_API_KEY=... npm run measure:cost",
      "",
      "Options: --model=claude-opus-5 --efforts=low,medium --samples=10 --mode=natural",
      "         --corpus=composed|raw --betas=thinking-token-count-2026-05-13 --dry-run",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

write("MEASURED — every figure below comes from provider-reported usage on real API calls.");
write();
write(JSON.stringify({
  model,
  mode,
  efforts,
  corpus: corpusKind,
  documents: corpus.length,
  wordsPerDocument: {
    min: corpusWords[0],
    median: corpusWords[Math.floor(corpusWords.length / 2)],
    max: corpusWords[corpusWords.length - 1],
  },
  plannedCalls: corpus.length * efforts.length,
  extraBetas,
}, null, 2));
if (corpusKind === "raw") {
  write();
  write("WARNING: --corpus=raw. The release set's median passage is 20 words against the");
  write("200-300 the product accepts. Fixed prompt overhead and thinking do not shrink with");
  write("the document, so cost per 1,000 words from this corpus is several times worse than");
  write("the product will see. Use it to compare efforts, never to project a plan's economics.");
}

interface EffortResult {
  effort: Effort;
  samples: Sample[];
  failures: number;
  verdicts: number;
  rejections: number;
}

const results: EffortResult[] = [];
const { ClaudeHumanizationProvider, createAnthropicMessagesClient } = await import("../src/lib/humanization/claude-provider");
const client = createAnthropicMessagesClient({ apiKey, timeoutMs: 180_000 });

for (const effort of efforts) {
  const verifier = new CountingVerifier();
  const pipeline = createHumanizationPipeline({
    humanizationProvider: new ClaudeHumanizationProvider({
      client,
      model,
      effort,
      ...(extraBetas.length ? { extraBetas } : {}),
    }),
    verificationProvider: verifier,
    config: { providerTimeoutMs: 180_000 },
  });

  const samples: Sample[] = [];
  let failures = 0;
  for (const document of corpus) {
    try {
      const result = await pipeline.humanize({ text: document.text, mode });
      samples.push({
        costUsd: result.metrics.providerCostUsd,
        // The words the customer would actually be debited. A rewrite the
        // pipeline rejected debits nothing and is counted as a failure below.
        words: result.metrics.successfulWords,
        inputTokens: result.metrics.inputTokens,
        outputTokens: result.metrics.outputTokens,
        cachedInputTokens: result.metrics.cachedInputTokens,
        thinkingTokens: result.metrics.thinkingTokens,
        thinkingReported: result.metrics.thinkingTokens > 0,
        attempts: result.metrics.attempts,
        latencyMs: result.metrics.latencyMs,
      });
    } catch (error) {
      failures += 1;
      // Cost is still real on a failure; the pipeline does not surface usage
      // from a rewrite it could not return, so it is absent here rather than
      // guessed. Noted in the report.
      if (!(error instanceof HumanizationFailedError)) {
        process.stderr.write(`  ${document.id} at ${effort}: unexpected failure\n`);
      }
    }
    // Progress on stderr so a long sweep is watchable and stoppable, and so
    // stdout stays a clean report.
    process.stderr.write(".");
  }
  process.stderr.write("\n");
  results.push({ effort, samples, failures, verdicts: verifier.verdicts, rejections: verifier.rejections });
}

const starter = pricingConfig.plans.starter;
const pro = pricingConfig.plans.pro;

write();
write("Per effort level");
for (const result of results) {
  const { samples } = result;
  const costs = samples.map((sample) => sample.costUsd);
  const meanWords = mean(samples.map((sample) => sample.words));
  const meanCost = mean(costs);
  const thinkingUnreported = samples.length > 0 && samples.every((sample) => !sample.thinkingReported);

  // A customer consumes an allowance as documents, not as tokens. Calls
  // needed = allowance / mean successful words per rewrite, and each call
  // costs the measured mean. Failures are excluded from meanWords by
  // construction (they never became samples) but their cost is real, so the
  // projection is a floor, not a ceiling.
  const project = (allowanceWords: number) => (meanWords > 0 ? (allowanceWords / meanWords) * meanCost : Number.NaN);
  const starterCost = project(starter.wordLimit);
  const proCost = project(pro.wordLimit);
  const margin = (price: number, cost: number) => (Number.isFinite(cost) ? Number((((price - cost) / price) * 100).toFixed(1)) : null);

  write();
  write(`  effort=${result.effort}`);
  write(JSON.stringify({
    rewrites: samples.length,
    failures: result.failures,
    verificationRejectionRate: result.verdicts ? Number((result.rejections / result.verdicts).toFixed(4)) : null,
    meanAttempts: Number(mean(samples.map((sample) => sample.attempts)).toFixed(3)),
    tokens: {
      thinking: { mean: Math.round(mean(samples.map((s) => s.thinkingTokens))), p95: p95(samples.map((s) => s.thinkingTokens)) },
      input: { mean: Math.round(mean(samples.map((s) => s.inputTokens))), p95: p95(samples.map((s) => s.inputTokens)) },
      output: { mean: Math.round(mean(samples.map((s) => s.outputTokens))), p95: p95(samples.map((s) => s.outputTokens)) },
      cachedInput: { mean: Math.round(mean(samples.map((s) => s.cachedInputTokens))), p95: p95(samples.map((s) => s.cachedInputTokens)) },
    },
    cachedInputShare: Number((mean(samples.map((s) => (s.inputTokens ? s.cachedInputTokens / s.inputTokens : 0)))).toFixed(4)),
    meanWordsPerRewrite: Number(meanWords.toFixed(1)),
    costPerRewriteUsd: Number(meanCost.toFixed(6)),
    costPerRewriteP95Usd: Number(p95(costs).toFixed(6)),
    costPer1000WordsUsd: meanWords > 0 ? Number(((meanCost / meanWords) * 1000).toFixed(6)) : null,
    meanLatencyMs: Math.round(mean(samples.map((s) => s.latencyMs))),
    projection: {
      [`${starter.name} (${starter.wordLimit} words, $${starter.monthlyPrice})`]: {
        inferenceUsd: Number(starterCost.toFixed(2)),
        grossMarginPercent: margin(starter.monthlyPrice, starterCost),
      },
      [`${pro.name} (${pro.wordLimit} words, $${pro.monthlyPrice})`]: {
        inferenceUsd: Number(proCost.toFixed(2)),
        grossMarginPercent: margin(pro.monthlyPrice, proCost),
      },
    },
  }, null, 2));
  if (thinkingUnreported) {
    write("  NOTE: no thinking tokens were reported. The cost figures are still real, but the");
    write("  reasoning share of them is unknown. Retry with --betas=thinking-token-count-2026-05-13.");
  }
}

write();
write("How to read this");
write("  * Rejection rate and cost belong together. A cheaper effort that fails verification");
write("    more often is resampled more often; check meanAttempts alongside costPerRewriteUsd.");
write("  * p95 at this sample size is the maximum observed, not a distribution.");
write("  * cachedInputShare near zero means the cached prefix stopped matching and the input");
write("    bill roughly tripled. That is a bug, not a price.");
write("  * The projection assumes an allowance consumed as documents of the measured mean");
write("    length. Failed rewrites cost money and deliver no words, so it is a floor.");
write("  * These numbers do not choose an effort, a model, a price or an allowance. See");
write("    docs/MONETIZATION.md for what each outcome implies and whose decision it is.");

process.stdout.write(`${lines.join("\n")}\n`);
