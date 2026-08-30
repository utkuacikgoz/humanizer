# Humanization Benchmark Specification

Last updated: 2026-08-23
Owner: Humanization Engine Agent, reviewed by Automated QA and Token Optimization

## Purpose

The benchmark determines whether engine changes improve natural writing without silently damaging meaning, protected facts, tone, latency, or economics. It is a release control, not a marketing score and not an AI-detector benchmark.

No customer writing may enter the suite. Use licensed, public-domain, commissioned, or purpose-written passages with provenance recorded.

## Dataset minimum

At least 100 passages, balanced with at least 10 primary examples in each category:

- Obvious ChatGPT-style prose.
- Academic.
- Professional.
- Marketing.
- Casual.
- Technical.
- Non-native English.
- Citation-heavy.
- Number-heavy.
- Long-form.

Passages may carry secondary tags, but primary-category balance is reported. Include already-good text so the engine is penalized for unnecessary rewriting. Include adversarial protected-content and prompt-injection examples across categories rather than as a single easy bucket.

For the V1 anonymous limit, most fixtures should represent 200–300 words. Long-form fixtures can be chunked through the same section contract until larger document support exists; report that distinction and do not pretend V1 supports an unavailable input size.

## Fixture schema

Each version-controlled fixture contains:

- Stable fixture ID and dataset version.
- Primary category and secondary tags.
- Provenance/license and authoring method.
- Source text.
- Intended audience and expected mode(s).
- Expected protected items with category, exact/normalized value, source span when stable, and whether literal preservation is mandatory.
- Atomic factual claims and relationships that must remain.
- Allowed transformations/ambiguities and prohibited changes.
- Known writing-pattern findings or reviewer notes.
- Risk flags: citation, number, code, multilingual, injection, sensitive-like synthetic data.
- Human rating fields and adjudication status.

Expected protected facts are independently reviewed for every appropriate example before the fixture can block release.

Suggested machine-readable shape:

```json
{
  "id": "number-heavy-001",
  "datasetVersion": "1.0.0",
  "primaryCategory": "number-heavy",
  "tags": ["currency", "dates", "percentages"],
  "source": "...",
  "modes": ["natural", "professional"],
  "protected": [
    { "kind": "percentage", "value": "17.5%", "preserve": "literal" }
  ],
  "claims": [
    { "id": "c1", "subject": "...", "relation": "...", "object": "..." }
  ],
  "allowedChanges": ["remove redundant transition"],
  "prohibitedChanges": ["change causal relationship"],
  "provenance": { "type": "purpose-written", "license": "project-owned" }
}
```

Do not place expected “perfect rewrites” into the main assertion path; many rewrites can be valid. References may guide reviewers but semantic and rubric criteria are authoritative.

## Metrics

Report every metric overall, by primary category, by mode, and by relevant risk tag. Include numerator/denominator and confidence intervals where meaningful; do not hide failures behind averages.

### Hard safety metrics

- Protected-content failure rate by type: missing, altered, duplicated, misplaced, or corrupted.
- Semantic failure rate: added, removed, changed claim; altered relationship/conclusion; unsupported certainty; citation mismatch.
- Invalid-output exposure rate: candidate that failed verification/evaluation but reached preview/result.
- Retry exhaustion rate and failure reason.

### Quality metrics

- Naturalness.
- Readability appropriate to audience rather than universally “simpler.”
- Grammar/mechanics.
- Repetition and structural variety.
- Tone/mode adherence.
- Meaning preservation as a separate human rubric.
- Unnecessary-change rate for already-good passages.
- Pairwise preference against the frozen baseline.

Use trained human reviewers blind to configuration where possible. Two reviewers score high-risk fixtures; disagreements on semantic/protected failures are adjudicated by a third reviewer. Record inter-rater agreement. Model-as-judge results may assist triage but cannot be the sole semantic release gate.

### Performance and economics

- End-to-end p50/p95 latency, plus each pipeline stage.
- Input/output/total tokens by stage and retry.
- Estimated and realized cost per humanization and per 1,000 successful words.
- Verification cost and retry cost/share.
- Provider error/refusal/rate-limit frequency.

Separate warm/cold, cached/uncached, and successful/failed requests where applicable.

## Baseline and change protocol

