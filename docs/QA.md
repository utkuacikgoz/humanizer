# Quality Assurance and Release Gates

Last updated: 2026-08-23
Owners: Automated QA and Manual QA

## Quality strategy

QA protects four product promises independently: natural writing, meaning preservation, protected-content integrity, and paid access correctness. A passing aggregate score cannot hide a semantic, security, billing, or category-specific failure.

Test at the cheapest faithful layer, then cover critical journeys end to end. AI behavior is evaluated statistically on frozen fixtures; deterministic orchestration, authorization, billing, quotas, and response shaping must remain conventionally testable.

Every test artifact records application commit, environment, provider/model, prompt/pipeline/threshold/catalog versions, fixture version, start time, and pass/fail summary. Never put customer writing into test fixtures.

## Automated suites

### Unit and property tests

- Unicode-aware normalization and word counting: whitespace, apostrophes, hyphens, emoji, CJK, RTL/bidi, zero-width characters, URLs, citations, and code.
- Input byte/word/mode validation and canonicalization.
- Protected-content spans, placeholder collision/round-trip, duplicate values, overlapping entities, and deterministic comparison.
- Diff/preview clipping proves hidden text cannot be reconstructed.
- Trust-label threshold boundaries and version selection.
- Job state machine permits only valid transitions and bounded retries.
- Catalog public projection contains no secret Stripe IDs and plan mapping rejects unknown/mismatched environments.
- Usage ledger arithmetic and invariants under generated event sequences.
- Safe return URL and identifier parsing.
- Log/analytics serializers reject content-bearing fields.

Use property-based tests for placeholder round-trips, ledger event sequences, idempotent operations, and hostile Unicode where practical.

### Provider contract tests

Run every adapter against recorded redacted fixtures and a controlled sandbox provider:

- Strict structured response validation.
- Timeout, abort, malformed JSON/schema, oversized result, content filter/refusal, rate limit, provider 4xx/5xx, and network failure mapping.
- Token/latency/cost metadata normalization.
- No provider-specific object crosses the domain interface.
- User prompt injection cannot alter system contract or request tools/secrets.

Live provider contract tests are non-blocking on ordinary local runs but required in the production-like release suite.

### Pipeline integration tests

- All four modes and Natural default.
- Analysis leaves acceptable sections unchanged and targets documented writing problems.
- Every protected-content class survives: people, organizations, products, dates, numbers, percentages, currency, quotations, citations, URLs, technical terms, code, references.
- Detect added, removed, and changed claims; entity/quantity/date/citation/relationship/conclusion drift.
- Failed sections retry without rewriting passing sections; retries are bounded.
- Verification/evaluation failure exposes no candidate and commits zero successful words.
- Provider transient failure resumes idempotently; duplicate submission returns the original job.
- Attempted/successful words and cost telemetry remain distinct.
- Full result exists server-side but preview projection contains only allowed fields.

### Repository/API authorization tests

For every create/read/update/delete action, cover owner, different authenticated user, valid anonymous capability, expired/revoked capability, missing identity, malformed/guessed IDs, and service/reconciliation role where applicable. Assert both response and storage side effects. History list tests must prove no cross-user rows under pagination/filter/sort variations.

### Billing and quota integration tests

- Checkout Session accepts only server catalog plans and binds the intended job/account.
- Same idempotency key cannot create inconsistent sessions.
- Success/cancel query parameters and forged session/customer/price IDs never unlock.
- Webhook rejects invalid/missing signature, wrong secret/mode, modified body, and stale timestamp.
- Duplicate and reordered events are side-effect-idempotent and converge to current Stripe state.
- Subscription create/update/upgrade/downgrade/cancel/payment-failure/resume/end states map correctly.
- Webhook lag displays pending confirmation and later unlocks the preserved job.
- Billing portal cannot be opened for another customer's ID.
- Concurrent reservations at one word below/at/above quota never overspend.
- Failed attempts/retries release reservation and debit zero; successful replay debits once.
- Period boundary and plan change semantics use a controllable clock.

Use Stripe test clocks/fixtures or equivalent controlled test mechanisms; do not depend on wall-clock sleeps.

