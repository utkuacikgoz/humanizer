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

Voice DNA, multiple voice profiles, larger documents, batch processing, and advanced controls remain future Pro capabilities, not V1 deliverables. They live in the catalog's `plannedFeatures`.

Since 2026-08-27 the pricing card renders them as rows inside the card rather than as a trailing `Not included.` sentence, because a paragraph under a feature list is a paragraph people skip. Each row carries its own status, which is what keeps the move safe:

- The status is the first thing in the row, as real text (`Planned`), so a screen reader reads "Planned, Voice DNA" rather than the bare name. It is never carried by colour or shape alone.
- No checkmark appears on a roadmap row. The marker means "you get this", and the delivered features are stated once, with the marker, above both cards.
- The status word must not imply a date. All of these are deferred past V1 with no agreed schedule, so `Coming soon` is forbidden: someone who paid for Pro partly because a capability read as weeks away is a refund conversation.
- The roadmap rows are set smaller and in the secondary band ink, so a two second scan cannot mistake one for a delivered feature.

Nothing in `features` may carry a `coming later` qualifier; a capability moves into `features` only once it ships. `tests/pro-plan.test.mts` asserts the catalog rules, and `tests/rendered-html.test.mjs` asserts the rendered ones against the real HTML: a roadmap row that gains the included marker, loses its status, or gains a date-implying word fails the build.

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

## Unit economics: what the measurement can show, and whose decision each outcome is

Added 2026-08-26 by the Humanization Engine Agent (M4-01). **This section
decides nothing.** It sets out the arithmetic, names the four things the
measurement could show, and says what each would imply. Price and allowance
are the owner's, and nothing in the engine changes either.

### The structural fact, before any measurement

Starter sells 50,000 words for $9.99. Pro sells 200,000 words for $19.00.

- Starter earns **$0.000200 per word**.
- Pro earns **$0.000095 per word** — 47% of Starter's rate.

**Pro sells four times the allowance for less than twice the price, so it is
strictly worse per word than Starter.** That is true today, with a free
engine, and no measurement can change it. It means Pro is the plan that goes
underwater first, and any inference cost is felt there at roughly twice the
severity. It also means a heavy Starter user is the customer we would most
like to move to Pro and the one we make the least money from when we do.

Whether that ratio is deliberate — a volume discount, a land-grab, a
simplification — is a commercial decision and it is the owner's. It is
recorded here because every number below depends on it and because it was not
visible anywhere in this document before.

`src/lib/humanization/cost-guard.ts` derives its alarm from the **worst** plan
for exactly this reason: averaging the two would hide Pro behind Starter.

### What a rewrite costs, and why the number moves

Cost per rewrite is dominated by two things that do not scale with document
length: a roughly 1,500-token system prefix (cached, so cheap after the first
call in a five-minute window) and however many **thinking tokens** the model
spends. Thinking bills at the output rate, and on the current models adaptive
thinking is on by default.

docs/BENCHMARKS.md carries the modelled table. Its shape, for a 250-word
rewrite on Claude Opus 5: about $0.011 with no thinking, about $0.049 at 1,500
thinking tokens, about $0.086 at 3,000. Against a full Starter allowance that
is $2.25, $9.75 and $17.25 of inference against $9.99 of revenue. Against a
full Pro allowance it is $9.00, $39.00 and $69.00 against $19.00.

**Measured 2026-08-30** (docs/BENCHMARKS.md, "Measured: Sonnet 5"): Sonnet 5
at `low` effort costs $0.0425/1k words — $2.12 of inference against Starter's
$9.99 and $8.49 against Pro's $39.99 at full consumption, 78.8% worst-case
gross margin on both. The paragraph below predates the measurement and is
retained for the reasoning; the measured table supersedes its figures.

**Those are modelled figures, not measurements.** `npm run measure:cost`
replaces them with real ones: mean and p95 thinking, input, output and cached
tokens from provider-reported usage, measured cost per rewrite, the
verification rejection rate at each effort level, and both allowances priced
beside what they earn. It refuses to run without a key rather than printing a
model under a measured heading.

Two things about the projection are worth stating plainly. It assumes a
customer consumes the allowance in documents of the length the product
actually accepts, because per-rewrite fixed overhead means the same allowance
spent as 20-word fragments costs many times more. And it is a **floor**: a
rewrite that fails verification costs money and delivers no billable words,
and a routed rewrite that escalates pays for both models.

### The four outcomes, and what each implies

