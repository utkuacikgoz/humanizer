# Agent Operating Model and Atomic Backlog

Last updated: 2026-08-23
Authority: `PRODUCT.md` for scope; `DECISIONS.md` for accepted cross-cutting decisions

## Working agreement

The Product Orchestrator opens and closes milestones and rejects scope creep. A primary owner implements each item; specialists review through findings instead of silently replacing another owner's architecture. The normal flow is implementation, specialist review, automated QA, manual QA, security review, product review, blocking fixes, then milestone closure.

Owners:

- PO — Product Orchestrator
- HE — Humanization Engine
- ENG — Engineering
- DES — Design Manager
- COPY — Copy
- MON — Monetization
- AQA — Automated QA
- MQA — Manual QA
- SEC — Security
- OPT — Product Optimization
- SEO — SEO/GEO
- BL — Backlink Acquisition
- GROW — Growth
- LEGAL — Legal
- TOK — Token Optimization
- MEM — Project Memory

Token/context discipline (D-014, TOK-owned): terse replies, minimal comments, cheap-model delegation for mechanical work, no redundant re-reads. Applies to all agents.

Before starting work, read `MEMORY.md` (MEM-owned). It carries the token rules in practice, the file-ownership protocol for running agents concurrently, the repository gotchas that reliably cost an hour, and the honesty rules that override convenience. Every entry there is a mistake this project already made.

Agents update relevant memory documents when a decision or verified implementation changes. SEO and backlink work remains parallel and must not block core-product milestones. BL owns the operating system and acquisition backlog in `BACKLINKS.md`; SEO retains authority over indexable-page strategy and technical search requirements.

## Atomic backlog

Each item should fit one reviewable change. `Depends` references backlog IDs; `—` means no task dependency beyond this brief.

### M0 — Foundations and contracts

| ID | Owner | Task | Depends | Acceptance criteria |
|---|---|---|---|---|
| M0-01 | PO | Ratify V1 scope and exclusions | — | `PRODUCT.md` names the only V1 journey, included capabilities, exclusions, and measurable MVP definition. |
| M0-02 | ENG | Define centralized brand config contract | M0-01 | One typed server-safe/public-safe source contains confirmed Ownword identity plus nullable, explicitly unverified `supportEmail` and `legalCompanyName`; customer-facing code imports it; secrets are excluded. |
| M0-03 | MON | Define centralized catalog and entitlement contract | M0-01 | Starter/Pro price, interval, word allowance, feature flags, Stripe price env-key, and version are defined in one server-owned catalog; clients receive a safe projection only. |
| M0-04 | ENG | Draft D1 schema and state transitions | M0-01, M0-03 | Schema covers users, jobs, protected content, results, subscriptions, Stripe events, usage ledger, and audit metadata; transitions and uniqueness constraints are documented. |
| M0-05 | HE | Define model-independent provider interfaces | M0-01 | Extraction, humanization, verification, and evaluation contracts have versioned inputs/outputs, typed failure classes, timeouts, and usage/cost metadata. |
| M0-06 | HE | Define benchmark fixture schema and rubric | M0-05 | Fixture stores category, input, expected protected facts, allowed variation, and human rating fields; metrics cannot hide regressions behind a single score. |
| M0-07 | SEC | Complete architecture threat model | M0-04, M0-05 | Threats, controls, owners, residual risks, privacy boundaries, and release-blocking findings are in `SECURITY.md`. |
| M0-08 | AQA | Define layered automated test plan | M0-04, M0-05 | Unit, contract, integration, end-to-end, billing, abuse, and benchmark suites identify fixtures, isolation, and release thresholds. |
| M0-09 | MQA | Define destructive manual matrix | M0-01 | Matrix covers malformed/large/multilingual/technical input, mobile, refresh, double click, network/auth/payment failures, and quota boundaries with evidence format. |
| M0-10 | LEGAL | Draft disclosure and retention requirements | M0-07 | Requirements identify processors, purposes, retention/deletion behavior, training prohibition, subscription terms, cancellation, and prohibited claims. |
| M0-11 | PO | Resolve or time-box open architecture decisions | M0-02..M0-10 | Each disagreement in `ARCHITECTURE.md` has an owner, decision date, and implementation consequence; no unknown blocks M1. |

### M1 — Verified anonymous preview

