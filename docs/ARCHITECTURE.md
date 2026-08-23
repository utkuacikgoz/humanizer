# Architecture

Last updated: 2026-08-23
Status: Phase 0 target architecture; implementation must confirm platform assumptions

## Context

The repository is a vinext/React application targeting a Cloudflare Worker. The starter includes optional D1/Drizzle support, optional R2, and Dispatch-provided Sign in with ChatGPT helpers. At Phase 0, the D1 and R2 bindings are not configured and the database schema is empty.

The architecture favors a modular monolith deployed at the edge. Separate services are not justified for V1, but domain boundaries must be explicit enough to move model work or webhook processing later.

## System shape

```text
Browser
  | public pages, preview capability, authenticated requests
  v
vinext / Cloudflare Worker
  |-- Product config (public-safe brand projection)
  |-- Humanization API
  |     |-- Validation / rate limiting / idempotency
  |     |-- Pipeline orchestrator
  |     |     |-- Extraction provider
  |     |     |-- Humanization provider
  |     |     |-- Verification provider
  |     |     `-- Evaluation provider
  |     `-- Preview policy / response shaping
  |-- Billing API
  |     |-- Checkout / Billing Portal
  |     `-- Stripe webhook inbox + projection
  |-- History / privacy API
  `-- Analytics adapter (content-free events)
          |
          |-- D1: users, jobs, ownership, subscriptions, ledger, events
          |-- optional R2/encrypted payload store: source/output bodies
          |-- Stripe
          `-- approved AI providers
```

No browser request directly calls an AI provider, D1, R2, or Stripe privileged API. Secrets and plan authority are worker-only.

## Domain boundaries

### Product configuration

Maintain two typed projections from one source:

- Public brand: product name, tagline, domain, support email, public social handles.
- Server brand/legal: legal company name and any operational metadata not needed by clients.

Pricing follows the same pattern: one server-owned catalog and a deliberately safe public view. Do not mix brand or price definitions into components.

### Humanization pipeline

The orchestrator is a deterministic state machine around nondeterministic providers:

`received -> validated -> analyzed -> protected -> rewriting -> verifying -> evaluating -> succeeded | retryable_failed | terminal_failed`

Section retries return to `rewriting` with a failure-specific instruction and immutable protected-content constraints. Attempt ceilings include count, wall-clock time, and estimated cost. Only a `succeeded` job can create a preview or usage commit.

Suggested provider contracts:

```ts
interface ExtractionProvider {
  extract(request: ExtractionRequest, context: ProviderContext): Promise<ExtractionResult>;
}

interface HumanizationProvider {
  rewrite(request: RewriteRequest, context: ProviderContext): Promise<RewriteCandidate>;
}

interface VerificationProvider {
  verify(request: VerificationRequest, context: ProviderContext): Promise<VerificationResult>;
}