**1. Prices hold.** Measured cost per rewrite lands near the bottom of the
modelled range — low effort, modest thinking, caching working. Starter keeps a
comfortable margin and Pro keeps a workable one. Nothing changes; the cost
guard stays on to catch drift. This is the outcome the default of
`effort: "low"` is aiming at.

**2. Effort must drop, or the model must.** Cost is viable at `low` and not at
`high`. This is an engineering decision, not a pricing one, and it is already
configurable (`HUMANIZATION_EFFORT`). The measurement has to be read as a
pair: a cheaper effort that fails verification more often is resampled more
often, and two calls at `low` cost more than one at `medium`. If no effort
level is viable on Opus, the next lever is the model — Sonnet 5 at 40% of
Opus's rate, or the cheap-first router — and that is a quality decision that
needs the benchmark, not just the cost sweep.

**3. Allowances must shrink.** Cost is irreducible and the allowances are
simply too generous for the prices. Shrinking an allowance is a **price
change in substance**: this document already requires that price or quota
changes carry an explicit migration and grandfathering decision, and the
dark-pattern list makes hidden material limits a blocker. Existing subscribers
would need grandfathering or notice. Owner's decision, and the one with the
most customer-facing consequence.

**4. The plan structure itself is wrong.** The per-word inversion above is the
strongest candidate here. If inference cost is material, a plan that earns
half as much per word as the cheaper plan is the one that loses money, and
raising Starter's price does not fix Pro. Options exist — a Pro price that
restores the per-word rate, a smaller Pro allowance, usage-based overage above
a floor, or accepting Pro as a deliberate loss leader — and **choosing among
them is the owner's decision, not the engine's.** The engine's job is to make
sure the number is known before the choice is made.

### What is in place regardless of which outcome

- **Per-rewrite ceiling.** One rewrite above $0.10 raises an operational alarm.
  That is a runaway — maximum-effort thinking, a retry storm, a router paying
  for both rungs — not a pricing signal.
- **Sustained per-word ceiling.** Derived from the worst active plan and a 50%
  target margin, so it moves automatically when a price or allowance changes.
  This is the alarm that catches the failure a per-request ceiling cannot see:
  every rewrite individually cheap, and the business losing money on all of
  them. It is what makes it impossible for a plan to run underwater for a
  month unnoticed.
- **Durable record.** `job_attempts` carries a row per succeeded rewrite with
  provider, model, tokens, cost and latency. Reconciliation is by opaque job
  ID and never reads document contents.
- **A live snapshot.** `humanizationCostSnapshot()` exposes mean cost per
  rewrite, cost per word, mean thinking tokens, the cached-input share and
  both breach flags, for the operational views this document requires. A
  cached-input share near zero is a bug — the prompt prefix stopped matching
  and the input bill roughly tripled — not a price.

None of these change a price. They make sure a price is never wrong silently.

## Discounts and promotion codes

Discounts belong to Stripe, not to this application. `/api/checkout` sets
`allow_promotion_codes: true`, so a customer enters a code on Stripe's own
Checkout page and Stripe validates it. This application continues to send only
a price ID it resolved server-side from the catalog, and never sends, accepts,
or reads an amount, a discount, or a coupon from the request body.

That boundary is the point. A coupon table of our own would mean redemption
tracking, race conditions on limited-use codes, and a path by which a request
could influence what a customer is charged — which is precisely the path
`docs/SECURITY.md` verified does not exist. `tests/checkout.test.mts` fails if
`unit_amount`, `amount_total`, `discounts:`, or a coupon read from the body
ever appears in that route.

**Creating codes.** Stripe dashboard, Product catalogue, Coupons, then create a
promotion code against the coupon. A coupon can be restricted to one price, so
a Starter-only or Pro-only code is a dashboard setting rather than code.

**Testing the paid journey without moving money.** A 100%-off coupon is the
supported way to exercise the whole path: real Checkout, real webhook, real
entitlement projection, real unlock, real history row. Note that Stripe may
skip payment-method collection entirely for a fully discounted subscription,
so a 100%-off run proves the entitlement path but does **not** prove card
capture. Run at least one small real charge before launch.

**A discount does not change the allowance.** Word limits come from
`src/config/pricing.ts` and are keyed to the plan, not to what was paid. A
customer on a 50%-off Starter code still gets 50,000 words, and the cost guard
still measures real cost against the catalogue's undiscounted rate, so a
heavily discounted cohort will look worse against the ceiling than it should.
That is worth remembering before running a broad promotion.
