# Product

Last updated: 2026-08-25
Status: Product authority. Activation is complete; milestone and commercial-release gates remain open.

Implementation status is recorded below. `ACTIVATION.md` is the completed activation record, while `AGENTS.md` owns the atomic milestone backlog and named sign-offs.

## Mission and promise

Build a paid-first writing product that turns generic AI-assisted writing into natural writing while preserving the author's meaning. The long-term differentiator is personalization: learn how the user writes, then rewrite AI-assisted text in that voice.

The product optimizes together for natural writing, meaning preservation, personal voice, and writing quality. It is not a generic paraphraser and must never promise guaranteed detector bypass.

Internal codename: `humanizer`. Canonical customer-facing identity: Ownword at `ownword.pro`, operated by Bosphorus Elevate LLC with support at `support@ownword.pro`. Customer-facing identity comes from `src/config/product.ts`; social profiles and approved logo artwork remain unconfirmed.

## Commercial objective

The first proof point is 10 unrelated paying customers. The second is $1,000 MRR. Expansion follows evidence of payment and repeat use, not traffic or account-count vanity metrics.

Critical funnel:

`Visitor -> Paste -> Preview -> Checkout -> Paid -> Second paid use`

## V1 scope lock

V1 contains one journey:

`Landing -> Paste text -> Select mode -> Humanize -> Verify meaning -> Preview comparison -> Checkout -> Unlock complete result -> Copy/edit/use`

### Included

- Anonymous first analysis with a 25–300-word input limit.
- Natural (default), Professional, Academic, and Casual modes.
- Complete rewrite generated and verified server-side.
- Pre-purchase partial output ending on a sentence boundary, meaningful comparison marks, qualitative naturalness and meaning preservation, measured improvements, and protected-fact evidence.
- Locked remainder with the CTA `Unlock full rewrite` only when a meaningful rewrite and meaningful remainder exist.
- Server readiness check before offering checkout, account linkage through purchase, and return to the same server-authorized result.
- Server-authoritative subscription, entitlement, and usage enforcement.
- Accessible copy and repeat-use paths for an unlocked result.
- Starter and Pro subscriptions; no permanent free tier.
- Privacy and Terms routes using the configured Ownword/operator identity.

### Explicitly excluded or deferred

- Voice DNA and voice-profile training (V1.1).
- Multiple voice profiles, batch processing, and advanced controls.
- Detector-bypass promises or optimization against detector scores.
- A permanent free plan.
- Dozens of modes or dashboard-heavy workflows.
- Mass-generated SEO pages.
- Team workspaces, collaboration, public sharing, mobile apps, browser extensions, and a public API.

Paid history, edit/revision storage, sentence restore/regeneration, protected-phrase controls, and self-service deletion are required paid-workflow work but remain open; they must not be advertised as available until implemented.

## Current product behavior

### Anonymous preview

- `/api/humanize` validates mode, size, idempotency, request deadlines, and preview-abuse admission.
- Production-like Worker runtimes require the shared D1-backed preview guard and `PREVIEW_GUARD_SECRET`; missing shared enforcement fails closed. The isolate-local guard is limited to explicit non-production and plain-Node test contexts.
- The server persists the full successful result when D1 is available, but returns only the approved preview, hidden-word count, evidence, and optional capability.
- The locked remainder never enters HTML, RSC payloads, browser storage, accessibility text, analytics, or preview JSON.
- Unchanged or zero-improvement results return an honest terminal state with nothing withheld or sold.

### Checkout and unlock

- `/api/billing/readiness` verifies that D1, Stripe configuration, and catalog price integrity are usable before the landing page enables purchase.
- Checkout requires the server-issued capability and a catalog plan. Anonymous visitors are told before the click that sign-in is required.
- Stripe webhook projection and local entitlement state are authoritative; redirect and query state cannot unlock a result.
- `/checkout/success` is private and explicitly `noindex`. It polls with bounds and renders confirming, delayed, signed-out, missing, and unlocked states.
- The unlocked surface provides the full marked comparison, protected evidence, copy, another-rewrite path, and Billing Portal entry point.

Checkout code readiness is not live-payment readiness. Production Stripe credentials, webhook secret, live prices, deployed D1 bindings, and production smoke/reconciliation still require verification.

### Paid usage and direct paid result

The append-only ledger from D-015 is now wired into entitled `/api/humanize` requests:

1. Identity comes from trusted server headers.
2. The server resolves the active entitlement and catalog allowance.
3. It atomically reserves the submitted word count under an idempotent operation key.
4. Failure, timeout, verification rejection, and unchanged results release the reservation and charge zero words.
5. Success commits only `successful_words`.
6. A quota boundary returns an honest 429 response with remaining allowance and period end.