1. Freeze dataset, rubric, providers/models, prompts, temperatures, thresholds, and runtime limits under version identifiers.
2. Run the current production/baseline configuration at least enough times to estimate nondeterministic variance.
3. Run the candidate on the same fixtures and modes under comparable conditions.
4. Blind and randomize human pairwise review.
5. Publish overall and category deltas, confidence/variance, regressions, cost, and latency.
6. Inspect every hard-safety failure; never accept it because the average improved.
7. Approve, reject, or run a targeted experiment. Do not tune against the hidden holdout.
8. Store the report with code/config/dataset versions and decision reference.

Maintain a development set for prompt iteration, a frozen release set, and a small hidden holdout/adversarial set to detect overfitting. Rotate/add fixtures through a reviewed version bump; do not delete inconvenient failures without a documented reason.

## Initial release thresholds

Thresholds are deliberately conservative and must be calibrated after the baseline. Any change requires a decision-log entry and cannot be made merely to turn a failed release green.

Blocking requirements:

- Invalid-output exposure: exactly 0.
- Literal protected values: exactly 0 known unapproved mutations, omissions, or duplications in the release set.
- Critical semantic failures (changed quantities, dates, attribution, polarity, causal relationship, citation linkage, or conclusion): exactly 0 known unapproved failures.
- Overall human-adjudicated semantic pass: at least 99%; no category below 98%. Any residual failure is reviewed and cannot involve a critical semantic class.
- Naturalness pairwise preference versus baseline: candidate must be non-inferior overall and in every category; a claimed improvement requires a predeclared meaningful margin and confidence criterion.
- Tone adherence and grammar: non-inferior overall and no unexplained category regression greater than 2 percentage points.
- Already-good unnecessary-change rate: set the numeric limit after baseline, then treat regression greater than 2 percentage points as blocking.
- Retry exhaustion: set budget after baseline; any increase greater than 1 percentage point or concentration in a protected category requires review.
- p95 latency and cost: must fit the approved product SLO and unit-economics budgets. Until those are calibrated, report as an explicit release risk rather than inventing a limit.

A sample of 100 passages cannot prove rare-event safety statistically. Exact-zero gates mean “no known failure in this suite,” not a claim of universal perfection. Production monitoring and expanding adversarial coverage remain mandatory.

## Naturalness and meaning rubric

Score each dimension independently on a five-point anchored scale:

- 5: strong, natural, audience-appropriate writing; meaning fully preserved.
- 4: minor issue that does not impede trust/use.
- 3: noticeable issue requiring light edit or minor ambiguity.
- 2: material awkwardness, tone miss, or meaning concern.
- 1: unusable, clearly artificial/poor, or materially changed meaning.

Meaning reviewers additionally classify exact failure type and affected claim/protected item. Naturalness reviewers ignore AI-detector predictions and judge the writing itself. Reviewer instructions prohibit rewarding factual additions, stylistic homogenization, or unnecessary rephrasing.

## Report template

Every major engine change reports:

- Candidate hypothesis and exact changed components.
- Baseline/candidate version matrix.
- Dataset split/version and run count.
- Safety metrics overall/by category with failure inventory.
- Human quality rubric and pairwise preference with agreement.
- Latency/token/cost totals and stage breakdown.
- Retry and provider failure distribution.
- Known limitations and confounders.
- Decision: accept, reject, or experiment; owner and date.

## Benchmark maintenance

Add a regression fixture for each production semantic/protected failure using synthetic or permissioned text. Review category balance quarterly or after 25 additions. Audit provenance and expected facts. Keep benchmark text out of analytics and production model-training flows. Access to any licensed non-public corpus follows license and least-privilege requirements.

---

# Recorded runs

## 2026-08-25 — engine hardening (branch `claude/engine-hardening`)

Measured on this branch with `npm run benchmark`. Both numbers below are real
runs, not estimates.

### Release set (frozen, 100 passages)

| | before | after |
|---|---|---|
| passed | 100/100 | 100/100 |
| no-ops (engine returned the input) | not measured | 35/100 |
| semantic failures | 0 | 0 |
| protected-content failures | 0 | 0 |
| average naturalness | 0.8482 | 0.8538 |