### Browser end-to-end tests

Critical journeys:

1. Anonymous visitor pastes valid text, selects each mode, receives a verified partial preview, starts checkout, authenticates/pays, returns to the same unlocked result, copies, and completes a second generation.
2. Refresh/back/forward across processing, preview, checkout, pending confirmation, and unlocked result without loss or double charge.
3. Payment canceled/failed/recovered, subscription canceled at period end, and quota exhausted.
4. Paid history access/delete, sentence restore/regenerate, protected phrase, and account deletion.
5. Mobile and keyboard-only flow with accessible announcements/focus.

Network assertions confirm that hidden output is not present before unlock and writing is absent from analytics requests/URLs.

### Security and abuse automation

- XSS/HTML/SVG/Markdown/event-handler corpus through every rendering surface.
- SQL/injection-like identifiers and malformed request bodies.
- Prompt-injection and instruction-smuggling corpus.
- Payload boundary and computational complexity tests.
- Rate-limit tests across headers, identities, capabilities, IP representations, endpoints, methods, and concurrent calls.
- Client bundle/source-map secret and Stripe-secret scan.
- Dependency and license/security scan under documented triage policy.
- Log capture assertion for absence of source/output/secret/provider payload.

### Benchmark/regression suite

Follow `BENCHMARKS.md`. Run a small deterministic smoke subset on each change affecting the engine and the full frozen suite for every material prompt/model/provider/pipeline/threshold change and every release candidate.

## Manual destructive test charter

Execute on supported desktop and mobile browsers, with normal, slow, offline-transition, and interrupted networks.

Input corpus:

- Empty, whitespace-only, below-minimum, exactly at limit, one word over, byte-heavy Unicode, giant paste.
- Malformed Unicode, bidi/control/zero-width, emojis, smart punctuation, mixed scripts, multiple languages, non-native English.
- HTML/script/SVG/Markdown, prompt injection, fake system messages, JSON/XML, code fences, SQL, shell commands.
- Citation-heavy academic text, URLs with punctuation/query strings, footnotes/references, number/currency/percentage/date-heavy text.
- Technical terms, product/company/person names, quotations, acronyms, repeated protected values, ambiguous pronouns.
- Casual, professional, academic, marketing, obvious AI prose, and already-natural prose.

Interaction charter:

- Paste/clear/replace, rapid mode switching, double and multi-click Humanize/Checkout/Copy/Regenerate.
- Refresh, duplicate tab, back/forward, expired capability/session, sign in as a different user, logout/login, stale tab.
- Resize, 200% zoom, keyboard-only, screen reader spot check, reduced motion, high contrast, long words.
- Provider timeout/refusal/partial failure, webhook delay/replay, failed payment, cancel/upgrade, quota at exact boundary, concurrent tabs.
- Inspect page source, network responses, RSC data, local/session storage, clipboard behavior, URLs, logs, and analytics for locked or sensitive text.

Defect reports include build/environment, account/subscription state, sanitized fixture ID, exact steps, expected/actual, reproducibility, severity, screenshot/video/network evidence as safe, and suspected invariant. Never attach real customer documents.

## Severity and triage

- Critical: cross-user data, secret/payment compromise, forged paid access, broad destructive loss, or invalid meaning presented as verified at systemic scale. Release blocked.
- High: full-result leakage, quota overcharge, webhook integrity failure, stored/reflected XSS, meaningful auth bypass, unbounded material abuse, deletion misrepresentation, or benchmark safety threshold breach. Release blocked.
- Medium: material workflow/accessibility/reliability defect with a workaround or contained security/privacy risk. Requires owner/date and Product/Security acceptance if shipping.
- Low: limited cosmetic/content issue without material trust, access, or task impact.

Flaky blocking tests are failures. Quarantine requires owner, cause hypothesis, expiry date, and replacement coverage; never rerun until green without investigation.

## Phase exit gates

### M0 gate

- Product scope, architecture, provider contracts, data model, threat model, catalog/brand design, benchmark schema, and QA plan reviewed.
- Every open architecture disagreement has an owner and resolution milestone.
- No M1 implementation depends on an unstated product or security decision.