An entitled successful request returns the **complete result** directly, not an anonymous preview, together with the qualitative checks, measured improvement count, protected items, and a usage summary (`consumed`, `allowance`, `remaining`, `periodEnd`, and `paidUseCount`). The landing workspace renders this full paid result and supports copy.

This closes the previous gap where the ledger existed but no request path used it. It does not implement paid history, editing, sentence controls, protected phrases, or deletion.

## Experience requirements

- The writing task dominates the page.
- Both Original and Humanized panels remain available on mobile.
- Change marks and protected-fact marks remain visually and semantically distinct.
- Trust language stays qualitative: for example `Naturalness: Strong` and `Meaning preservation: High`, never fake detector precision.
- Recoverable failures preserve the draft; terminal failures expose no invalid rewrite and debit no quota.
- The purchase decision shows recurring price, allowance, sign-in expectation, and cancellation path before the click.
- No purchase CTA appears if checkout readiness fails.
- Copy success/failure is announced accessibly.

## Funnel instrumentation

Current privacy-safe vocabulary:

- `landing_view`
- `text_pasted`
- `humanization_started`
- `humanization_completed`
- `preview_viewed`
- `checkout_started`
- `checkout_completed`
- `full_result_unlocked`
- `result_copied`
- `repeat_preview`
- `second_humanization`
- `subscription_cancelled`

`repeat_preview` is anonymous repetition. `second_humanization` is reserved for the second successful entitled rewrite and is derived from ledger-backed `paidUseCount`. Event payloads must not contain source/output text, protected terms, prompts, payment data, capabilities, or provider payloads. A privacy-reviewed analytics destination and cancellation-event production wiring remain open.

## Success metrics and guardrails

Primary metrics:

- Paste-to-valid-preview completion.
- Preview-to-checkout conversion.
- Checkout-to-unlock completion.
- Paid customers completing a second successful humanization.
- Semantic and protected-content failure rates.
- Successful cost per 1,000 words and retry cost.

Guardrails:

- Zero verified instances of a failed candidate being exposed.
- Zero quota charged for failed attempts, unchanged results, or internal retries.
- No material increase in semantic failures when naturalness improves.
- No customer-text logging in analytics or ordinary application logs.
- No misleading availability, cancellation, detector, confidence, or feature claims.

## Milestone status

An implementation status is not a gate closure. Named owners in `AGENTS.md` must still record gate evidence and sign-off.

### M0 — Foundations and contracts

Status: substantially implemented. Ownword identity, catalog, schema, provider contracts, threat model, benchmark format, QA plan, retention behavior, and decision log exist. Production provider retention, final storage/encryption approval, and counsel sign-off remain open.

### M1 — Verified anonymous preview

Status: implementation-complete for the current deterministic provider. The comparison, sentence-boundary preview, protected evidence, persistence/capability flow, distributed production guard, non-exposure boundary, retries, and regression suites exist. Gate remains open because the deterministic provider and fixture suite are not production quality evidence; M1/M4 review evidence and a production provider benchmark are still required.

### M2 — Paid unlock and identity

Status: code-complete or substantially complete through M2-10, including D-015 ledger enforcement on entitled humanizations, Billing Portal UX, readiness gating, checkout, webhook projection, unlock, and return continuity. M2-11/M2-12 production-like adversarial evidence and security sign-off, live credential verification, reconciliation, and M2-13 gate closure remain open.

### M3 — Paid result workflow

Status: partial. Copy, direct paid result rendering, post-checkout result evidence, bottom-funnel analytics, and second-paid-use semantics are implemented. Paid history, edit/revision workflow, sentence restore/regeneration, protected phrases, self-service history/account deletion, purge completion evidence, and full responsive/manual QA remain open.

### M4 — Commercial release

Status: open. Release blockers include:

- `ownword.pro` currently serves a Hostinger parked-domain page rather than this application;
- production provider selection and frozen benchmark;
- production D1/guard/Stripe/webhook/live-price configuration and smoke/reconciliation;
- Legal review and approval of Terms, Privacy, retention, provider, refund, and jurisdiction language;
- final security, dependency, accessibility, manual QA, rollback, and dark-pattern sign-offs.

## Definition of MVP done

A stranger can visit, paste valid text, choose a mode, receive a meaningful and verified preview, understand the meaning-preservation evidence, buy without losing the result, immediately unlock after server-confirmed payment, copy it, and return for a second paid use without assistance.

The repository implements that core path under controlled/test conditions, including ledger-backed paid reuse. The commercial MVP is not done until the canonical domain serves the app, production provider/credentials are verified, Legal signs off, and the named release gates close.