Naturalness rose because `splitSentences` stopped dropping text: 23 of the 100
passages contained a stop not followed by whitespace (a decimal, an F1 score,
a version number, a DOI, an `et al.`), and the clause containing it vanished
before analysis ran. Since rewrite targets are derived from those segments, a
dropped sentence was never rewritten at all. **No threshold was changed**, and
none needed to be.

### Adversarial set (25 passages) — **17/25**

| | |
|---|---|
| passed | 17/25 |
| hard-safety failures | 0 |
| retry exhaustion (customer receives an error) | 3 |
| quality misses (AI-tell left in place) | 5 |

17/25 is the honest score and it is the point of the exercise. The release set
scored 100/100 before this work and could not have scored anything else; a
suite nothing fails cannot detect a regression. Do not relax an expectation to
raise this number.

## What 100/100 on the release set does not mean

Three measured reasons the release-set score is close to uninformative on its
own:

1. **28 of the 100 passages declare no expected protected facts.** The pass
   test is "every declared fact survived", and `[].every(...)` is `true`, so
   those 28 pass whatever the engine emits — including the input verbatim.
2. **The engine is a no-op on 35 of the 100 passages**, and all 35 are
   reported as passed. By category:

   | category | passed | no-op |
   |---|---|---|
   | obvious ChatGPT prose | 10/10 | 0/10 |
   | academic | 10/10 | 2/10 |
   | professional | 10/10 | 2/10 |
   | marketing | 10/10 | 2/10 |
   | casual | 10/10 | 3/10 |
   | technical | 10/10 | 3/10 |
   | non-native English | 10/10 | 8/10 |
   | citation-heavy | 10/10 | 5/10 |
   | number-heavy | 10/10 | **10/10** |
   | long-form | 10/10 | 0/10 |

   The engine changes nothing at all in the entire number-heavy category, and
   almost nothing in non-native English, while both report a perfect score.
3. **Passages are a median of 20 words** (min 15, max 72) against this
   document's own requirement that "most fixtures should represent 200–300
   words". The structural checks — repetitive length, repetitive opening,
   predictable paragraph shape — have almost nothing to work on at that size.

`npm run benchmark` now prints the per-category no-op rate alongside the pass
count, so the second point is visible on every run.

## Thresholds are uncalibrated

The six numbers in `DEFAULT_HUMANIZATION_CONFIG.thresholds` (naturalness 0.5,
readability 0.15, grammar 0.8, repetition 0.55, meaningPreservation 0.72,
toneAdherence 0.65) have **no decision-log entry and no calibration record**
anywhere in the repository, though the section above requires both. Observed
margins on the release set:

| threshold | worst observed | threshold | margin |
|---|---|---|---|
| naturalness | 0.5300 | 0.50 | 0.0300 |
| readability | 0.1676 | 0.15 | 0.0176 |
| grammar | 1.0000 | 0.80 | 0.2000 |
| repetition | 0.6400 | 0.55 | 0.0900 |
| meaningPreservation | 0.8457 | 0.72 | 0.1257 |
| toneAdherence | 0.9000 | 0.65 | 0.2500 |

Grammar and tone have so much headroom that a large regression would pass
unnoticed; readability sits 0.0176 above its floor, which is close enough that
an unrelated change can trip it. Calibrating these against a baseline is
outstanding work and remains a release risk, not a solved problem.

## What the deterministic engine cannot do

`DeterministicHumanizationProvider` is a substitution table. It replaces known
phrases with known phrases. That bounds it in ways no amount of tuning
changes, and the adversarial set now documents each one with a failing case:

- **Grammar cannot be repaired.** "Yesterday I go to the bank", "many shop are
  near my apartment", "The employee explain the problem" pass through
  untouched (`adv-nonnative-01`, `adv-nonnative-02`). This is why non-native
  English is 8/10 no-ops.
- **Sentence rhythm cannot be varied.** Analysis reports repetitive-opening
  and repetitive-length; no substitution can restructure a sentence, so the
  gates reject every attempt and the customer receives an error rather than a
  rewrite (`adv-rhythm-01`).
- **Qualifiers and generic conclusions cannot be removed safely.** Dropping
  "very" or replacing "the possibilities are endless" requires judgement about
  emphasis and a specific claim to put in its place (`adv-qualifier-01`,
  `adv-conclusion-01`).
- **Tone is scored but never repaired.** A casual register requested in
  academic mode fails `toneAdherence` on every attempt and exhausts retries
  (`adv-tone-01`).
