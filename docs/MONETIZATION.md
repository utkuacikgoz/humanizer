# Monetization and Billing

Last updated: 2026-08-23
Owner: Monetization Agent

## Commercial rules

There is no permanent free tier. The anonymous experience is a bounded product-quality preview, not an account allowance. Generate the complete result server-side but release only the approved partial preview before payment.

Canonical launch offers:

| Plan | Price | Billing | Included words | Available V1 features |
|---|---:|---|---:|---|
| Starter | $9 | Monthly | 50,000 | Four modes, semantic protection, comparison, history, sentence regeneration, protected terminology |
| Pro | $19 | Monthly | 200,000 | Starter features; larger limits/value positioning only where actually implemented |

Voice DNA, multiple voice profiles, larger documents, batch processing, and advanced controls are future Pro capabilities, not V1 deliverables. Unavailable capabilities must be omitted from purchase claims or explicitly labeled `Coming later`; never imply they are usable at checkout.

## Centralized catalog

Maintain one versioned, typed server-owned catalog. It defines stable internal plan IDs, display price/currency/interval, included successful words, feature entitlements, availability, Stripe price environment key, and catalog version. The client receives only display-safe fields.

Rules:

- Never accept price, allowance, feature flags, customer ID, or subscription status from the browser.
- Never infer a plan from a displayed dollar amount.
- Map Stripe price ID to internal plan version server-side.
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