### M1 gate — verified preview

- Full benchmark meets blocking thresholds in `BENCHMARKS.md` and has no unexplained category regression.
- Protected-content and semantic failures never reach a preview in automated fault injection.
- Retry bounds, idempotency, input limits, abuse controls, and terminal zero-charge behavior pass.
- Network/render/storage inspection proves the hidden result is not shipped.
- Core input/result states pass responsive keyboard/accessibility review.
- No critical/high security finding in the preview surface.

### M2 gate — paid unlock

- Stripe test-mode end-to-end journey returns to and unlocks the original result only after verified entitlement.
- Signature, replay, ordering, environment mismatch, redirect forgery, and webhook-lag tests pass.
- Quota property/concurrency tests prove no double debit/overspend and zero debit on failure/retry.
- Cancellation/payment failure/upgrade/billing portal behavior matches disclosed policy.
- No critical/high auth, billing, paywall, or quota finding.

### M3 gate — paid workflow

- History/sentence/protected-term/deletion/second-use flows pass owner and cross-user tests.
- Required analytics events are correct, deduplicated, and content-free.
- Manual destructive suite has no open critical/high defect; accepted medium defects are documented.
- Accessibility and supported mobile/desktop checks pass.
- Data deletion and retention jobs complete under fault/retry scenarios.

### M4 release gate

All of the following must be true:

- Clean production-like build, lint, type, unit, contract, integration, E2E, billing, security, and benchmark runs with retained reports.
- Frozen production provider/config passes benchmark safety, quality, latency, and cost budgets.
- No open critical/high defect or vulnerability; medium risks have signed acceptance and dates.
- Production secrets/environment isolation, CSP/security headers, rate limits, alerts, backup/deletion behavior, and Stripe reconciliation are verified.
- Legal approves third-party AI, privacy/retention/deletion, recurring payment, cancellation, and claim language.
- Monetization audit finds no result leakage, entitlement/quota error, unavailable-feature misrepresentation, or dark pattern.
- Rollback/provider-disable/webhook-replay/reconciliation/key-rotation incident runbooks are exercised and owned.
- PO, HE, MON, AQA, SEC, and LEGAL record sign-off.

## Post-release smoke and monitoring

After each deploy, use synthetic, non-customer text to verify landing, preview, payment test path where safe, unlock, copy, and provider health. Monitor semantic/protected-content failure rates, provider p95/error/cost, webhook lag/failure, checkout-to-unlock failure, reservation age, quota invariant violations, cross-user authorization alerts, and analytics funnel discontinuities. Auto-disable or roll back a provider/config when a defined safety threshold is breached; do not mask the breach by lowering thresholds.

## Known issues (open, 2026-08-24)

### KI-01 — a cosmetic-only rewrite is still sold

`tests/e2e/unchanged-guard.e2e.test.mts` ("a rewrite whose only edit is
cosmetic is not sold as a rewrite") fails against the running app:

```
hiddenWordCount=19, issuesImproved=0 — purchase control still rendered
```

ACT-01's `isMateriallyUnchanged` compares normalized full text, so it catches
a byte-identical rewrite. It does not catch a rewrite whose only change is
cosmetic — here the post-processing rule that deletes whitespace before
punctuation. The text differs, so the guard passes it, and the paywall is
offered over a rewrite the engine itself measured as zero improvements.

That is the same honesty problem ACT-01 exists to prevent: charging for a
rewrite that did not improve anything. `docs/MONETIZATION.md`'s dark-pattern
rules apply.

Likely fix: gate the unlock on measured `improvements > 0` as well as on
material change, so the two signals must agree before anything is sold.
Needs PO sign-off, since it changes what is sellable.

### KI-02 — six E2E tests unverified

Tests 4, 5, 13, 14, 16 and 19 (accessibility roles/landmarks, live-region
announcement, non-JSON error handling, dropped connection, post-purchase
status resolution, paste truncation) fail. MQA was cut off by a session limit
mid-run, so these were never triaged — each is either a real defect or an
incomplete test, and which is unknown. They must be resolved before the M1
accessibility and error-handling gates can be considered.