- **Coverage is a word list.** The robotic-vocabulary marker matches
  `delve/delves/delved into` but not `delving into`, so that passage is not
  even reported as having an issue (`adv-vocab-01`). Every gap of this kind is
  one more entry away, and the list is unbounded.
- **`unnatural-transition` is a declared issue kind with no detector at all.**
  Nothing can ever produce it.

Three of these produce a hard error rather than a graceful "nothing to
change": text the engine cannot improve, carrying four or more detected
issues, fails the naturalness floor and exhausts its retries.

Selecting a real model provider is a separate decision and an M4-01 release
blocker. Nothing in this section is fixable by tuning the rules.

## Segmentation

`splitSentences` in `src/lib/humanization/text.ts` is now the engine's single
segmenter. It is **total** — every character belongs to exactly one segment or
to a whitespace-only gap between two — and that property is asserted over the
whole benchmark corpus in `tests/sentence-segmentation.test.mts`, not against
a handful of fixtures.

M3-03 had added a second segmenter, `segmentSentences` in
`sentence-regeneration.ts`, because changing `splitSentences` moved analysis
targets, readability and the calibrated thresholds, and that needed benchmark
evidence rather than a side effect of shipping sentence editing. That evidence
is the table above, so the two are now **one**: `segmentSentences` is an alias
of `splitSentences`, and `tests/sentence-segmentation.test.mts` asserts they
are the same function so a second one cannot quietly reappear.

Collapsing them fixed a live defect, not just a duplication. The two
segmenters disagreed on **17 of the 125 benchmark passages**, and the
`sentence-regeneration` copy was wrong in every one: its `endsSentence`
treated a stop with nothing alphanumeric in front of it as never ending a
sentence, so a sentence closing `15%.`, `(Li et al., 2024).`, `[14-16].` or
"`` `account_id`. ``" swallowed the sentence after it. Two sentences returned
as one means `sentenceAt(text, 4)` addresses a span twice its intended size,
so "regenerate sentence 4" rewrote two sentences and M3-03's own
one-sentence-in, one-sentence-out invariant failed silently — the quiet
corruption of a paying customer's document that module exists to prevent.

Known limits, shared with any rule-based segmenter and not hidden: a sentence
genuinely ending in an abbreviation followed by a lower-case word is not
split; a sentence ending "at 8 p.m." is not split, because each stop there
follows a single letter and reads as an initial; non-English sentence
conventions are not modelled.

---

# Integrating a real model provider

The interfaces in `src/lib/humanization/types.ts` now carry what a model call
needs. Adding a provider should be a configuration change — construct it and
pass it to `createHumanizationPipeline({ humanizationProvider })` — not a
refactor. **No provider has been selected, no SDK has been added, and no
external API is called from this repository.** That choice is an M4-01 release
blocker and belongs to the product owner.

What is already in place:

- **Prompt construction is the provider's own business.** `RewriteRequest`
  carries structured inputs (text, mode, protected content, analysis, attempt
  number, previous failures); the provider decides how to split them into
  system and user turns. Nothing in the pipeline constrains that.
- **Usage telemetry.** `ProviderUsage` on `RewriteResponse`,
  `VerificationResult` and `EvaluationResult` carries input, output and
  cached-input tokens, cost, and the model id. The pipeline totals them across
  every stage and retry into `UsageMetrics`, which is what this document's
  metrics section requires.
- **Typed provider errors.** `ProviderError` carries a `kind` (`rate-limit`,
  `timeout`, `server`, `invalid-request`, `refusal`, `unknown`), a `retryable`
  flag with sensible defaults, and an optional `retryAfterMs`. A non-retryable
  error stops the pipeline instead of buying the same rejection three times.
- **Per-attempt deadlines.** `providerTimeoutMs` bounds a single call. The
  pipeline awaits on the combined signal, so a provider that ignores the
  signal it was handed still cannot outlive its deadline.
- **Provenance.** Every result records `providers` — the three provider names
  and the models any stage reported.

What integrating one would still require, and none of it is done:

1. **Secrets and configuration.** An API key in the Worker environment, a
   model id, temperature and max-tokens settings, and a `.dev.vars.example`
   entry. Follow the existing secret handling in `docs/ARCHITECTURE.md`.
