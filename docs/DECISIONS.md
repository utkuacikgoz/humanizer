# Decision Log

Last updated: 2026-08-25

Accepted decisions are durable until replaced by a new dated entry. Implementation discoveries should amend this log rather than silently diverge.

## Accepted

### D-001 — V1 is a paid-first single journey

Decision: Ship only the journey in `PRODUCT.md`; no permanent free tier and no Voice DNA in V1.
Reason: Prove quality, payment, and repeat use before expanding.
Consequence: New dashboard, collaboration, API, and personalization work is rejected or deferred.

### D-002 — Brand is one configuration source

Decision: The canonical customer-facing identity is Ownword at `ownword.pro`, operated by Bosphorus Elevate LLC with `support@ownword.pro` as its support address. It comes from the typed object in `src/config/product.ts` (`productName`, `productTagline`, `domain`, `supportEmail`, `legalCompanyName`, `socialHandles`). Use `humanizer` only as the internal codename or a generic search-category term.

Reason: The founder confirmed the brand and domain on 2026-08-24. The concurrent commercial-terms work on `main` confirms the operator and support address. Social profiles and official logo artwork are not confirmed.

Consequence: Public UI, metadata, structured data, legal pages, and documentation use Ownword consistently. Use a text wordmark and no custom favicon until approved brand assets exist. Tests detect stale display identity and prevent operator details from leaking into unrelated landing copy.

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

### D-P01 — Paid-history retention duration (anonymous portion superseded by D-017)

Proposal: Default paid history retention is user-controlled with a documented maximum and deletion-on-request
workflow. Legal and Product must ratify exact paid-history and backup periods. The earlier proposal to expire all
anonymous source/output within 24 hours is historical and is superseded by D-017's implemented split between a
24-hour capability and payload retention of up to 30 days.

### D-P02 — Subscription period usage semantics (before M2)

Proposal: Allowance follows Stripe billing period boundaries; upgrades grant the higher current-period allowance without double-crediting prior usage, downgrades apply next period, and unused words do not roll over. Monetization must validate customer clarity and refund implications.

### D-P03 — Past-due access policy (before M2)

Proposal: Keep previously unlocked results readable during a short configured grace period, block new chargeable generations when entitlement becomes non-active, and follow Stripe recovery state. Do not delete history because of payment failure.

### D-P04 — Source/output storage separation and encryption (before M1)

Proposal: Keep searchable metadata in D1 and encrypted text payloads in a separate storage boundary if platform capabilities and payload sizes justify it; otherwise use D1 with strict access functions and minimized retention. Security owns the decision after a platform spike.

### D-P05 — Provider zero-retention availability (before M4)

Proposal: Prefer providers/settings offering no-training and zero/short retention. If unavailable, surface the exact processor retention in the privacy notice and shorten internal retention. Legal and Security must approve the production provider set.

## Accepted implementation decisions

### D-013 — M2 billing is built while production Stripe details remain pending

Status: Historical implementation record. Its ledger deferral was superseded by D-015 and its claim that the
ledger had no route consumer was superseded by D-016. Its production-credential and release-signoff cautions remain
current.

Decision: Product Orchestrator directed engineering to proceed with the M2 payment and entitlement backlog before every commercial detail was available. Ownword, `ownword.pro`, Bosphorus Elevate LLC, and `support@ownword.pro` are now configured. Official visual assets and live Stripe credentials remain pending. Values stay centralized through `productConfig`, `STRIPE_*` environment variables, and the versioned Stripe price mapping. Missing required payment configuration must fail closed.
Reason: User-directed acceleration toward a same-day paid launch; this is the explicit tradeoff being made, not an oversight.
Consequence: Production Stripe credentials, production D1/guard bindings, D-P04 payload-storage resolution, D-P05
provider retention, M4-03 Legal approval, and the M2/M4 release gates cannot be closed by repository code alone.
The original choice to defer M2-07 was justified by the absence of proven atomic admission; D-015 records the
test-backed implementation that lifted that deferral. D-016 records its subsequent route integration.

### D-015 — M2-07 usage ledger is implemented and the D-013 deferral is lifted

Status: Accepted. Extended by D-016 for request-path enforcement.

Decision: the append-only usage ledger and its admission control now exist (`db/usage-ledger.ts`). D-013 deferred this because a `reserveUsage()` that races looks like the control D-006 requires without being one — that objection is answered, not waived.

