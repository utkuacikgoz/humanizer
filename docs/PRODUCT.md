# Product

Last updated: 2026-08-23
Status: Product authority. M1 and most of M2 are implemented; no milestone gate is closed.

Implementation status is tracked per milestone below. Activation, the AHA
moment, and the ranked hook backlog live in `ACTIVATION.md`.

## Mission and promise

Build a paid-first writing product that turns generic AI-assisted writing into natural writing while preserving the author's meaning. The long-term differentiator is personalization: learn how the user writes, then rewrite AI-assisted text in that voice.

The product optimizes together for natural writing, meaning preservation, personal voice, and writing quality. It is not a generic paraphraser and must never promise guaranteed detector bypass.

Internal codename: `humanizer`. Canonical customer-facing brand: Ownword at `ownword.pro`, operated by Bosphorus Elevate LLC with support at `support@ownword.pro`. The naming question in D-002 is settled: Ownword is the decided brand, not a placeholder. The codename stays as the repository and package name. Customer-facing identity is served from `src/config/product.ts` and must not be duplicated into application logic. Social profiles and official logo artwork remain unconfirmed and must not be invented.

## Commercial objective

The first proof point is 10 unrelated paying customers. The second is $1,000 MRR. Expansion follows evidence of payment and repeat use, not traffic or account-count vanity metrics.

The critical funnel is:

`Visitor -> Paste -> Preview -> Checkout -> Paid -> Second use`

## V1 scope lock

V1 contains one journey only:

`Landing -> Paste text -> Select mode -> Humanize -> Verify meaning -> Preview comparison -> Checkout -> Unlock complete result -> Copy/edit/use`

### Included

- Anonymous first analysis with an approximately 200–300-word input limit.
- Four modes: Natural (default), Professional, Academic, and Casual.
- Complete rewrite generated and verified server-side before preview.
- Pre-purchase partial output, meaningful before/after changes, qualitative naturalness, qualitative meaning preservation, and count of issues improved.
- Locked remainder with the CTA `Unlock full rewrite`.
- Checkout, account linkage during or immediately after purchase, and return to the same unlocked result.
- Paid history, copy, edit, restore sentence, regenerate sentence, and protect phrase.
- Starter and Pro subscriptions; no permanent free tier.
- Server-side subscription, entitlement, and usage enforcement.
- Funnel analytics listed below.

### Explicitly excluded

- Voice DNA and voice-profile training (V1.1).
- Multiple voice profiles, batch processing, and advanced controls.
- Detector-bypass promises or optimization against detector scores.
- A permanent free plan.
- Dozens of modes or dashboard-heavy workflows.
- Mass-generated SEO pages.
- Team workspaces, collaboration, public sharing, mobile apps, browser extensions, and an API.

Pro may advertise excluded features only as clearly labeled future capabilities; customers must not be charged on the implication that unavailable features exist today.

## Experience requirements

The product screen is dominated by the writing task, not navigation. The input state has a clear `Paste your text` prompt, one compact mode selector, and one primary `Humanize` action. The result state uses an Original/Humanized comparison with meaningful changes highlighted.

Not yet met, as of 2026-08-23:

- Changes are **not** highlighted. The comparison renders two plain paragraphs and the preview response carries no diff data. Tracked as ACT-04 in `ACTIVATION.md`.
- The comparison does not exist below a 760px viewport: `app/globals.css` hides the Original panel there. Tracked as ACT-03.
- The preview truncates on a word boundary rather than a sentence boundary. Tracked as ACT-05, which also settles `ARCHITECTURE.md`'s open "Partial preview selection" row.

Trust language is qualitative. Use `Naturalness: Strong`, `Meaning preservation: High`, and `Changes: 14 improvements` rather than false precision such as `99.87% HUMAN`.

The improvement count must be the count the engine measured. The current implementation floors it to a minimum of one, so a rewrite that changed nothing still reports one improvement; this is a claim the product cannot support and is tracked as a launch blocker in ACT-02.

