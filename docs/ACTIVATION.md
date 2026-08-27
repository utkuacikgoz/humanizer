# Activation and the AHA Moment

Last updated: 2026-08-25
Owner: Product Orchestrator
Authority: `PRODUCT.md` for scope, `MONETIZATION.md` for paywall rules, and `DECISIONS.md` for accepted decisions

This is the current completion record for the activation program. It replaces the original 2026-08-23 gap analysis, which described the pre-activation implementation. A completed activation item is verified code and test evidence; it does not by itself close a milestone or authorize production launch.

## The AHA moment

**The AHA moment is the instant a first-time visitor sees their own sentence rewritten beside the original, with the exact facts they care about visibly untouched.**

The current product now supports that moment for a qualifying rewrite:

1. Both Original and Humanized panels remain visible on narrow screens.
2. Removed and rewritten phrases are marked, with a plain-language screen-reader summary.
3. Protected facts are cleaned for display and marked separately from rewrite changes.
4. The built-in sample submits in one click and deliberately demonstrates both visible edits and protected facts.
5. A rewrite that is materially unchanged or has no measured improvement is returned as an honest terminal state with no capability or purchase offer.

The remaining quality caveat is outside the activation backlog: the deployed deterministic provider is still a contract-testing and demo baseline. A production provider and frozen production benchmark remain release requirements.

## Current funnel record

| Step | Current verified behavior | Remaining boundary |
|---|---|---|
| Land and understand | Ownword identity, workspace-first layout, pricing, Privacy, Terms, and billing-management entry point are present. | `ownword.pro` still serves a Hostinger parked-domain page; the application is not live on the canonical domain. |
| Try an example | One click loads the synthetic sample and submits exactly once. Analytics records `source: "sample"` without text content. | None in the activation scope. |
| Anonymous humanization | The server validates input, uses the distributed D1 guard in production-like runtimes, fails closed if shared protection is unavailable, and returns only a sentence-boundary preview plus approved evidence. | Live D1 and `PREVIEW_GUARD_SECRET` deployment configuration must be verified in production. |
| See the AHA | Comparison, change marks, protected facts, qualitative checks, coherent preview, and mobile stacking are implemented. | Production rewrite quality is not established by the deterministic provider. |
| Decide to buy | The offer discloses recurring price, monthly allowance, sign-in requirement, and cancellation route. A server readiness probe disables checkout if D1, Stripe configuration, or price integrity is unavailable. | Live Stripe credentials and prices must pass the readiness probe in the deployed environment. |
| Checkout and return | Checkout is server-owned; the private success route is `noindex`; webhook-confirmed entitlement unlocks the preserved result with bounded polling. | Production payment smoke, reconciliation, and release sign-off remain open. |
| Paid humanization | An entitled `/api/humanize` request reserves allowance through the append-only ledger, releases on failure/no-op, commits successful words, returns the complete rewrite plus usage, and records it as an owned job so it appears in the account's history. | Editing, sentence restore/regeneration, and protected-phrase controls remain open. |
| Paid result | The success page shows full marked comparison and protected evidence, supports accessible copy, links to another rewrite, to `/history`, and to the Billing Portal, and fires completion events once. The landing workspace also renders direct paid results with quota remaining. | Account deletion remains open. |
| Paid history | `/history` lists the rewrites the signed-in account owns, metadata only; opening one applies the same ownership plus active-entitlement check as `/api/result`; deleting one voids the stored text, stamps the purge tombstone, and queues a `history_item` deletion job. Every query filters by the server-derived user id and anonymous capabilities enumerate nothing. | No history or deletion analytics events fire. Account deletion is manual by email by PO decision, and `/privacy` says so. |
| Second use | Anonymous repeat previews use `repeat_preview`; `second_humanization` fires only on the second successful entitled rewrite, derived from the ledger. | A production analytics destination and retention reporting remain outside this activation record. |

## Activation status matrix

Status meanings:

- **Verified** — implementation and regression evidence satisfy the intended outcome.
- **Partial** — useful implementation exists, but at least one acceptance condition remains open.
- **Open** — not implemented.

