# Quality Assurance and Release Gates

Last updated: 2026-08-25
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

Implemented in `tests/e2e/` (browser, requires `npm run dev` and Chromium):

| Journey | Coverage |
|---|---|
| 1 Anonymous paste → modes → preview → paywall disclosure | `anonymous-journey.e2e.test.mts`. Live Stripe checkout, sign-in, unlock, and a paid second generation are not automated (need test-mode secrets). A second *preview* in the same visit is covered. |
| 2 Refresh/back/forward without loss | Not covered. Preview lives in React state only; D-004 forbids storing writing in `sessionStorage`. Server capability redemption exists (`GET /api/preview`) but the landing page does not restore from it yet. |
| 3 Payment canceled / failed / recovered, cancel-at-period-end, quota exhausted | Cancel return: `recovery.e2e.test.mts` (`/?checkout=canceled`). Failed/recovered payment, subscription end, and quota exhaustion are not browser-covered. |
| 4 History, sentence restore, protected phrases, account deletion | History list/detail/delete: `signed-in-journey.e2e.test.mts` and `session-integrity.e2e.test.mts`. Sentence restore/regenerate, protected phrases and account deletion are not browser-covered. |
| 5 Mobile and keyboard | `responsive.e2e.test.mts`, `accessibility.e2e.test.mts`, `signed-in-accessibility.e2e.test.mts`. |
| 6 Signed-in journey: request a link → redeem → rewrite → history → delete → sign out | `signed-in-journey.e2e.test.mts`, `session-integrity.e2e.test.mts`. |

Also covered: locked-remainder leak checks, hostile input, unchanged/cosmetic un-sellable guards, activation landing, paid-result copy (API mocked), error/rate-limit UX.

Not covered by the signed-in suite, and known to be gaps rather than oversights:

- **The "check your inbox" success path.** A local dev server has no `RESEND_API_KEY`, so `POST /api/auth/request-link` answers `503` by design ("never return 'check your inbox' for mail nobody sent"). The enumeration test asserts the property that matters — a registered and an unregistered address produce byte-identical status, body and headers — and it asserts it in whichever configuration the server is in, including the `200` one. But on an unconfigured machine the bytes being compared are the `503`'s. The `200` path's equality is pinned by `tests/magic-link.test.mts` at the unit layer.
- **Rate limiting on sign-in.** `MAGIC_LINK_LIMITS` (5 links per address per hour, 15 per client) is not exercised in the browser; doing so would poison the shared local database for every later test in the run.
- **Session expiry.** `SESSION_TTL_MS` is 30 days and there is no injectable clock on the browser path.
- **Real Stripe checkout.** Entitlements are seeded rather than purchased, so the checkout redirect, the webhook, and the claim transaction are unit-covered only.
- **Multi-device sign-out.** Sign-out ends the session it was presented with; that one session is proven dead server-side by replaying its exact cookie. Whether a second device's session survives is untested.

KI-01 and KI-02 are resolved (2026-08-24). Do not treat a green summary line as proof the suite ran in a browser — check that tests are not skipped (`environmentBlocker`).

#### Signing a browser in without sending mail

Sign-in is an emailed magic link, so the browser suite has to obtain a credential that normally only an inbox ever sees. Three seams were considered and `tests/e2e/helpers/identity.mts` records the reasoning; the short form:

- **Reading the token's row back out of the local D1 is impossible**, and deliberately so. `auth_magic_link_tokens` stores `sha256(token)` and never the token (`db/auth-repository.ts`). Changing that to make a test work would destroy the property the table exists to provide.
- **Injecting a recording `EmailSender`** is the seam `src/lib/email-sender.ts` was designed for, but the sender is resolved per request from the Workers `env` inside `app/api/auth/auth-deps.ts`. Reaching it from a browser test means editing that production module *and* adding a channel to read the recording back out of the Worker — more new production surface than the thing under test, and surface whose only purpose is to be a sign-in bypass.
- **What the suite actually does:** the test mints the token itself and writes its digest into the same table `insertMagicLinkToken` writes, then hands the raw token to the browser as a URL. Delivery, and only delivery, is substituted. `GET /api/auth/verify`, the single-use guarded `UPDATE`, account creation, session issuance and the `Set-Cookie` are all the unmodified production path.

**There is no production change and therefore no test-only flag to audit.** The only privilege the helper needs is write access to the dev server's own SQLite file under `.wrangler/state`, which is a developer-machine artifact that does not exist in a deployed Worker. Entitlements are seeded the same way: a `subscriptions` row identical in shape to the one the Stripe webhook writes, read back by the unmodified `getActiveEntitlement`. The plan is chosen at run time from `pricingConfig` rather than named, and nothing in the signed-in suite asserts a price, an allowance or a plan name.