interface EvaluationProvider {
  evaluate(request: EvaluationRequest, context: ProviderContext): Promise<EvaluationResult>;
}
```

Contracts contain normalized text/sections, protected items with stable IDs and spans, mode, prompt/config version, and explicit time/cost budget. Results contain structured findings, provider/model version, token/latency/cost metadata, and typed failures. Provider SDK request/response types stay behind adapters.

Protected values should be detected deterministically where possible and reconciled with model-assisted extraction. Placeholders must be collision-resistant and reversibly mapped. Verification compares normalized protected structures as well as claims; prompt instructions alone are not a protection mechanism.

### Preview boundary

The complete successful result is stored server-side. A preview policy derives:

- A bounded partial rewrite.
- Diff hunks safe to expose.
- Qualitative trust labels derived from versioned thresholds.
- Count and categories of improvements.
- Lock metadata, never the hidden remainder.

Server-rendered data, hydration/RSC payloads, browser storage, accessibility text, analytics, and API errors must all obey the same boundary. Visual CSS masking is not a lock.

Anonymous access uses a random, high-entropy, expiring capability tied to one job. Store only a one-way token digest. Rotate/consume it when a job is claimed. Rate limits apply by layered signals (capability, IP/network indicators, device/session as privacy permits), not only cookies.

### Identity and ownership

Use the platform's signed identity headers through the provided server helper for optional/authenticated routes. Identity headers are accepted only from the trusted hosting boundary; local/dev injection is isolated from production.

An anonymous job can be claimed once in a transaction after authentication/payment linkage. All history/detail/mutation operations use the server-derived user ID. Neither an email nor a client-supplied user/job ID proves ownership.

### Billing and usage

Stripe is an external event source; D1 holds the local server-authoritative projection used for fast access checks. Webhook processing is inbox-based:

1. Read the untouched raw body.
2. Verify Stripe signature and timestamp.
3. Insert unique `event.id` with minimal metadata.
4. Return success for already processed events.
5. Project object state idempotently inside an atomic boundary.
6. Mark processing outcome and retry transient failures.
7. Periodically reconcile local subscriptions with Stripe.

Usage is append-only. A generation creates a reservation against available allowance, then a commit for `successful_words` or a release on failure. `attempted_words` belongs to operational metrics and never changes customer balance. A unique operation key prevents double debit. Aggregate usage is a cache/projection that can be rebuilt.

See `MONETIZATION.md` for lifecycle semantics.

## Conceptual data model

Exact names may change, but invariants must not.

- `users`: internal ID, trusted external subject, contact projection, timestamps, deletion state.
- `anonymous_sessions`: digest/capability metadata, expiry, abuse counters; no raw token.
- `humanization_jobs`: owner or anonymous session, mode, state, input/successful word counts, pipeline/config versions, timestamps, terminal error class.
- `job_payloads`: encrypted or access-isolated source/result payload reference and purge state.
- `protected_items`: job, stable item ID, category, source span/hash/value or securely stored reference, verification result.
- `job_attempts`: stage/section, status, provider/model/config versions, token/cost/latency, non-sensitive failure code.
- `result_revisions`: immutable successful output versions and parent relationship for sentence regeneration/edit.
- `subscriptions`: user, Stripe customer/subscription, internal plan/version, status, billing period, last Stripe object/event ordering metadata.
- `stripe_events`: unique event ID, type, object ID, created time, processing status/attempts; avoid retaining unnecessary payload/payment data.
- `usage_entries`: user, subscription period, operation key, reservation/commit/release/adjustment type, attempted/successful words, reference job, timestamp.
- `analytics_outbox`: event name/version, pseudonymous IDs, non-content properties, delivery state.
- `deletion_jobs`: subject/scope, requested/completed timestamps, processor propagation status.

Critical constraints include unique external identity subject, Stripe customer/subscription IDs, webhook event ID, and usage operation key. Jobs must have exactly one access principal: unclaimed anonymous capability or user owner, never neither/both after transition completion.

## Configuration and secrets

Configuration classes:

- Build-time public values: brand projection and public plan display data.
- Runtime non-secret values: thresholds, limits, provider selection, retention periods, feature flags.
- Runtime secrets: provider keys, Stripe secret/webhook secret, encryption keys, analytics credentials.

Startup/deploy validation fails closed for missing or mismatched required configuration. Secret values are never serialized, logged, passed to client components, or stored in source. Production/test Stripe identifiers cannot be mixed.

Thresholds are versioned. Each job records the effective pipeline, prompt, provider, catalog, and threshold versions needed for reproducibility without retaining hidden chain-of-thought.

## Reliability and observability

- Correlate requests with opaque request/job/attempt IDs, not document text.
- Emit structured state transitions, duration, token counts, cost estimates, failure class, and redacted provider status.
- Use timeouts and bounded retries with jitter for transient external failures; never retry deterministic invalid input.
- Make checkout creation, humanization submission, webhook effects, and usage operations idempotent.
- Phase 0 implements a bounded per-runtime preview guard (60-second replay, 12 requests/minute per observed client, two concurrent requests per observed client, and a five-second request-path deadline). The deadline rejects orchestration and propagates an abort signal; provider adapters must honor that signal to stop upstream work. Treat the guard as prototype defense-in-depth and replace it with distributed enforcement before enabling a paid provider.
- Define a stuck-job sweeper and Stripe reconciliation job before launch.
- Alert on semantic/protected-content failure spikes, terminal pipeline failures, webhook lag/failure, entitlement drift, quota invariant violations, provider latency/cost, and checkout-to-unlock failures.
- Keep support tooling least-privileged; viewing customer text requires explicit policy and audit, not ordinary logs.

## Architecture disagreements and risks

| Topic | Current direction | Disagreement/risk | Resolution owner and deadline |
|---|---|---|---|
| Long-running model work on request path | Start with bounded synchronous orchestration for a 200–300-word V1 input | Worker/provider time limits and checkout latency may require queues/durable orchestration; asynchronous jobs complicate preview UX | ENG + HE spike before M1-03; adopt async polling if p95 cannot fit a safe request budget |
| D1 usage ledger concurrency | D1 transactional append-only ledger | Platform transaction semantics must prove correct under concurrent requests and webhook/upgrade races | ENG + MON load/concurrency spike before M2-07 |
| Text payload storage | D1 initially, optional separate encrypted R2 payload | D1 simplicity conflicts with payload isolation, size, purge, and encryption needs | SEC + ENG decide before M1-09 |
| Anonymous capability retention | Proposed 24 hours | Longer improves checkout recovery; shorter reduces sensitive-data exposure and abuse | PO + LEGAL + SEC before M1 launch |
| Dispatch identity versus conventional auth | Use available optional Sign in with ChatGPT | Portability and Stripe customer account recovery may need another auth provider later | ENG document migration boundary before M2-01; do not build second auth in V1 without blocker |
| AI provider retention | Prefer zero/short retention configuration | Model quality/cost may conflict with privacy terms | HE benchmarks; SEC/LEGAL approve final provider before M4 |
| Independent verifier | Prefer distinct verification prompt/model and deterministic checks | Same-model correlated errors can miss semantic drift; distinct models add latency/cost | HE compare mixes on benchmark before freezing production config |
| Partial preview selection | Expose coherent beginning/selected hunks | A simple prefix may leak enough value or misrepresent quality; selected hunks can cherry-pick | PO + DES define fixed transparent policy before M1-10 |
| Pro packaging | $19 includes several future capabilities | Selling unavailable features is a trust/legal risk | MON + LEGAL must mark unavailable items explicitly or omit them until shipped |
| History default retention | User-controlled, exact period TBD | Indefinite history conflicts with minimization; too short harms paid value | LEGAL + PO decide before M3-05 |

## Evolution seam for Voice DNA (V1.1)

Do not build profiles now. Preserve an optional `voiceProfileRef` field in domain requests only if it adds no V1 behavior, and keep writing-pattern analysis output structured. Future voice samples/profile embeddings require a separate consent, retention, deletion, encryption, access-control, and evaluation design. No customer history may silently become training data.