| ID | Owner | Task | Depends | Acceptance criteria |
|---|---|---|---|---|
| M1-01 | DES | Specify core input/result states | M0-01 | Desktop/mobile layouts cover empty, input, processing, verified preview, locked, error, and retry states; keyboard and screen-reader behavior is specified. |
| M1-02 | COPY | Finalize V1 interface copy | M1-01 | Copy avoids detector guarantees, fake precision, SaaS filler, and ambiguous payment claims; CTA remains `Unlock full rewrite`. |
| M1-03 | ENG | Implement validated humanization endpoint shell | M0-04, M0-05 | Accepts normalized mode/text/idempotency key; enforces byte/word/time limits and rate limits; returns opaque job ID; never accepts user/account/usage authority from client. |
| M1-04 | HE | Implement structured protected-content extraction | M0-05, M0-06 | Entities, dates, numbers, percentages, currency, quotations, citations, URLs, terms, code, and references are represented with source spans/stable IDs; extraction fixture tests pass. |
| M1-05 | HE | Implement writing-pattern analysis | M0-05 | Returns typed findings for all patterns in the brief with spans/severity; unaffected text is eligible to remain unchanged. |
| M1-06 | HE | Implement targeted rewrite stage | M1-04, M1-05 | Rewrites only selected spans, uses protected placeholders/constraints, supports four modes, and emits traceable candidate sections. |
| M1-07 | HE | Implement semantic verification | M1-04, M1-06 | Detects added/removed/changed claims and damaged entities, quantities, dates, citations, terminology, relationships, and conclusions; failures are structured and not exposable. |
| M1-08 | HE | Implement quality evaluation and bounded retry | M1-06, M1-07 | Configured thresholds cover naturalness, readability, grammar, repetition, meaning, and tone; only failed sections retry; retry count/time is bounded; terminal failure is safe. |
| M1-09 | ENG | Persist anonymous job and preview capability | M1-03, M1-08 | Complete result is server-only; opaque signed/random capability exposes only approved preview fields, has expiry and abuse limits, and survives refresh/checkout initiation. |
| M1-10 | ENG | Render comparison and locked preview | M1-01, M1-02, M1-09 | Partial output and meaningful diffs are visible, remainder cannot be recovered from HTML/RSC payload/API, and trust indicators use qualitative labels. |
| M1-11 | AQA | Add pipeline and preview regression suites | M1-03..M1-10 | Tests prove protected-content survival, failed-output non-exposure, bounded retries, idempotency, injection resistance, response non-leakage, and all mode contracts. |
| M1-12 | TOK | Establish cost/latency baseline | M1-08, M1-11 | Reports cost per humanization/1,000 words, extraction/verification/retry share, total tokens, p50/p95 latency, and provider/model/config versions. |
| M1-13 | HE | Populate minimum 100-passage benchmark | M0-06 | All 10 required categories contain at least 10 passages; suitable passages have independently reviewed protected facts; no customer text is used. |
| M1-14 | PO | Close M1 quality gate | M1-01..M1-13 | Benchmark thresholds in `BENCHMARKS.md`, automated tests, copy/design review, and blocking security checks pass with stored reports. |

### M2 — Paid unlock and identity

| ID | Owner | Task | Depends | Acceptance criteria |
|---|---|---|---|---|
| M2-01 | ENG | Implement optional identity and account linkage | M0-04, M1-09 | Anonymous preview requires no account; authenticated identity is derived server-side; linking uses a single-use transaction and cannot claim another session's job. |
| M2-02 | MON | Create Stripe products/prices mapping | M0-03 | Test/live price IDs are environment-specific, validated at startup/deploy, and mapped to internal catalog versions; client-provided price/allowance is ignored. |
| M2-03 | MON | Create Checkout Session endpoint | M2-01, M2-02 | Endpoint validates job capability and selected plan, creates/reuses session idempotently, stores job/account/session metadata, and uses safe same-origin return URLs. |
| M2-04 | ENG | Implement raw-body verified webhook ingress | M2-02 | Stripe signature and timestamp are verified before parsing/side effects; unsupported modes/events fail safely; secrets never log. |
| M2-05 | MON | Implement webhook inbox and projector | M2-04 | `event.id` is unique; raw verified event metadata is recorded minimally; duplicates return success without duplicate effects; out-of-order events converge via Stripe object/version state. |
| M2-06 | MON | Implement subscription lifecycle | M2-05 | Checkout completion, active/trialing policy, upgrade, cancellation, past due/unpaid, resumption, and deletion events map to explicit internal entitlements. |
| M2-07 | MON | Implement append-only usage ledger | M0-04, M2-06 | Reservations and commits are transactional/idempotent; only successful words debit allowance; failure releases reservations; aggregate can be rebuilt from entries. |
| M2-08 | ENG | Implement server-authoritative unlock | M2-03, M2-05, M2-06 | Result unlock requires job ownership/capability plus active entitlement confirmed from local server projection; redirect/query/front-end state alone cannot unlock. |
| M2-09 | ENG | Return payer to preserved result | M2-08 | Success route shows pending confirmation if webhook lags, polls with bounds, then unlocks the original result; it never lands on an empty dashboard. |
| M2-10 | MON | Implement billing portal and cancellation UX | M2-06 | Portal opens only for the authenticated account's Stripe customer; cancellation/effective date/remaining access are accurate and not obstructive. |
| M2-11 | AQA | Add billing and quota adversarial tests | M2-03..M2-10 | Tests cover forged redirect, invalid signature, replay, reordered events, concurrent usage, boundary words, failed payment, cancellation, upgrade, webhook retry, and job theft. |
| M2-12 | SEC | Perform billing/auth authorization review | M2-11 | No critical/high finding remains; medium findings have explicit owner/date; production secret handling and webhook replay evidence are approved. |
| M2-13 | PO | Close M2 payment gate | M2-01..M2-12 | Test-mode stranger journey succeeds end to end; state reconciliation and recovery runbooks are exercised. |