2. **Backoff.** `retryAfterMs` is carried but nothing sleeps on it. The
   pipeline retries immediately; a real rate limit needs a delay between
   attempts, and the retry budget interacts with the request deadline.
3. **Cost and latency budgets.** `estimatedCostUsd` is 0 for every passage
   today because the deterministic provider is free. The p95 latency and unit
   economics gates in this document cannot be evaluated until a provider
   reports real numbers, and the benchmark's 0.79 ms average latency will stop
   being meaningful the moment a network call is involved.
4. **Bumping `PIPELINE_VERSION`.** Changing the provider changes output for
   previously-generated jobs; the version is persisted on `humanization_jobs`
   so provenance stays reconstructible.
5. **Recalibrating thresholds against the new baseline**, with the decision-log
   entry the change protocol requires. The current six numbers were fitted to
   nothing and a model provider will not produce the same score distribution.
6. **Re-running the adversarial set.** The 8 failures above are capability
   failures of a substitution engine. A model provider should pass most of
   them; the ones it does not are the honest picture of what was bought.
7. **Prompt-injection coverage.** The corpus has none, though this document
   requires adversarial injection examples. Customer text reaching a model is
   an instruction-injection surface that does not exist today.

Streaming is deliberately not part of the seam. The pipeline verifies a
complete candidate before returning it, and this document requires
invalid-output exposure to be exactly zero, so streaming unverified text to a
customer is excluded by the architecture rather than missing from the
interface. A provider may stream internally as long as it resolves a complete
candidate.

## M4-01 — the Claude provider: what was built, and what was measured

Last updated: 2026-08-26. Author: Humanization Engine Agent.

### Status of the seven items above

1. **Secrets and configuration** — done. `ANTHROPIC_API_KEY` is in the deploy
   workflow's env block, its `printf` secrets-file list, the deploy gate and
   the not-configured check, and in `.dev.vars.example`. Selection is explicit:
   `HUMANIZATION_PROVIDER=claude`. A key alone changes nothing.
2. **Backoff** — still not done. `retryAfterMs` is now populated from the
   provider's `Retry-After` header, and nothing still sleeps on it. Unchanged
   from the note above; called out again so it does not look closed.
3. **Cost and latency budgets** — the machinery is done, the numbers are not.
   Real `usage` maps into `ProviderUsage` with the input/output/cached split
   and a computed `costUsd`, and `npm run benchmark` prints cost per rewrite,
   cost per 1,000 words, and the implied margin against the $9.99/50,000-word
   plan. Every figure it printed on this branch is zero, because every run was
   the deterministic provider.
4. **Bumping `PIPELINE_VERSION`** — NOT done. Deliberately: the deterministic
   provider is still what runs by default, so no previously-generated job's
   provenance changed. The bump belongs to the deploy that flips
   `HUMANIZATION_PROVIDER`, not to the commit that adds the option.
5. **Recalibrating thresholds** — NOT done, and not guessable. The six
   thresholds were fitted to nothing and a model will not produce the same
   score distribution. Recalibration needs a measured distribution, and no
   measured distribution exists yet.
6. **Re-running the adversarial set** — NOT done against the model. See below.
7. **Prompt-injection coverage** — done as fixtures and structure. Six
   passages (`adv-injection-01` .. `-06`) and the structural controls in
   `docs/SECURITY.md`'s "Prompt-injection coverage as built". Not yet run
   against a live model.

### Measured on this branch (2026-08-26)

All figures below are the DETERMINISTIC provider. No call to any model API was
made from this branch, at any point, because no API key was reachable from the
environment the work was done in.

| Run | Release set | Adversarial |
| --- | --- | --- |
| Baseline (`main`, before this branch) | 100/100, 0 semantic, 0 protected-content failures, avg naturalness 0.8538, 35 no-ops | 17/25 passed, 0 hard-safety failures, 3 retry exhaustions |
| This branch, deterministic provider | identical: 100/100, 0/0, 0.8538, 35 no-ops | 23/31 passed, 0 hard-safety failures, 3 retry exhaustions |

The adversarial set grew from 25 to 31 passages: the six new prompt-injection
fixtures pass on the deterministic engine, and the original eight failures are
unchanged, so the comparable subset is still 17/25. The set is deliberately
NOT easier — the injection fixtures are safety regressions, not quality
challenges, and they are designed so a provider that starts obeying pasted
instructions fails them.

