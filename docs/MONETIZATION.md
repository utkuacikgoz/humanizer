# Monetization and Billing

Last updated: 2026-08-25
Owner: Monetization Agent

## Commercial rules

There is no permanent free tier. The anonymous experience is a bounded product-quality preview, not an account allowance. Generate the complete result server-side but release only the approved partial preview before payment.

Canonical launch offers:

| Plan | Price | Billing | Included words | Checkout | What it delivers today |
|---|---:|---|---:|---|---|
| Starter | $9.99 | Monthly | 50,000 | Active | The complete rewrite unlocked, four modes, meaning protection, paid history. Sentence controls and protected-term controls are catalogued as planned, not V1 checkout claims. |
| Pro | $19 | Monthly | 200,000 | Active | Exactly what Starter delivers, with a 200,000-word monthly allowance instead of 50,000. Nothing else. |

**Pro is purchasable, and the allowance is the entire offer.** Pro used to be
`availability: "announced"` with no Stripe price mapping, so `isPurchasablePlan()`
refused it and nothing could buy it. It is `active` now. Its feature list used to
read "Voice DNA (coming later)", "Multiple voice profiles (coming later)",
"Larger and batch documents (coming later)" — none of which exist, and none of
which are V1 deliverables. Selling a $19 plan on them would be the dark-pattern
blocker "claiming unavailable Pro features are present", so the plan is now sold
on the one thing that is real: four times the monthly words at roughly twice the
price, for a writer whose volume needs it.

Voice DNA, multiple voice profiles, larger documents, batch processing, and advanced controls remain future Pro capabilities, not V1 deliverables. They live in the catalog's `plannedFeatures`, which the pricing card renders as a separate roadmap line opening with `Not included.` — outside the ruled feature list and with no checkmark, so a planned capability cannot be misread as a bought one. Nothing in `features` may carry a `coming later` qualifier; a capability moves into `features` only once it ships. `tests/pro-plan.test.mts` asserts both rules.

### Owner action required before Pro can be sold

Create a **$19.00/month recurring price in USD** in the Stripe product catalog
and add its price ID as the **`STRIPE_PRICE_PRO`** repository secret (and in
`.dev.vars` for local work). Until it is set, `validateStripeConfig()` fails
closed for the whole configuration — not just Pro — so `/api/billing/readiness`
answers 503 and the landing page shows "Checkout temporarily unavailable"
instead of offering a purchase it cannot complete. That is the intended
behaviour, not a regression.

The amount must match `src/config/pricing.ts` exactly. `assertPriceMatchesCatalog()`
iterates every plan in `STRIPE_PRICE_ENV_KEYS`, so a Pro price at the wrong
amount, currency, interval, or in an archived state closes checkout for
everyone rather than charging a figure the page never showed.

## Centralized catalog

Maintain one versioned, typed server-owned catalog. It defines stable internal plan IDs, display price/currency/interval, included successful words, feature entitlements, availability, Stripe price environment key, and catalog version. The client receives only display-safe fields.

Rules:

- Never accept price, allowance, feature flags, customer ID, or subscription status from the browser. `POST /api/checkout` takes a `planId` name only, and validates it with `isPurchasablePlan()` before anything reaches Stripe; the price ID is resolved from the server environment on the far side of that check.
- Never infer a plan from a displayed dollar amount.
- Map Stripe price ID to internal plan version server-side.
- One `STRIPE_PRICE_*` secret per purchasable plan, and every one of them present in `.github/workflows/deploy.yml`'s env block, its `printf` secrets-file list, the deploy gate, and the "Not configured" check. `wrangler deploy --secrets-file` **replaces** the Worker's entire secret set, so a secret missing from that list is not "unset on a new environment" — it is deleted from the running one on the next deploy.
- Validate that each deployment uses Stripe objects from the correct test/live mode.
- Snapshot catalog version onto subscription/usage records so later price changes do not rewrite history.
- Price or quota changes require an explicit migration/grandfathering decision.

## Checkout and result continuity

Checkout creation requires a valid preview job capability and an allowed plan ID. The server creates a Stripe Checkout Session with an idempotency key and stores the internal job, intended account/session, and catalog reference. Stripe metadata contains opaque internal IDs only—never writing, capability tokens, or sensitive attributes.

The return URL identifies the job with an opaque reference but confers no access. After redirect:

1. Resolve the authenticated user and job ownership/claim transaction.
2. Read the local entitlement projection.
3. If the webhook is still pending, show an honest confirmation state and bounded polling.
4. Unlock only after verified active entitlement and ownership.
5. Return directly to the preserved result, not an empty dashboard.

Abandoned or expired Checkout Sessions do not unlock. Creating multiple sessions for the same job/plan reuses or expires prior state predictably.

## Stripe webhook design

The webhook endpoint must use the raw request body. Verify the signature with the environment-specific secret and enforce Stripe's timestamp tolerance before acknowledging effects.

Use an inbox/projector pattern:

- Unique `stripe_events.event_id` is the primary replay defense.
- Duplicate delivery returns HTTP 2xx after confirming the prior insert/outcome; it performs no duplicate side effect.
- Projection logic is idempotent by Stripe object ID and version/event-created ordering.
- Do not assume delivery order. Fetch current Stripe object state when an older event could overwrite newer state.
- Transient processing failures remain retryable; permanent unsupported events are recorded and safely acknowledged according to policy.
- Store only fields needed to reproduce entitlement decisions; do not log full payloads or payment instrument data.
- Reconciliation periodically compares active local subscriptions with Stripe and produces auditable corrections.

At minimum handle the events needed for Checkout completion, subscription create/update/delete, invoice paid/payment failed, and any async payment method used. The exact list is versioned beside the integration and tested against Stripe fixtures/CLI.

## Entitlement lifecycle

Internal statuses are explicit; raw Stripe status strings are adapted at the boundary. Access policy should distinguish:

- New generation entitlement.
- Existing unlocked-result access.
- Billing portal/account access.

Proposed policy pending D-P03:

- `active` (and `trialing` only if trials are deliberately enabled): permit according to plan.
- `past_due`: do not silently grant endless new usage; apply a short configured recovery policy and explain it.
- `unpaid`/`incomplete_expired`: block new paid work.
- `canceled`: keep access through `current_period_end` only when Stripe indicates cancellation at period end; then block new paid work.
- Payment failure never deletes history.
- A portal session is created only for the authenticated user's mapped customer.

The server owns access policy. A Stripe redirect, email, cookie, cached frontend state, webhook event type alone, or client-supplied customer ID is never sufficient.

## Word accounting

Definitions:

- `attempted_words`: normalized word count submitted to an attempt; operational/cost telemetry only.
- `successful_words`: normalized word count for output that passed protected-content, semantic, and quality gates and was delivered as a paid operation.
- `reserved_words`: temporary capacity held to prevent concurrent overspend.

The word-count algorithm is deterministic and versioned. Define Unicode segmentation, contractions, hyphenation, code/URL treatment, and zero-width characters with fixtures. Show the same server-computed quantity in quota UX.

Ledger flow:

1. Validate entitlement and calculate requested words.
2. In one transaction, ensure `committed + active reservations + request <= allowance`, then append a reservation with unique operation key.
3. Run the bounded pipeline.
4. On verified delivery, append a commit for `successful_words` and close the reservation.
5. On any system/provider/verification/quality failure, append a release; customer debit is zero.
6. A replay with the same operation key returns prior state and cannot reserve or charge again.
7. A sweeper releases expired reservations after proving no successful job can later commit unnoticed.

Retries are job attempts under the same customer operation. They add cost telemetry but never word debit. Sentence regeneration is a new idempotent operation and charges only its successfully generated word count; restore and manual editing do not charge.

### Sentence operations (M3-03, implemented)

`POST /api/history/{jobId}/sentence` regenerates or restores one sentence of a
rewrite the caller owns. `src/lib/sentence-operations.ts` implements the policy
below; `tests/sentence-operations.test.mts` asserts each line of it.

**What is charged.** A regeneration that produces a candidate which passed
semantic verification, whole-document protected-value survival, and the
sentence quality gate debits exactly `countWords(candidate sentence)` — the
words actually generated and delivered, not the words of the sentence it
replaced and not the words of the document it sits in.

**What is not charged, and is not merely uncommitted.** Each of these appends a
`release` for the entire reservation, so the customer's consumed balance is
unchanged:

| Outcome | Debit | Why |
|---|---|---|
| Candidate failed verification or the quality gate | 0 | Nothing was delivered; the candidate never reaches the response. |
| Candidate was materially identical to the sentence | 0 | The engine has no different version to sell. |
| Restore to the customer's original sentence | 0 | It generates nothing; the words are already theirs. |
| Sentence index out of range, or a cap refused the request | 0 | No reservation is taken, or it is released unspent. |
| Operation timed out or the provider failed | 0 | Same as any pipeline failure elsewhere. |

**Reserve then commit, never the reverse.** A reservation has to exist before
generation, because that is what stops two concurrent operations overspending
one allowance — but the amount to charge is not known until the candidate
exists. So an operation reserves `2 × words(target sentence) + 8` as headroom
and commits the candidate's own count; `commitUsage` releases the difference in
the same call. A candidate somehow longer than the reservation is charged at
the reservation, which under-charges rather than over-charges.

**Idempotency.** One operation key, `sentence:{userId}:{jobId}:{client key}`,
names one attempt in two places at once: `usage_entries.operation_key`, where a
repeated reserve is a replay and a repeated commit is refused by the unique
index, and `sentence_operations.operation_key`, where the retry finds the first
attempt's recorded outcome and returns it rather than generating a second
candidate. The response body is rebuilt from the stored record and the ledger
on both paths, so a retry cannot report different allowance figures than the
answer it repeats. Reusing one key for a different sentence or a different
action is refused with 409, never treated as a new chargeable operation.

**Bounds.** `MAX_REGENERATIONS_PER_SENTENCE = 3` and
`MAX_REGENERATIONS_PER_JOB = 20`. Both count *attempts* of kind `regenerate`,
whatever their outcome. Counting successes would leave an unmetered generation
loop for exactly the customer most likely to keep pressing — the one whose
sentence the engine cannot improve, whose every attempt is free. Restores are
not counted: they generate nothing, so bounding them would limit undo without
limiting cost.

**Allowance, not a second meter.** Sentence operations draw from the same plan
allowance and the same append-only ledger as a whole rewrite. There is no
separate sentence quota, no per-operation price, and no upsell attached to a
customer running out mid-edit; they are told the allowance is spent, in the
same words `/api/humanize` uses.

Do not implement quota as a browser counter or a single mutable integer. Maintain an append-only ledger and rebuildable aggregate. Administrative adjustments require reason, actor, and audit trail.

## Billing-period and plan-change proposal

Pending final approval in `DECISIONS.md`:

- Allowance resets on the Stripe subscription billing-period boundary; no rollover.
- Upgrade takes effect immediately and raises the current-period ceiling to the new plan allowance, subtracting already committed use; do not add a second full bucket.
- Downgrade takes effect next billing period.
- If proration behavior is enabled, disclose it before confirmation and let Stripe calculate charges.
- Cancellation is straightforward through the billing portal and clearly shows the effective date.

These behaviors must be tested with timestamps, not only manually observed in the Stripe dashboard.

## Preview/paywall integrity

- Input is approximately 200–300 words; exact server limit is configured and displayed.
- The preview contains enough coherent text and evidence to judge quality but not the complete result.
- Hidden output never ships to the client under blur, CSS clipping, disabled selection, encoded state, source maps, or accessibility labels.
- Diff metadata is clipped to exposed regions so it cannot reconstruct hidden text.
- Preview capabilities expire and are rate-limited; repeated anonymous previews are abuse-controlled without pretending to be a free plan.
- Payment does not waive semantic verification. An invalid result remains invalid even for a paying user.

## Revenue leakage and dark-pattern checklist

Revenue leakage blockers:

- Full-result response leakage before entitlement.
- Unlock based on redirect/query/client state.
- Plan or quota accepted from client input.
- Duplicate webhook grants, concurrent quota overspend, or stale cancel state.
- Anonymous token enumeration/job theft.
- Unbounded preview cycling or rate-limit bypass.

Dark-pattern blockers:

- Hidden recurring billing, renewal, cancellation, or material limits.
- Artificial urgency, fake scarcity, preselected upsell, or obstructed cancellation.
- Charging for failed attempts/retries.
- Claiming unavailable Pro features are present.
- Detector-bypass guarantees or invented confidence precision.
- Surprise retention/training of customer writing.

## Required operational views

Provide privacy-safe observability for checkout creation/success, webhook delay/failure/replay, entitlement projection drift, reservations older than threshold, quota invariant violations, payment-failure state, cancellations, and checkout-to-unlock completion. Operators can reconcile by opaque account/subscription/job ID without reading document contents.