Anonymous visitors must not lose a successfully generated result when they enter checkout or authenticate. Payment success returns directly to that result. A success redirect alone never unlocks it; confirmed server-side entitlement does.

### Empty, loading, failure, and boundary behavior

- Reject empty, trivially short, and over-limit input before model work.
- Preserve the user's draft through recoverable failures.
- Prevent double submission while a request is active; repeated requests with the same idempotency key return the same job.
- Never display a rewrite that failed semantic verification.
- Explain a terminal quality failure without charging quota and allow retry.
- At a quota boundary, show current usage and an honest upgrade/renewal path before starting chargeable work.
- On slow networks, show staged progress without fabricated percentages.

## Funnel instrumentation

Required events:

- `landing_view`
- `text_pasted`
- `humanization_started`
- `humanization_completed`
- `preview_viewed`
- `checkout_started`
- `checkout_completed`
- `full_result_unlocked`
- `result_copied`
- `second_humanization`
- `subscription_cancelled`

Events use pseudonymous actor/session IDs and job IDs. They must not contain source text, output text, protected terms, raw prompts, payment details, or provider payloads. Event schemas and funnel definitions are versioned.

Implementation status: `landing_view`, `text_pasted`, `humanization_started`, `humanization_completed`, `preview_viewed`, `checkout_started` and `second_humanization` fire today. `checkout_completed`, `full_result_unlocked`, `result_copied` and `subscription_cancelled` are declared in `src/lib/analytics.ts` and accepted by the events endpoint but are **not fired anywhere**, so checkout-to-unlock completion cannot currently be computed. `text_pasted` also does not fire on the sample-text path. Tracked as ACT-13, ACT-12 and ACT-16 in `ACTIVATION.md`.

## Success metrics and guardrails

Primary metrics:

- Paste-to-valid-preview completion.
- Preview-to-checkout conversion.
- Checkout-to-unlock completion.
- Paid users completing a second successful humanization.
- Semantic and protected-content failure rates.
- Successful cost per 1,000 words and retry cost.

Guardrails:

- Zero verified instances of a failed candidate being exposed.
- Zero quota charged for failed attempts or system retries.
- No material increase in semantic failures when naturalness improves.
- No customer-text logging in analytics or ordinary application logs.
- No misleading availability, cancellation, detector, or confidence claims.

## Milestones

Each milestone below carries an implementation note dated 2026-08-23. An
implementation note is a statement about what code exists. It is not a gate
closure: per `AGENTS.md`'s working agreement, a gate is closed by a decision
from its named owners, and no gate in this document has been closed.

### M0 — Foundations and contracts

Deliver the scope authority, configuration contracts, data model, provider interfaces, threat model, benchmark fixture format, testing strategy, and architecture decision log. Exit when disputed decisions are resolved or explicitly time-boxed and every M1 task has an owner and acceptance criteria.

Status: the contracts and operating documents exist. `DECISIONS.md` still carries D-P01, D-P04 and D-P05 as proposed, and D-013 records that these require the owner's real values rather than more engineering. Gate not closed.

### M1 — Verified anonymous preview

Deliver the core writing surface and the full server-side pipeline: analysis, protected-content extraction, targeted rewrite, semantic verification, evaluation, bounded retry, and safe partial preview. Exit when the benchmark gate passes, invalid candidates cannot be exposed, and anonymous jobs survive refresh within the documented retention window.

Status: the surface and the full pipeline are implemented, and the preview boundary holds — the browser receives only the preview and a hidden-word count. Gate not closed, and three things stand in the way of closing it:

1. The deployed rewrite provider is `DeterministicHumanizationProvider`, a fixed phrase-substitution table. It is a contract-testing and demo baseline, not production quality evidence, and the benchmark fixtures are deterministic against it. M4-01's frozen production benchmark is the real gate.
2. That provider returns the input unchanged for prose containing none of its marker phrases. The preview projection currently presents such a result as a rewrite, truncates it, and offers checkout — the customer is asked to pay to unlock their own words. ACT-01 in `ACTIVATION.md`.
3. M1-10's "meaningful diffs are visible" acceptance criterion is not met; see the Experience requirements section above.

### M2 — Paid unlock and identity

Deliver Checkout, webhook processing, customer/account linkage, entitlement projection, usage ledger, billing portal, and post-payment result restoration. Exit when webhook replay, redirect tampering, failed payment, cancellation, quota boundary, and concurrent-request tests pass.

Status: largely implemented. Per D-013, M2-01 through M2-06, M2-08, M2-09 and M2-10 are built — identity and single-use job claim, the server-owned catalog and Stripe price mapping, Checkout Session creation with a price-integrity check, raw-body signature-verified webhook ingress, the event inbox and subscription projector, server-authoritative unlock, the bounded-polling return page, and the Billing Portal endpoint. Unlock requires verified ownership plus an active local entitlement; a redirect or query parameter alone never unlocks.

Not done, and blocking closure:

- **M2-07, the append-only usage ledger, is deliberately unimplemented** pending the D1 concurrency spike named in `ARCHITECTURE.md`. Reasoning is recorded in D-013. Until it exists there is no quota enforcement, so the 50,000-word Starter allowance advertised in `pricing.ts` is not actually metered.
- **The Billing Portal has no caller.** The endpoint is correct but no page links to it, while the landing page promises `Cancel anytime`. That is an obstructed-cancellation dark pattern under `MONETIZATION.md`. ACT-09.
- **The purchase CTA can dead-end.** Anonymous callers are sent to sign-in only after clicking buy, and an unconfigured Stripe environment then returns a 503. ACT-11.
- **The paywall does not disclose recurrence or the word allowance** at the point of decision. ACT-10.
- M2-11 adversarial billing tests and M2-12's security review are outstanding.

M2-13 is not self-granted by any of the above.

### M3 — Paid result workflow

Deliver history, edit/copy, sentence restore/regeneration, protected phrases, responsive interaction states, analytics, deletion controls, and retention jobs. Exit when accessibility, manual adversarial testing, and privacy controls pass.

Status: not started, with one exception — funnel analytics (M3-06) is partially wired and its bottom half does not fire. History, editing, copy, sentence restore/regeneration, protected-phrase controls, deletion and purge jobs do not exist. Note that copy is part of the MVP definition below and currently has no implementation anywhere in the application; it is pulled forward as ACT-14 rather than waiting for M3.

### M4 — Commercial release

Benchmark the production provider mix, complete security and dependency review, verify production billing and rollback/runbooks, validate disclosures, and run a limited launch. Exit only through the release gates in `QA.md` and `SECURITY.md`.

Status: not started. No production provider has been benchmarked, so there is no production quality evidence for the rewrite itself. M4-03's legal disclosure approval and M4-06's dark-pattern audit are both outstanding, and the dark-pattern findings in ACT-09 and ACT-10 are already known to be open. M4-07 authorizes commercial launch and is unsigned.

## Definition of MVP done

A stranger can visit, paste valid text, choose a mode, receive a meaningful and verified preview, understand the meaning-preservation signal, buy without losing the result, immediately unlock it after server-confirmed payment, copy it, and return for a second paid use without assistance.

Measured against the running product on 2026-08-23, this is not yet true. The
verified preview and the payment-to-unlock continuity are built and hold. The
clauses that do not hold are "meaningful" (an unchanged rewrite can be
presented and paywalled), "understand the meaning-preservation signal" (no
highlighting, and the protection evidence is a truncated footnote that renders
not at all for the built-in sample), "copy it" (no copy affordance exists), and
"return for a second paid use" (nothing invites it and the event that would
measure it is misdefined). `ACTIVATION.md` carries the ranked backlog that
closes each of these.