### M3 — Paid result workflow

| ID | Owner | Task | Depends | Acceptance criteria |
|---|---|---|---|---|
| M3-01 | ENG | Implement authorized history list/detail/delete | M2-01, M2-08 | Every query filters by server-derived user ID; anonymous capabilities cannot enumerate; deleted records become inaccessible and enter purge workflow. |
| M3-02 | ENG | Implement copy and local edit workflow | M1-10, M2-08 | Full output appears only after entitlement; copy works accessibly; edits do not mutate immutable original/result audit records without an explicit derived revision. |
| M3-03 | HE | Implement sentence restore/regeneration | M1-08, M2-07 | Sentence operations preserve protected content, verify new candidates, debit only successful newly generated words under documented policy, and are idempotent. |
| M3-04 | ENG | Implement protected phrase controls | M1-04, M3-03 | Users can add/remove bounded phrases; controls escape hostile text; future rewrites/regenerations preserve active phrases. |
| M3-05 | ENG | Implement privacy controls and purge jobs | M0-10, M3-01 | History deletion and account deletion are authenticated, auditable without retaining text, propagated to storage/processors where supported, and complete within published window. |
| M3-06 | ENG | Implement privacy-safe funnel analytics | M0-01 | All required events fire once under versioned semantics; duplicate suppression works; no event contains writing or secrets. |
| M3-07 | DES | Complete responsive/accessibility review | M3-01..M3-06 | Key journey passes keyboard-only, visible focus, semantic labeling, contrast, zoom/reflow, reduced-motion, and common mobile viewport checks. |
| M3-08 | MQA | Execute destructive manual suite | M3-01..M3-07 | Results include environment, exact steps, expected/actual, severity, and evidence; all blocker/critical/high defects close and are retested. |
| M3-09 | OPT | Audit Landing-to-Wow-to-Payment | M3-08 | Recommendations cite funnel evidence and do not weaken trust/security/quality; scope changes require PO approval. |
| M3-10 | PO | Close M3 product gate | M3-01..M3-09 | The full MVP definition is demonstrated on desktop and mobile; deletion, history, and second-use flows pass. |

### M4 — Commercial release

| ID | Owner | Task | Depends | Acceptance criteria |
|---|---|---|---|---|
| M4-01 | HE | Run frozen production benchmark | M1-13, M3-03 | Production provider/config meets every blocking threshold; report includes per-category regressions and cost/latency. |
| M4-02 | SEC | Run final threat, RLS, dependency, and secret review | M3-10 | No critical/high vulnerability, cross-user access, exposed secret, spoofable webhook, unbounded abuse path, or sensitive-text logging remains. |
| M4-03 | LEGAL | Approve customer disclosures | M3-05 | Terms, privacy, provider disclosure, retention/deletion, recurring billing, cancellation, refund/support route, and prohibited-claim review are complete. |
| M4-04 | AQA | Run release suite in production-like environment | M4-01, M4-02 | Build/lint/type/unit/contract/integration/E2E/billing/benchmark suites pass; artifacts and version identifiers are retained. |
| M4-05 | MQA | Execute production smoke and rollback drill | M4-04 | Preview, test purchase, webhook, unlock, copy, second use, cancel, and purge are verified; rollback/reconciliation owners can execute runbooks. |
| M4-06 | MON | Audit revenue leakage and dark patterns | M4-05 | Locked data is not leaked, entitlements/quotas are correct, pricing is consistent, cancellation is clear, and no unavailable feature or artificial urgency is implied. |
| M4-07 | PO | Authorize limited commercial launch | M4-01..M4-06 | All release gates are signed by PO, HE, MON, AQA, SEC, and LEGAL; monitoring/rollback owners are on record. |

## Scope-change protocol

Any new feature requires a written user problem, commercial or safety evidence, impact on current milestones, explicit exclusions, and Product Orchestrator approval. Voice DNA defaults to V1.1. SEO/GEO and growth work may proceed independently but cannot change the product journey, claims, or engineering priorities without this protocol.
