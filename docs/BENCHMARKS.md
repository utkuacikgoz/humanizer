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
