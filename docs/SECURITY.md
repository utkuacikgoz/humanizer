# Security, Privacy, and Threat Model

Last updated: 2026-08-23
Owner: Security Agent
Risk principle: customer writing is sensitive even when the user does not label it sensitive

## Security objectives

- Only an authorized user or valid unclaimed anonymous capability can access a job, and only an entitled owner can access the full paid result.
- No semantically invalid candidate is exposed as a successful rewrite.
- Subscription, price, plan, and quota state cannot be forged by a client or Stripe redirect.
- Prompt injection and hostile content remain data, not instructions to application control planes.
- Customer writing is minimized, purpose-limited, access-controlled, deletable, and absent from ordinary logs/analytics.
- External providers receive only the data required for the declared processing purpose under approved retention/training settings.
- Abuse is bounded without relying on a single bypassable signal.

## Assets and data classification

| Class | Examples | Baseline controls |
|---|---|---|
| Restricted content | Source text, rewritten output, quotations, protected terminology, provider payloads | Least privilege, encryption in transit/at rest where supported, short/minimized retention, never ordinary logs/analytics, deletion propagation |
| Restricted secrets | AI/Stripe keys, webhook secret, encryption keys, session secrets | Runtime secret store only, rotation, no client serialization/source/logs, scoped environments |
| Confidential account/billing | External subject, email, Stripe customer/subscription, entitlement, deletion state | Server-only authorization, minimize display/logging, audit sensitive mutations |
| Internal operational | Job IDs, failure codes, token/cost/latency, config versions | Opaque IDs, structured redaction, retention limits |
| Public | Published brand, displayed prices, marketing copy | Integrity/version control; still no secret environment identifiers |

Payment card data remains with Stripe; the application must never collect or store it directly.

## Trust boundaries

1. Browser to Worker: all input is hostile, including headers, cookies, IDs, HTML, file-like text, and return URLs.
2. Hosting identity boundary: accept identity headers only through the trusted deployment path; do not confuse identity with entitlement or ownership.
3. Worker to D1/R2: every query/mutation enforces access principal and data classification.
4. Worker to AI provider: document text crosses to a third-party processor; prompts cannot grant provider tools or application authority.
5. Stripe to webhook: only cryptographically verified raw-body events are trusted; event contents still require invariant validation.
6. Worker to analytics/observability: content and secrets must be removed before emission.
7. Operator/support tools: humans are a separate privileged boundary with auditable, least-privileged access.

## Threat model and required controls

