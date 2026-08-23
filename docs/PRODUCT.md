# Product

Last updated: 2026-08-23
Status: Phase 0 product authority

## Mission and promise

Build a paid-first writing product that turns generic AI-assisted writing into natural writing while preserving the author's meaning. The long-term differentiator is personalization: learn how the user writes, then rewrite AI-assisted text in that voice.

The product optimizes together for natural writing, meaning preservation, personal voice, and writing quality. It is not a generic paraphraser and must never promise guaranteed detector bypass.

Internal codename: `humanizer`. Brand name: TBD. Naming work must not block delivery.

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

Trust language is qualitative. Use `Naturalness: Strong`, `Meaning preservation: High`, and `Changes: 14 improvements` rather than false precision such as `99.87% HUMAN`.

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

### M0 — Foundations and contracts

Deliver the scope authority, configuration contracts, data model, provider interfaces, threat model, benchmark fixture format, testing strategy, and architecture decision log. Exit when disputed decisions are resolved or explicitly time-boxed and every M1 task has an owner and acceptance criteria.

### M1 — Verified anonymous preview

Deliver the core writing surface and the full server-side pipeline: analysis, protected-content extraction, targeted rewrite, semantic verification, evaluation, bounded retry, and safe partial preview. Exit when the benchmark gate passes, invalid candidates cannot be exposed, and anonymous jobs survive refresh within the documented retention window.

### M2 — Paid unlock and identity

Deliver Checkout, webhook processing, customer/account linkage, entitlement projection, usage ledger, billing portal, and post-payment result restoration. Exit when webhook replay, redirect tampering, failed payment, cancellation, quota boundary, and concurrent-request tests pass.

### M3 — Paid result workflow

Deliver history, edit/copy, sentence restore/regeneration, protected phrases, responsive interaction states, analytics, deletion controls, and retention jobs. Exit when accessibility, manual adversarial testing, and privacy controls pass.

### M4 — Commercial release

Benchmark the production provider mix, complete security and dependency review, verify production billing and rollback/runbooks, validate disclosures, and run a limited launch. Exit only through the release gates in `QA.md` and `SECURITY.md`.

## Definition of MVP done

A stranger can visit, paste valid text, choose a mode, receive a meaningful and verified preview, understand the meaning-preservation signal, buy without losing the result, immediately unlock it after server-confirmed payment, copy it, and return for a second paid use without assistance.