Rules the helper keeps, and which any change to it must keep: a raw token, a session id and a cookie value are never printed, never written to a file, and never interpolated into an assertion message — failure messages carry shapes, counts and lengths. Every address is synthetic and in the reserved `.test` TLD. The deletion assertion reads stored *lengths*, so it proves the text is gone without ever handling the text.

#### Running the browser suite

- The suite drives a dev server it never starts. `npm run dev` must already be listening on `:3000`.
- A fresh `.wrangler/state` has no tables. Run `npm run db:migrate:local` after the first request that touches `getDb()`, or every signed-in test blocks with a message saying exactly that. Without it `/api/auth/session` answers `503` for any presented cookie and sign-in cannot work at all.
- **A skipped test reports `ok`.** Read `# skipped` in the TAP summary, never the pass count. A run reporting "37 tests, 37 pass" with 37 skips executed nothing. Both `environmentBlocker()` (Chromium, server) and `identityBlocker()` (local D1 schema) must return `null`.
- `waitUntil: "networkidle"` times out on polling pages; `/checkout/success` polls `/api/result`. Use `"domcontentloaded"`.
- `gotoHydrated()` waits for a `POST /api/events` that only `app/page.tsx` and `app/checkout/success/page.tsx` ever send. On `/signin` and `/history` that wait can only end in its own 30-second timeout, so those pages use `gotoReady()` instead.
- Playwright's browser build must match its library version. The harness prefers the project's copy and falls back to a global install whose Chromium actually exists. Do not remove that fallback.

#### Open defects the suite is failing on

These tests fail against real defects and are deliberately left failing rather than weakened. The two accessibility ones are separate tests so the passing traversal coverage is not hidden behind them.

| Test | Defect | Fix |
|---|---|---|
| `every keyboard stop on the sign-in page shows where the keyboard is` | `.signin-input` is the only control on either signed-in page with no visible focus indicator. `app/globals.css` sets `outline: 0` on the base `.signin-input` rule, which has the same specificity as the global `:focus-visible` rule and comes later in the file, so it wins. The only remaining focus cue is a 3%-alpha background tint — a colour-only indicator far below any contrast threshold. WCAG 2.4.7. | Drop `outline: 0` from `.signin-input`, or restate the focus ring under `.signin-input:focus-visible`. |
| `deleting the last history item does not strand keyboard focus` | Deleting the only history item unmounts the row containing the button the customer just pressed, so focus falls to `<body>` and the next Tab restarts from the top of the document. This is the same outcome `app/history/page.tsx` already refuses to accept from the native `disabled` attribute; only the route into it differs. | Move focus to a surviving landmark after the list empties — the `history-title` heading or the empty-state status line. |
| `anonymous visitor: paste, humanize, compare, hit the paywall` | ACT-09: the test asserts a billing/cancel entry point (`#manage-billing`) on the landing page. There is none, on `main` either — a15f919 deliberately moved billing out of the funnel and left only a "Cancel anytime" link to `/terms#manage-billing`. The failure was previously masked by the disclosure assertion above it failing first. | An activation decision, not a test repair: either ACT-09 is satisfied by the link (and the assertion should say so) or the entry point belongs back on the page. Deliberately not decided here. |

None of these is a regression from this suite's changes; all three reproduce against `main`.

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

## Known issues

### KI-01 — a cosmetic-only rewrite is still sold — RESOLVED 2026-08-24

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

Fixed: `shouldOfferUnlock` now requires measured `improvements > 0` as well as
material change, and the humanize route takes the terminal un-sellable path
when the engine measured nothing. Covered by
`tests/security-blockers.test.mts` and `tests/activation-blockers.test.mts`.

### KI-02 — six E2E tests unverified — RESOLVED 2026-08-24

Tests 4, 5, 13, 14, 16 and 19 (accessibility roles/landmarks, live-region
announcement, non-JSON error handling, dropped connection, post-purchase
status resolution, paste truncation) were failing and had never been triaged.

They now pass. The suite is **31/31, 0 skipped**, against a real browser —
verified by checking that no test reported `# SKIP` and that journeys carry
real durations, because a silently-skipping suite reports `ok` too.

Being precise about what happened: these were not individually root-caused.
They were fixed by intervening work — the D1-backed preview guard, the
branding and metadata changes, the client/server word-minimum alignment, and
the KI-01 unlock gate — and this run is the first that could execute them.

The suite was skipping entirely for an unrelated reason: Playwright is pinned
to a version whose Chromium build is not the one provisioned in
`PLAYWRIGHT_BROWSERS_PATH`, so every test skipped with "Chromium is not
installed" and reported `ok`. `tests/e2e/helpers/harness.mts` now falls back
to a globally installed Playwright whose browser actually exists. Worth
knowing: a skipping E2E suite looks identical to a passing one in the summary
line. Check `# skipped` before trusting a green run.