| Threat | Attack | Required prevention/detection | Release severity |
|---|---|---|---|
| Prompt injection | Text says to ignore policy, reveal prompts, call tools, or alter protected facts | Delimit user text as data; no tools/credentials in model context; structured schemas; deterministic protected extraction; semantic gate; adversarial fixtures | High if it can alter meaning/exfiltrate data |
| Cross-document/model leakage | Provider or cache returns another user's text | No shared prompt state; scoped cache keys or no content caching; provider privacy settings; output ownership checks; canary isolation tests | Critical |
| Stored/reflected XSS | Source/output contains HTML, SVG, Markdown, scripts, event handlers, URLs | Render as text by default; contextual escaping; sanitize only with vetted policy if rich rendering is added; CSP; prohibit dangerous HTML APIs; test hydration/diff surfaces | Critical if account/billing compromise, otherwise High |
| Oversized/algorithmic payload | Huge Unicode/text/diff causes cost or CPU/memory denial | Enforce byte and normalized word limits before parse/model; bounded sections/diff; timeouts; concurrency caps; streaming limits; reject decompression bombs/files | High if broadly exploitable |
| API abuse and preview farming | Rotate cookies/IPs, parallelize preview, replay requests | Layered rate limiting, idempotency, capability/session/IP/network risk signals, cost ceilings, anomaly alerts; do not expose unlimited alternate endpoints | High if economically unbounded |
| Rate-limit bypass | Spoof forwarding headers or vary casing/encoding | Trust proxy headers only from hosting boundary; canonicalize routes/identity; server counters; tests for alternate paths/methods | High |
| Job IDOR/history exposure | Guess job/user IDs or substitute account identifiers | High-entropy opaque IDs; ownership in every query; capability digest/expiry; single-use claim transaction; negative authorization tests | Critical |
| Full-result paywall leak | Hidden text in HTML/RSC/API/diff/source/client storage | Server-side response shaping; locked projection type; inspect network/rendered artifacts; no CSS blur lock | High |
| Quota manipulation/race | Forge word count, send concurrent requests, replay completion | Server word count; transactional reservation ledger; unique operation key; commit only verified success; concurrency tests/reconciliation | High |
| Checkout/redirect forgery | Add `success=true`, swap plan/job/customer, unsafe return URL | Ignore redirect as authority; server plan map; bind session to job/account; same-origin allowlist; validate ownership and entitlement | Critical if unlock possible |
| Stripe spoof/replay/order | Fake signature, replay event, deliver delete before update | Raw-body signature/timestamp verification; unique event inbox; idempotent projector; object state reconciliation; environment segregation | Critical |
| Auth header spoof | Direct client injects platform identity headers | Hosting boundary strips/injects trusted headers; production origin not directly reachable; server helper only; deployment test | Critical |
| Session fixation/job claim theft | Attacker supplies another preview token during sign-in/payment | High-entropy token stored as digest; SameSite/secure cookies as applicable; bind checkout; rotate on auth; transactional one-time claim; CSRF protection | High |
| CSRF | Force history deletion, portal/session creation, phrase changes | SameSite cookies, origin checks, anti-CSRF mechanism for state changes, POST-only, re-auth for destructive account deletion | High |
| SQL/data injection | Crafted IDs/text alter query | Drizzle parameterization; allowlisted sort/filter; no dynamic SQL from content; fuzz tests | Critical if cross-user/data loss |
| RLS/policy gap | New route bypasses user filter or storage policy | Defense-in-depth repository functions; D1 lacks Supabase RLS—application authorization is mandatory; tests enumerate every object action; consider database/view constraints | Critical |
| Secret exposure | Key in bundle, logs, errors, repo, preview | Runtime secrets, environment separation, secret scanning, bundle inspection, redacted errors, rotation runbook | Critical |
| Sensitive logging | Full documents/prompts/provider errors reach logs/traces | Allowlist structured fields; content-free exceptions; provider error redaction; sampling review; retention/access policy | High |
| Deletion failure | UI says deleted while payload/backups/provider copies remain | Deletion job/state, idempotent purge, processor propagation where available, documented backup expiry, completion evidence and retry alerts | High for systemic misleading behavior |
| Dependency/supply chain | Vulnerable or malicious package/build script | Lockfile, minimal dependencies, provenance/audit, review install scripts, automated vulnerability scanning, pinned runtime, patch SLA | Severity follows exploitability |
| Analytics leakage | Text/protected phrases in event properties/URLs | Versioned allowlist schema, payload tests, URL/query hygiene, content-free IDs, vendor DPA/settings | High |
| Enumeration/error oracle | Different status/timing reveals job/account/payment state | Uniform external errors where needed; rate limits; opaque IDs; no email/customer existence disclosure | Medium/High |
| Unicode confusables/control chars | Bypass word/term checks or corrupt UI | Normalize under a documented policy while preserving source; detect bidi/control/zero-width; count server-side; safe display markers where relevant | Medium/High |

## AI/provider controls