Cost per rewrite on the deterministic provider is $0.00, which is true and
useless. The margin against $9.99 for 50,000 words is therefore still
unmeasured.

### What still has to be run before this can be judged

With a key in the environment:

```
npm run benchmark -- --provider=claude --model=claude-opus-5   --effort=low
npm run benchmark -- --provider=claude --model=claude-sonnet-5 --effort=low
npm run benchmark -- --provider=claude --model=claude-haiku-4-5 --effort=low
npm run benchmark -- --provider=claude-routed --ladder=claude-sonnet-5,claude-opus-5
```

The change protocol asks for repeated runs to estimate nondeterministic
variance; one run of each is not a baseline. Three things in particular need
answering from the output rather than from intuition:

- **Does verification reject model candidates?** The deterministic verifier
  fails a candidate whose lexical coverage of the source's content terms drops
  below 0.72. A genuine rewrite moves a lot of words. The prompt asks the model
  to keep the source's key nouns and terminology specifically to stay inside
  that gate, and whether it does is an empirical question. If the model's pass
  rate is poor, the fix is the prompt or the verifier's design — not the
  threshold. Lowering 0.72 to make a number look better is exactly the move
  this document forbids.
- **Which two rungs, if any.** The router's default ladder
  (`claude-sonnet-5` -> `claude-opus-5`) is a placeholder, not a measurement.
  Escalation pays for both models, so a high escalation rate makes routing
  more expensive than never routing at all. The benchmark prints the
  escalation rate and the reason breakdown; if blended cost exceeds Opus-only,
  the correct outcome is to leave `HUMANIZATION_MODEL_ROUTING` off and say so.
- **Effort.** The engine defaults to `low`, not the API's `high`. The
  reasoning is in `ClaudeProviderOptions.effort`: humanizing a draft is
  constrained rewriting, and a thinner candidate is safe here specifically
  because the pipeline verifies every one of them before a customer sees it.
  That makes effort a cost/rejection-rate tradeoff rather than a cost/quality
  one, and the figure that settles it is the verification rejection rate —
  measured, alongside cost, by `npm run measure:cost`.

### Fixture length: a gap this work did not close

The release set's 100 passages are 15 to 72 words, median 20 — well under the
200-300 words this document specifies. That matters for economics as much as
for quality: a model call carries a fixed prompt overhead of roughly 1,500
cached system tokens, so cost per 1,000 words extrapolated from 20-word
passages overstates the real per-word cost of a 250-word document by a wide
margin. Any cost figure derived from the current release set must say which it
is. Lengthening the fixtures is a dataset version bump and was out of scope
here.

### Cost per rewrite: modelled, not measured, and the thinking tokens decide it

No key, so no realised cost. What follows is arithmetic over the published
rates and the request this provider actually sends, and it is labelled a model
because that is what it is. Assumptions: a 250-word document (~330 input
tokens, ~330 output tokens), ~120 tokens of protected-span listing, a ~1,500
token system prefix served from cache after the first call of each five-minute
window, cache reads at 0.1x the input rate.

| Thinking tokens per rewrite | Opus 5 | Sonnet 5 | Haiku 4.5 |
| --- | --- | --- | --- |
| 0 | $0.0113 | $0.0045 | $0.0023 |
| 500 | $0.0238 | $0.0095 | $0.0048 |
| 1,500 | $0.0488 | $0.0195 | $0.0098 |
| 3,000 | $0.0863 | $0.0345 | $0.0173 |

Against the Pro plan's 50,000 words for $9.99, the same rows come to $2.25,
$4.75, $9.75 and $17.25 of Opus-5 inference. **That is the finding.** Thinking
tokens are billed as output tokens, adaptive thinking is ON BY DEFAULT on
Opus 5, and at roughly 1,500 thinking tokens per rewrite the plan's entire
price is inference cost. At 3,000 it loses money on every subscriber who uses
their allowance.

So the single most valuable number to measure first is not quality — it is
`usage.output_tokens_details.thinking_tokens` at each effort level. If it is
high, the response is `effort: "low"` or a cheaper rung, decided from the
sweep. Nothing in the pricing table above is a reason to change the plan
price; it is a reason to measure before turning the provider on.

