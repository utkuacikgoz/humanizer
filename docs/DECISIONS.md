# Decision Log

Last updated: 2026-08-23

Accepted decisions are durable until replaced by a new dated entry. Implementation discoveries should amend this log rather than silently diverge.

## Accepted

### D-001 — V1 is a paid-first single journey

Decision: Ship only the journey in `PRODUCT.md`; no permanent free tier and no Voice DNA in V1.
Reason: Prove quality, payment, and repeat use before expanding.
Consequence: New dashboard, collaboration, API, and personalization work is rejected or deferred.

### D-002 — Brand is one configuration source

Decision: Customer-facing identity comes from a typed configuration object containing `productName`, `productTagline`, `domain`, `supportEmail`, `legalCompanyName`, and `socialHandles`. Use `Humanizer` only as the centralized temporary display value and `humanizer` as the internal codename.
Reason: Naming is TBD and must not block engineering or create a later search-and-replace migration.
Consequence: Tests should detect customer-facing literals outside the config/assets allowlist.

### D-003 — Pricing and entitlements are a server-owned catalog

Decision: Plans live in one versioned server-owned catalog; UI consumes a public projection and Stripe price IDs come from validated environment bindings.
Reason: Prevent drift, forged allowances, and scattered plan logic.
Consequence: Stripe metadata and client parameters are references, never entitlement authority.

### D-004 — Complete first result is generated before purchase

Decision: Run the complete pipeline server-side, then expose only an approved partial representation until server-confirmed payment.
Reason: Users experience quality before buying while the full product remains paid.
Consequence: Full text must not enter HTML, RSC payloads, analytics, logs, browser storage, or preview responses.

### D-005 — Server-side job is the checkout continuity anchor

Decision: Store the verified job under an opaque ID; bind it to a high-entropy expiring anonymous capability, then transactionally claim it to the authenticated payer.
Reason: Preserve the result without forcing signup while preventing enumeration and theft.
Consequence: Checkout metadata records internal references only; claim tokens are single-use/rotatable and never sufficient to unlock without entitlement.

### D-006 — Subscription and quota state are server-authoritative

Decision: Verified Stripe webhooks update a local entitlement projection. An append-only usage ledger with idempotent reservations/commits controls quota.
Reason: Redirects, frontend state, and mutable counters are forgeable and fail under concurrency.
Consequence: Failed verification and system retries commit zero successful words; projections must be rebuildable/reconcilable.

### D-007 — Invalid candidates are never exposed

Decision: Semantic verification and protected-content checks are hard gates before output or preview. Retry only affected sections within configured attempt/time/cost limits.
Reason: Meaning preservation is the product promise.
Consequence: Terminal failure produces an honest retry path and zero quota debit.

### D-008 — Provider architecture is model-independent

Decision: Extraction, humanization, verification, and evaluation use separate versioned interfaces and can use different providers/models.
Reason: Quality, latency, cost, and semantic accuracy need independent benchmarking.
Consequence: Provider-specific SDK objects do not cross domain interfaces; stored jobs record provider/model/prompt/config versions without storing secret reasoning.

### D-009 — D1 is the initial system of record, subject to a concurrency spike

Decision: Use the starter's Cloudflare/D1 direction for V1 relational state and atomic ledger operations, with object storage only if payload size/retention warrants it. Validate transaction/concurrency semantics before M2.
Reason: It is the boring path in the current deployment skeleton.
Consequence: If the spike cannot prove correct quota concurrency, replace the ledger store before billing work rather than weaken the invariant.

### D-010 — Qualitative trust labels, evidence behind them

Decision: Present bounded labels such as Strong/High with issue counts; retain structured evaluation evidence and configurable thresholds internally.
Reason: Numeric human/detector confidence would imply unjustified scientific precision.
Consequence: Copy and analytics must not translate rubric results into detector-bypass claims.

### D-011 — Data minimization and no training by default

Decision: Do not train on customer writing without a future explicit, unbundled consent mechanism. Do not log documents. Disclose every AI processor that receives text and expose deletion/retention controls.
Reason: Writing can be highly sensitive.
Consequence: Provider settings, contracts, telemetry, support tools, and backups must honor the same boundary.

### D-012 — Benchmarks are a release artifact

Decision: Every material engine change runs the frozen 100+ passage suite and reports semantic, protected-content, quality, latency, and cost metrics by category.
Reason: Anecdotal prompt tuning hides regressions.
Consequence: A gain in one metric cannot waive a blocking regression in another.

### D-014 — Token/context discipline is mandatory, not optional

Decision: TOK owns session token/context spend. Defaults: terse chat replies (bullets over prose, no restating the request); no comment bloat in code (one line max, only for non-obvious WHY); route mechanical/lookup work to cheaper models via subagents instead of doing it inline; avoid re-reading files/re-deriving facts already in context.
Reason: User flagged token spend as a real cost, not a style nit.
Consequence: Applies to every agent's output from this point forward, not just chat replies.

## Proposed; must resolve before named milestone

### D-P01 — Anonymous/result retention duration (before M1)

Proposal: Expire unclaimed anonymous source/output within 24 hours; default paid history retention is user-controlled with a documented maximum and deletion-on-request workflow. Shorter anonymous retention lowers privacy exposure but can hurt delayed checkout recovery. Legal and Product must ratify exact periods.

### D-P02 — Subscription period usage semantics (before M2)

Proposal: Allowance follows Stripe billing period boundaries; upgrades grant the higher current-period allowance without double-crediting prior usage, downgrades apply next period, and unused words do not roll over. Monetization must validate customer clarity and refund implications.