| ID | Outcome | Status | Current evidence |
|---|---|---|---|
| ACT-01 | Never paywall an unchanged rewrite | Verified | `/api/humanize` returns the `unchanged` terminal shape without preview, hidden count, capability, or offer; regression fixtures cover no-op and cosmetic-only results. |
| ACT-02 | Report the measured improvement count | Verified | The projection uses the engine count without a floor and pluralizes the label correctly. |
| ACT-03 | Keep Original on mobile | Verified | The comparison stacks instead of hiding a panel; narrow-viewport regression coverage is present. |
| ACT-04 | Highlight what changed | Verified | The browser derives marks only from the original and the already-approved preview/full paid result. Because the locked remainder is never present, this implementation cannot expose it through diff metadata. |
| ACT-05 | Cut previews on a sentence boundary | Verified | `projectPreview()` exposes only complete sentences inside the safe budget and withholds a meaningful remainder; boundary and leakage tests cover punctuation, long first sentences, and fragments. |
| ACT-06 | Make the sample prove the differentiator | Verified | `SAMPLE_TEXT` contains rewrite markers and protected facts; tests require visible edits plus person, date, and percentage preservation. |
| ACT-07 | Clean protected facts for display | Verified | Display selection removes nested/duplicate fragments without weakening extraction and orders retained facts by source position. |
| ACT-08 | Promote protection from footnote to proof | Verified | Protected facts are marked inline and summarized in the evidence rail with a defined empty state. |
| ACT-09 | Make cancellation reachable | Verified | `ManageBilling` is present on the landing and checkout-success surfaces and maps route failures to actionable states. |
| ACT-10 | Disclose the recurring charge | Verified | The unlock card reads price, interval, allowance, recurring nature, and cancellation terms from the centralized catalog. |
| ACT-11 | Do not route users to unavailable checkout | Verified | `/api/billing/readiness` checks D1, Stripe configuration, and price integrity; the purchase control fails closed and explains sign-in before the click. This is checkout readiness, not proof that live credentials are deployed. |
| ACT-12 | One-click demo | Verified | The sample control loads and submits once, survives a same-render double click, focuses the result, and emits privacy-safe source attribution. |
| ACT-13 | Fire bottom-funnel events | Verified | Checkout completion and full unlock fire once after `/api/result` confirms entitlement, never from the redirect alone. Copy success emits `result_copied`. |
| ACT-14 | Copy the result | Verified | Both post-checkout and direct paid-result surfaces provide keyboard-reachable copy controls with accessible success/failure status. |
| ACT-15 | Make the unlocked screen the strongest screen | Verified | The success page reuses checks, marks, protected evidence, copy, next-use, and Billing Portal controls while preserving confirming/delayed/signed-out states. |
| ACT-16 | Measure second paid use correctly | Verified | Anonymous repetition is `repeat_preview`; the ledger-derived `paidUseCount` causes `second_humanization` only on the second successful entitled rewrite. |

## Open work outside the activation backlog

The ACT-01 through ACT-16 program is complete. The product is not commercially released. The remaining release work is tracked in `PRODUCT.md` and `AGENTS.md`:

- **no purchase has ever completed end to end.** Sign-in itself is now verified working on the
  production host (2026-08-27, owner-confirmed): the mail provider accepts the send, the link
  arrives, and it signs the customer in. The earlier rejections were an unverified sending domain
  and are resolved. What remains unproven is everything after sign-in, which is checkout, payment,
  unlock, and the rewrite reaching history. This is still the single item every commercial claim in
  this document waits on;
- select and benchmark the production humanization provider. A Claude provider is implemented but
  **not active**: `HUMANIZATION_PROVIDER` still selects the deterministic baseline, no real API call
  has ever been made, and the cost of one is modelled rather than measured;
- settle the unit economics. Modelled cost for a full Starter allowance ranges from $2.25 to $17.25
  depending on thinking tokens, against $9.99 of revenue, and Pro earns 47% of Starter's rate per
  word. `npm run measure:cost` exists to answer this and needs a key;
- obtain Legal approval for Terms, Privacy, retention, processor, refund, and jurisdiction language,
  including the provider disclosure copy written on 2026-08-26 without counsel;
- implement local editing/revisions and protected phrases. **Sentence restore and regeneration are
  implemented server-side with no UI**, so no customer can reach them. The purge worker runs hourly;
  account deletion stays manual by email by PO decision;
- complete production-like security, billing, accessibility, manual QA, smoke, reconciliation, and
  rollback gates.

Closed since this list was written: the application is attached to `ownword.pro` with canonical-host
behavior verified in the built output; production D1, the preview guard secret, Stripe credentials,
the webhook secret and both live price IDs are configured and the deploy gates on all of them; and
an entitled request's rewrite is persisted to paid history under a settled retention rule (kept until
the owner deletes it, no timed expiry).

## Rejected activation tactics

- Detector scores, “undetectable” claims, or guaranteed bypass language.
- Fake scarcity, countdowns, or a fabricated free-preview allowance.
- Shipping the locked remainder to the browser and hiding it with CSS.
- A permanent free tier or Voice DNA presented as available in V1.
- Fabricated customer counts, logos, ratings, or testimonials.