Admission is a single guarded `INSERT ... SELECT ... WHERE` whose balance check is evaluated inside the same write that records the reservation, decided by rows-affected. There is no read-then-write window, and no re-read-and-compare (which cannot distinguish "I won" from "someone wrote an identical value" — the exact mistake found twice in this repository's claim transaction).

Evidence, not assertion: `tests/usage-ledger.test.mts` runs 20 concurrent 100-word reservations against a 1,000-word allowance and asserts exactly 10 admissions. A deliberately naive read-then-write implementation was run against that same test and admitted 20, consuming 2,000 of a 1,000 allowance — so the test detects the race it claims to.

The README guardrail "never charge quota for failed attempts or internal retries" is enforced by construction: a reservation is held during the attempt, a commit records only the words that actually succeeded, and the difference is released. A failed attempt costs the customer nothing. Replays are idempotent through the `(operation_key, entry_type)` unique index.

Historical consequence at acceptance: the ledger initially had no route consumer. D-016 supersedes that state; the
allowance is now enforced for entitled `/api/humanize` requests.

### D-016 — Entitled humanization requests enforce the usage ledger

Status: Accepted and implemented.

Decision: Every entitled `/api/humanize` request reserves its normalized input word count through the D-015 ledger
before generation. Over-quota requests fail with 429 and current usage. Failed and no-op attempts release the
reservation; a successful attempt commits only the successful words. Operation keys keep retries idempotent.

The successful paid response returns the full verified result and a usage projection containing consumed,
allowance, remaining, period end, and paid-use count. Anonymous or unentitled callers continue to receive only the
safe preview contract. This does not implement paid history, persisted editing, sentence restore/regeneration, or
protected-phrase controls; those remain M3 work.

Reason: An implemented ledger is not a quota control until it is in the request path, and the paid experience must
show authoritative remaining usage without trusting client state.

Consequence: M2-07 is enforced for the current paid generation path. Production D1 bindings and concurrency
behavior still require production-like release evidence, and future chargeable operations must use the same
reservation/commit/release invariant.

### D-017 — Anonymous capability and payload retention use separate windows

Status: Accepted implementation record; final Legal approval remains part of M4-03.

Decision: Anonymous preview capabilities expire after 24 hours. Unclaimed anonymous source/result payloads may be
retained for up to 30 days and are purged opportunistically by repository cleanup. Public Privacy copy states those
two distinct windows; no document may imply that a 24-hour capability automatically deletes the stored payload.

Reason: Checkout recovery authority and stored-data lifecycle are separate controls. Recording them separately
prevents an expired link from being misrepresented as immediate deletion.

Consequence: D-P01's earlier anonymous 24-hour deletion proposal is superseded. Authenticated paid-history
retention, self-service deletion, backup retention, and counsel approval remain open. Purge scheduling is settled
by D-018.

### D-018 — Purge runs on a schedule, not only on the write path

Status: Accepted implementation record (2026-08-25, ENG, M3-05). Final Legal approval remains part of M4-03.

Decision: an hourly Cloudflare cron trigger, declared in the generated `dist/server/wrangler.json` from
`vite.config.ts`, drains the `deletion_jobs` queue and runs the anonymous retention sweep. Deletion of a history
item still erases the text inside the request that accepts it; the schedule exists for propagation and retention,
not to perform the erasure. The deletion audit trail (`deletion_audit_events`) records subject, scope, authority
and time, and is structurally incapable of holding customer writing, a hash of it, or a driver error object.

Reason: the retention sweep previously ran only when someone submitted a rewrite. A period with no traffic enforced
nothing, while `/privacy` promises unclaimed anonymous text is deleted within 30 days. A promise that depends on
unrelated customer activity is not a control.

Consequence: self-service account deletion remains out of scope by PO decision (2026-08-25) and stays manual by
email, as `/privacy` states. Completion evidence for the published window, backup/point-in-time-restore expiry, and
propagation to any future non-D1 store remain open; the worker takes a processor registry so adding one is a
registration rather than a rewrite of the deletion path.

## Rejected

- Unlocking on a `success=true` query parameter or Checkout redirect.
- Counting attempted words, failed verification, or system retries against quota.
- Storing the full paid result in client state to simulate a lock.
- Using one opaque quality score to combine semantic safety and style.
- Depending on a single LLM SDK throughout the application.
- Requiring signup before the first preview.
- Advertising guaranteed detector evasion.