- User content is quoted/delimited as untrusted data in every provider call.
- Providers receive no application secrets, database access, external browsing, plugins, or arbitrary tools for V1.
- System prompts never include another user's content or results.
- Provider adapters use strict structured output validation, maximum output size, timeouts, and typed error handling.
- Deterministic validation independently checks protected values; a model saying “verified” is insufficient.
- Verification should be independent of generation where benchmark evidence supports it; correlated-error risk is measured.
- Store provider/model/prompt/config IDs and safe metrics, not hidden chain-of-thought.
- Provider debug/logging features that retain prompts are disabled where possible.
- No customer writing is used to train internal or third-party models without a future explicit, specific, revocable, unbundled consent mechanism.

## Third-party AI disclosure principles

Before customer text is sent, the privacy notice must clearly identify each production AI provider or a precise current subprocessors list, the processing purpose, categories of text/data sent, relevant hosting region if known, provider retention period/settings, training policy, international-transfer basis where applicable, and how deletion requests propagate or where immediate deletion is technically unavailable.

Changing a provider is a privacy/security change, not a silent model configuration tweak. Security and Legal review the provider's terms, DPA, retention controls, breach posture, and subprocessor behavior. The product must not claim zero retention unless configuration and contract evidence support it.

## Retention and deletion principles

- Collect only what the V1 journey needs.
- Unclaimed anonymous content receives the shortest practical expiry; 24 hours is proposed pending approval.
- Paid history retention must be stated and user-controlled. Indefinite retention is not the undocumented default.
- Delete individual history and full account data through authenticated workflows.
- Deletion is an idempotent job covering database rows, payload storage, derived caches, search/indexes, analytics identifiers where applicable, and provider-side stored data where supported.
- Maintain non-content tombstone/audit data only where required for security, billing, fraud, or legal obligations, with defined retention.
- Backups expire on a disclosed schedule and are not restored into active service without reapplying tombstones.
- Support/engineering logs never become an accidental shadow archive of customer writing.

## Authentication, authorization, and RLS note

The current stack points to Cloudflare D1, not Supabase. Therefore Supabase RLS is not presently available. Application-level authorization is a release-critical control: all data access goes through repository functions that require a typed access principal and apply `owner_user_id` or anonymous capability scope. If Supabase is later introduced, enable RLS on every user-owned table, deny by default, test policies with anon/auth/service roles, and keep service-role credentials server-only. RLS would supplement, not replace, application authorization.

## Security verification checklist

- Static type/lint/build/test passes and dependency audit has no unaccepted critical/high issue.
- Secret scan and built-client artifact inspection find no runtime secret.
- Every user-owned resource has positive and negative authorization tests.
- Preview network/HTML/RSC/storage inspection finds no hidden full output.
- XSS corpus is inert across input, diff, preview, edit, history, error, and analytics paths.
- Stripe invalid signature, old timestamp, replay, reordered delivery, wrong environment, and forged redirect tests pass.
- Concurrent quota requests cannot exceed allowance or double charge.
- Prompt-injection corpus cannot bypass protected/semantic gates or access tools/secrets.
- Rate limits hold across method/path/header/cookie variations and fail safely when storage is degraded.
- Deletion completes across active stores and is observable/retryable.
- Production logs sampled under adversarial inputs contain no source/output/provider payload/secrets.
- CSP and security headers are verified on production-like responses.

## Incident and key-response minimums

Before launch, assign an incident owner and document how to disable a provider/preview/checkout through server-side flags, rotate AI and Stripe secrets, stop webhook processing without losing the inbox, reconcile subscriptions/usage, invalidate anonymous capabilities, notify affected users as legally required, and preserve content-free forensic evidence. A rollback must not re-expose deleted content or revert entitlement corrections.

## Release blockers

Release is blocked by any unresolved critical/high issue involving cross-user access, full-result leakage, semantic-gate bypass, forged entitlements, quota overcharge, webhook spoofing/replay side effects, prompt-driven secret/data exfiltration, stored/reflected XSS, exposed secrets, unbounded economically material abuse, misleading deletion, or undisclosed/unapproved provider use. Medium risks require owner, mitigation, target date, and explicit Security/Product acceptance.