### D-P03 — Past-due access policy (before M2)

Proposal: Keep previously unlocked results readable during a short configured grace period, block new chargeable generations when entitlement becomes non-active, and follow Stripe recovery state. Do not delete history because of payment failure.

### D-P04 — Source/output storage separation and encryption (before M1)

Proposal: Keep searchable metadata in D1 and encrypted text payloads in a separate storage boundary if platform capabilities and payload sizes justify it; otherwise use D1 with strict access functions and minimized retention. Security owns the decision after a platform spike.

### D-P05 — Provider zero-retention availability (before M4)

Proposal: Prefer providers/settings offering no-training and zero/short retention. If unavailable, surface the exact processor retention in the privacy notice and shorten internal retention. Legal and Security must approve the production provider set.

### D-013 — M2 billing is built now against placeholder business/Stripe details

Decision: Product Orchestrator (user) directed engineering to proceed building the full M2 payment/entitlement backlog today without waiting for real legal company name, support email, domain, or live Stripe credentials — those will be supplied later in this same engagement. All such values are wired through environment/config (`productConfig`, `STRIPE_*` env vars, a versioned Stripe price env-key mapping), never hardcoded, so supplying the real values later is a configuration change, not a code change. Placeholder/missing required config must fail closed at startup/checkout time per the existing `ARCHITECTURE.md` "Configuration and secrets" rule — it must never silently accept a real payment against unset business identity.
Reason: User-directed acceleration toward a same-day paid launch; this is the explicit tradeoff being made, not an oversight.
Consequence: The following remain genuinely open and are NOT satisfied by placeholder-driven engineering — they require the user's real values and cannot be closed by code alone: D-P01 (retention duration), D-P04 (payload storage/encryption), D-P05 (provider retention), and M4-03 (Legal disclosure approval). M2-13's payment gate and M4-07's commercial-launch authorization are not self-granted by this decision; PO/SEC/LEGAL sign-off is still required before real customer charges go live, per `AGENTS.md`'s working agreement. This entry exists so a later reviewer sees *why* placeholders are present, rather than mistaking them for an unnoticed gap.

M2-01 through M2-06, M2-08, M2-09, and M2-10 are implemented (identity/claim, catalog, Checkout Session creation, verified webhook ingress and inbox, subscription projection, server-authoritative unlock, the checkout-return polling page, and the Billing Portal). **M2-07 (append-only usage ledger) is deliberately NOT implemented this session**, not an oversight: a correct implementation needs atomic, concurrency-safe admission control ("committed + active reservations + request <= allowance" checked and reserved as one atomic step), and this session's own claim-transaction work twice found real races in exactly this class of problem (an unsound timestamp-comparison check, then a capability-lockout gap — see db/billing-repository.ts's git history) before landing a correct fix each time. Shipping a superficially-plausible `reserveUsage()` that races under concurrent requests would be worse than not shipping it: it looks like the security-critical control D-006 requires while not actually providing it. There is also no consumer yet — nothing in M1-M2's scope calls it; the first real caller is M3-03 (sentence regeneration). ARCHITECTURE.md already flags this exact concern as an open risk ("D1 usage ledger concurrency... ENG + MON load/concurrency spike before M2-07") — implement M2-07 as part of that spike, with a real concurrency test (mirroring tests/billing-repository.test.mts's concurrent-claim test) proving no over-reservation before trusting it.

### D-015 — M2-07 usage ledger is implemented and the D-013 deferral is lifted

Decision: the append-only usage ledger and its admission control now exist (`db/usage-ledger.ts`). D-013 deferred this because a `reserveUsage()` that races looks like the control D-006 requires without being one — that objection is answered, not waived.

Admission is a single guarded `INSERT ... SELECT ... WHERE` whose balance check is evaluated inside the same write that records the reservation, decided by rows-affected. There is no read-then-write window, and no re-read-and-compare (which cannot distinguish "I won" from "someone wrote an identical value" — the exact mistake found twice in this repository's claim transaction).

Evidence, not assertion: `tests/usage-ledger.test.mts` runs 20 concurrent 100-word reservations against a 1,000-word allowance and asserts exactly 10 admissions. A deliberately naive read-then-write implementation was run against that same test and admitted 20, consuming 2,000 of a 1,000 allowance — so the test detects the race it claims to.

The README guardrail "never charge quota for failed attempts or internal retries" is enforced by construction: a reservation is held during the attempt, a commit records only the words that actually succeeded, and the difference is released. A failed attempt costs the customer nothing. Replays are idempotent through the `(operation_key, entry_type)` unique index.

Consequence: the ledger is wired into the generation path via `src/lib/quota-gate.ts`, so the advertised allowance is now actually enforced. A subscriber over their limit gets a 429 naming the limit and the reset date; only successful words are charged, and every failure path releases the reservation. Anonymous previews stay unmetered — they are the funnel, governed by the per-client request guard rather than a subscription nobody bought. The gate fails OPEN on a metering outage: quota is a billing control, not a security boundary, and a paying customer should not lose a rewrite because a read failed. The ledger's own admission check remains the part that cannot be raced.

## Rejected

- Unlocking on a `success=true` query parameter or Checkout redirect.
- Counting attempted words, failed verification, or system retries against quota.
- Storing the full paid result in client state to simulate a lock.
- Using one opaque quality score to combine semantic safety and style.
- Depending on a single LLM SDK throughout the application.
- Requiring signup before the first preview.
- Advertising guaranteed detector evasion.