Two caveats on the table. It assumes prompt caching is working — if
`cache_read_input_tokens` comes back zero, the system prefix is charged in
full on every request and the input side roughly triples. And it says nothing
about retries: a rewrite that fails verification and is resampled costs twice,
and an escalated routed rewrite costs both rungs.

### Measured: Sonnet 5, 2026-08-30

The measurement has now run — GitHub Actions run 33325420913, dispatched via
`.github/workflows/measure-cost.yml`, 10 composed documents (183–241 words,
median 202) per effort level on `claude-sonnet-5`, `natural` mode, real
provider-reported usage. 29 of 30 rewrites succeeded; the one failure was a
verification rejection at `medium`, not a provider error.

| effort | cost/rewrite (mean) | cost/1k words | thinking tokens (mean) | rejection rate | mean latency | Starter $9.99 inference | gross margin |
|---|---|---|---|---|---|---|---|
| low | $0.0086 | $0.0425 | 3 | 14.3% | 5.7s | $2.12 | **78.8%** |
| medium | $0.0099 | $0.0488 | 179 | 13.3% | 6.4s | $2.44 | 75.6% |
| high | $0.0259 | $0.1278 | 1,857 | 8.3% | 19.6s | $6.39 | 36.1% |

Pro's margin is identical per effort because both plans price at $0.20/1k
words. The projection is a floor at full-allowance consumption; most
subscribers use a fraction. Cached-input share held at ~64% across all three
levels, so the byte-stable prefix is doing its job.

What the numbers say, without deciding anything (D-014's line): `low` is the
serving candidate — the cheapest level, a rejection rate within a point of
`medium`, near-zero thinking, and a quarter of `high`'s latency. `high` buys
its lower rejection rate at three times the cost and 20-second responses,
which is a poor trade for a product whose verifier already rejects and
resamples. The modelled section below is retained for the reasoning shape,
but this table supersedes its figures.

Getting here took three runs and two fixes worth remembering: the first run
failed 30/30 **silently** (the report printed zeros and exited 0 — fixed, it
now exits 1 and prints per-effort failure reasons), and the cause was
`fallbacks: "default"` being sent to a model that rejects it (fixed via
`serverFallbacks` in `CLAUDE_MODEL_CAPABILITIES`).

### `npm run measure:cost` — replacing the model with a measurement

Added 2026-08-26. Sweeps every effort level against real API calls and prints,
per level: mean and p95 thinking / input / output / cached tokens from
provider-reported usage, measured cost per rewrite, the verification rejection
rate, mean attempts, cached-input share, and both plan allowances priced
beside what they earn.

```
ANTHROPIC_API_KEY=... npm run measure:cost
ANTHROPIC_API_KEY=... npm run measure:cost -- --model=claude-sonnet-5 --efforts=low,medium
npm run measure:cost -- --dry-run    # shows the corpus and call count, no key, no calls
```

**Without a key it refuses** and exits 2. It does not fall back to the
deterministic provider and it does not reprint the modelled table above; a
modelled number under a measured heading is the failure the whole exercise is
correcting. `tests/cost-guard.test.mts` asserts that refusal as a subprocess,
so the suite proves it without a key and without a call.

**On the corpus, honestly.** The release set's median passage is 20 words
against the 200-300 the route accepts. Per-rewrite cost is dominated by fixed
overhead — the cached system prefix and however much the model thinks,
neither of which shrinks with the document — so a 20-word passage pays close
to a full rewrite's price for a twelfth of the words, and cost per 1,000 words
extrapolated from the raw set is several times worse than reality. So the
script's default corpus is **composed**: same-category passages joined into
documents of 200-300 words (10 documents, median 202, range 183-241), which is
what the product actually processes. They are the same project-owned,
purpose-written text; joining changes nothing about provenance. They are used
**only** for cost measurement and never as a quality gate — the release set
stays frozen and unjoined. `--corpus=raw` measures the unjoined passages and
prints a warning saying not to project a plan's economics from them.

The projection is a **floor**, and says so: a rewrite that fails verification
costs money and delivers no billable words, and a routed rewrite that
escalates pays for both rungs.

`thinking_tokens` may come back unreported on some responses. The script says
so explicitly rather than recording zero — "no thinking happened" and "nobody
said" are different claims — and suggests
`--betas=thinking-token-count-2026-05-13`.
