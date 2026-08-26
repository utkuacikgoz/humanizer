# Security, Privacy, and Threat Model

Last updated: 2026-08-26 (re-status pass; the 2026-08-24 review is retained below in full)
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

### Prompt-injection coverage as built (2026-08-26, M4-01)

This section previously recorded prompt injection as an UNCOVERED threat: the
engine was a substitution table, and a table cannot be talked into anything.
A model provider now exists (`src/lib/humanization/claude-provider.ts`), so
the threat is live and these are the controls that answer it.

- **The document is fenced with a per-request random identifier.** A fixed
  delimiter is a delimiter a customer can type; the fence id is sixteen
  random hex characters generated per request, so pasted text cannot close
  the fence it sits inside and address the model as the operator.
- **The system prompt states the rule explicitly.** Fenced content is
  material to rewrite and never an instruction, however phrased and whoever
  it claims to be from. The correct handling of "ignore all previous
  instructions" is to rewrite that sentence as prose and leave it in the
  document — not to obey it, and not to silently delete a sentence the
  customer wrote.
- **There is nothing to reach.** No tools, no MCP servers, no credentials and
  no browsing are declared on the call, so the worst case of a successful
  injection is disclosure of the instructions themselves.
- **Structured output, not prefill.** The response is constrained to a
  one-key JSON object, so a model that started narrating instead of
  rewriting produces an unparseable response and is retried rather than sold.
- **The semantic gate is the backstop.** If a model ever complies, the
  candidate no longer contains the customer's document, and the pipeline's
  verification rejects it. Nothing about that gate was weakened to
  accommodate a model.
- **Six adversarial fixtures** (`adv-injection-01` .. `-06` in
  `benchmarks/humanization-adversarial.ts`) cover the direct form, a forged
  operator turn, a fence-breakout attempt, prompt extraction, an instruction
  aimed at protected content, and an exfiltration-shaped instruction. Their
  assertions hold under either provider. Structural coverage is asserted in
  `tests/claude-provider.test.mts`.

**Not yet verified against a live model.** No API key was available when this
was built, so every test above runs against an injected fake client. The
fixtures and the structural controls are real; a run of the injection corpus
against the actual provider is still owed, and the verification-checklist
line "prompt-injection corpus cannot bypass protected/semantic gates" is not
closed by this entry.

## Third-party AI disclosure principles

Before customer text is sent, the privacy notice must clearly identify each production AI provider or a precise current subprocessors list, the processing purpose, categories of text/data sent, relevant hosting region if known, provider retention period/settings, training policy, international-transfer basis where applicable, and how deletion requests propagate or where immediate deletion is technically unavailable.

Changing a provider is a privacy/security change, not a silent model configuration tweak. Security and Legal review the provider's terms, DPA, retention controls, breach posture, and subprocessor behavior. The product must not claim zero retention unless configuration and contract evidence support it.

**Status, 2026-08-26: none of the above is implemented, and today a provider change *is* a silent
configuration tweak.** `app/privacy/page.tsx` names three subprocessors, none of them a model
provider, and states in the present tense that no third-party AI provider receives customer text.
`HUMANIZATION_PROVIDER=claude` makes that false with no code change and nothing that fails. D-P05
is still Proposed. See **SEC-26**.

## Retention and deletion principles

- Collect only what the V1 journey needs.
- Unclaimed anonymous content receives the shortest practical expiry. *Decided and implemented (D-017, verified 2026-08-26):* the capability expires in 24 hours, the payload is swept at 30 days by an hourly cron, and `/privacy` states both. The earlier "24 hours pending approval" proposal is superseded.
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

## Anonymous preview abuse enforcement

Production preview admission is shared through D1. The fixed window permits 12
new executions per trusted Cloudflare connecting IP per 60 seconds and at most
2 active executions. Active rows carry 15-second expiring leases; the route's
pipeline deadline remains 5 seconds. Successful idempotent responses are
replayable for 10 minutes, encrypted with AES-GCM. Failed request records expire
after 30 seconds. Opportunistic cleanup removes at most 100 expired request rows
and 100 old window rows per admission so cleanup work is bounded.

`PREVIEW_GUARD_SECRET` is required in production and must contain at least 32
random bytes. It keys HMAC-SHA-256 client/request/content identifiers and derives
the replay-encryption key. D1 stores no raw IP, idempotency key, content hash, or
plaintext replay payload. `cf-connecting-ip` is trusted only at the Cloudflare
Worker boundary; missing or malformed identity fails closed. The isolate-memory
fallback is allowed only under explicit `local`, `development`, or `test`
configuration.

Admission uses one transactional D1 batch. Its first statement claims a fixed
window slot and stamps a random admission token; its second statement creates
or reactivates the lease only when that exact token is present and the shared
active-work count is below the ceiling. Rejected concurrent work conservatively
consumes its rate slot. A separate random lease fencing token prevents a
timed-out Worker from overwriting a reclaimed request. Residual caveat: this
depends on D1's single-primary serialized-write and transactional-batch
semantics; deployments must apply the migrations before traffic and must not
route admission reads/writes through a read replica.

## Incident and key-response minimums

Before launch, assign an incident owner and document how to disable a provider/preview/checkout through server-side flags, rotate AI and Stripe secrets, stop webhook processing without losing the inbox, reconcile subscriptions/usage, invalidate anonymous capabilities, notify affected users as legally required, and preserve content-free forensic evidence. A rollback must not re-expose deleted content or revert entitlement corrections.

## Release blockers

Release is blocked by any unresolved critical/high issue involving cross-user access, full-result leakage, semantic-gate bypass, forged entitlements, quota overcharge, webhook spoofing/replay side effects, prompt-driven secret/data exfiltration, stored/reflected XSS, exposed secrets, unbounded economically material abuse, misleading deletion, or undisclosed/unapproved provider use. Medium risks require owner, mitigation, target date, and explicit Security/Product acceptance.

The preview validates idempotency keys, replays encrypted successful responses
for 10 minutes, and enforces 12 attempts per 60 seconds plus two active
executions through shared transactional D1 admission batches. Production fails
closed if D1, the guard secret, or the trusted Cloudflare connecting address is
unavailable. Request-path orchestration propagates an abort signal and provider adapters must
honor it to stop upstream work. *Corrected 2026-08-26:* the deadline is no longer
a single five seconds — `app/api/humanize/humanization-runtime.ts` uses 5s for the
deterministic engine and **45s whole-request / 20s per model attempt** when a model
provider is selected. Before connecting a paid provider, verify the guarded D1
batches under real cross-colo concurrency and degraded-store conditions, layer an
edge/WAF control over IP-only identity, **and give the unauthenticated path a spend
ceiling that refuses rather than logs (SEC-25), and reconcile the privacy notice
with the processor actually in use (SEC-26).**

---

# Pre-launch security review — 2026-08-24

Reviewer: Security Agent. Scope: payment/entitlement integrity, anonymous capability model, auth boundary, secret handling, data minimization, web security surface, abuse/availability, supply chain.

Supersedes the 2026-08-23 review, which was cut off mid-engagement. Every claim carried forward from it was re-verified against the current tree; several were corrected (see "Corrections to the 2026-08-23 draft"). Snapshot: `6c79614`, working tree clean apart from DES's in-flight `app/landing-page.tsx` / `app/globals.css` edits. `npm test` 126/126 passing, lint and `tsc --noEmit` clean.

Method:

- **observed** — reproduced against the running development server at `http://localhost:3000` with hostile/malformed requests, or read directly out of the local D1 store (`.wrangler/state/v3/d1/…`).
- **code-verified** — confirmed by reading the implementation, but not exercisable live here (usually because Stripe is unconfigured in this environment).
- **unverified** — stated as such, with the reason.

Where an empirical result depends on the local dev runtime rather than real Cloudflare, that is called out explicitly rather than generalized.

## Re-status — 2026-08-26

Every finding in this review was re-checked against `ef074da` on `main`. Baseline was
**re-measured, not carried forward**: 449 unit tests pass, 0 skipped, `tsc --noEmit` clean,
`eslint` clean, in an isolated worktree.

*A tooling note first, because this project has been burned by an audit whose own method was
wrong.* The first run of this pass reported a broken build and five TypeScript errors. Both were
mine: `@anthropic-ai/sdk` is in `package.json` and `package-lock.json` (PR #29) but was absent
from the installed `node_modules` in this sandbox. Installing it made the build, the typecheck
and the suite clean. **The code was never broken; the environment was stale.** Nothing in this
re-status rests on that first run.

Method labels are unchanged and are stated per finding: **observed** means a probe or test was
actually executed here; **code-verified** means the control was read but could not be exercised
in this environment; **unverified** is stated with its reason.

### What changed

**All five 2026-08-24 blockers are now closed.** SEC-01 was already resolved on 2026-08-25; the
remaining four — SEC-02, SEC-04, SEC-06, SEC-07 — close here, and each was re-proved fixed rather
than assumed. SEC-05, which was High-on-provider-connect rather than a blocker, closes too.

Beyond the blockers: two findings downgraded (SEC-03 High→Medium, SEC-12 Low→Informational), one
closed by construction on the route it was written against (SEC-13), one **raised** (SEC-08,
Medium→High), and three new (SEC-25, SEC-26, SEC-27). SEC-09, SEC-10, SEC-11 and SEC-15's
residual are reproduced unchanged.

**Same-day follow-up (2026-08-26):** SEC-08, SEC-25, SEC-26 and SEC-27 were all fixed after this
pass filed them, each proven against the code it replaced rather than asserted. Their entries below
carry the resolution and what remains.

### Blockers, as they stand today

**None open.** The three named in the 2026-08-26 re-status — SEC-26, SEC-25 and SEC-08 — were all
fixed the same day and are marked RESOLVED below with what proved each one. The two that were
conditional on `HUMANIZATION_PROVIDER=claude` are the reason that switch is now safe to reach for:
the privacy disclosure derives from the same resolver the pipeline calls, and a distributed spend
budget refuses rather than merely alarms.

What remains is not a blocker list but a set of residuals, each recorded on its own finding:

- **SEC-09** — the CSP still permits `'unsafe-inline'` for scripts, so it is not the XSS control
  the threat model claims it is. Reproduced in the built output, unchanged.
- **SEC-03** — `/api/preview` still builds the isolate-local guard unconditionally in production,
  with no distributed alternative and no fail-closed branch. Medium, down from High.
- **SEC-04's residual, and the sharpest thing on this page.** The double-charge fix is real, but
  `alreadySubscribed` appears exactly once in the whole repository — in the route. **No test
  covers it.** The fix is protected by nothing.
- **SEC-25's ceiling** is a safety number, not a product decision, and the entitled path has no
  second ceiling beyond the word ledger.
- **SEC-08's residual** — the build step still inherits every job secret and runs third-party code.
- **SEC-15** — a wrong-*account* Stripe secret is still completely silent.
- **SEC-27's residual** — `humanizationCostSnapshot()` has no caller, so nothing surfaces the cost
  numbers operationally.

The 2026-08-24 verdict's stated grounds are gone. Whether that changes the verdict is a PO decision
per `docs/AGENTS.md`; nothing in this document grants one, and **M4-02 is not closed here**.

### Not tested in this pass

- The 50 E2E tests. They need a provisioned Playwright browser this sandbox does not have. A
  skipped E2E run reports green (`docs/MEMORY.md`), so they are reported as **not run**, not as
  passing.
- Anything about the live host. Outbound access to `ownword.pro` is blocked from this sandbox;
  every production claim below is marked as such and attributed.
- Real Stripe, and real D1 under cross-colo concurrency. Unchanged from 2026-08-24.

---

## Verdict (2026-08-24, superseded by the re-status above): NO-GO for charging real customers today

Five blockers, below. SEC-01 was a proven, end-to-end authentication bypass that handed one person another person's paid writing; it is **resolved** as of 2026-08-25 by deleting header identity outright and replacing it with magic-link sessions. One (SEC-04) charges a returning subscriber a second time on the *normal* journey, not an edge case. The rest are controls this document already declares release-critical.

This is not a verdict about carelessness. The entitlement path, the claim transaction, the webhook inbox, the preview projection, the enumeration-oracle discipline, and secret hygiene are built to the standard this document asks for, and most of them were verified sound under adversarial probing (see "What is genuinely sound" — it is long, and it is meant to be). The blockers sit almost entirely at the seam between this application and the platform it is about to be deployed onto, plus the privacy commitments that were deliberately deferred.

### Blockers (2026-08-24 — all five now closed; see the re-status above for the current list)

> Retained verbatim as the record of what was wrong. Current status, added 2026-08-26:
> **SEC-01 resolved** 2026-08-25 (header identity deleted) · **SEC-02 resolved** (25-word input
> minimum, 12-word hidden floor; no `hiddenWordCount: 0` reachable) · **SEC-04 resolved** (409
> `alreadySubscribed` before the claim) · **SEC-06 resolved** (inline void on delete, 30-day
> anonymous sweep on an hourly cron, `/privacy` states both) · **SEC-07 resolved** (migrations
> applied on deploy, `migrations_dir` fixed). SEC-03, cited below as inseparable from SEC-02, is
> downgraded to Medium and still open.

1. **SEC-01 (Critical, RESOLVED 2026-08-25)** — Two forged request headers were a complete authentication bypass. *Proven end-to-end against the running server*: forged headers returned a victim's full unlocked rewrite with HTTP 200. The application has no defence of its own; it relies entirely on an unproven assumption about the hosting boundary, and the repo's own deploy path publishes a second origin.
2. **SEC-02 (High)** — The paywall is extractable for free, at scale, by shaping input. For short inputs the server returns the **entire** rewrite with `hiddenWordCount: 0`.
3. **SEC-04 (High)** — `/api/checkout` never checks whether the caller is already subscribed. The default returning-customer journey walks an existing subscriber straight into a second $9.99/mo subscription.
4. **SEC-06 (High)** — Customer writing is stored in D1 as indefinite plaintext with no purge, no expiry sweeper, and no deletion path. D-P01 and D-P04 are still OPEN, so this would ship as an accident rather than a decision.
5. **SEC-07 (Medium security / launch-fatal operationally)** — The deploy workflow never applies D1 migrations, and the generated `migrations_dir` points at a directory that does not exist. On a real deploy the schema is absent, no capability is ever issued, and nobody can complete a purchase — silently.

SEC-03 (High) is not listed separately as a blocker only because it is inseparable from SEC-02: `README.md` already states that distributed abuse controls are mandatory before the paid model is exposed publicly, and that condition is unmet.

### The minimum GO-WITH-CONDITIONS set, if the owner launches anyway (2026-08-24)

> Status, added 2026-08-26: **1 superseded** (header identity deleted; `workers_dev: false` plus
> two bound custom domains shipped and hold) · **2 done** (409, with the client-side half and the
> test still missing) · **3 done** (migrations applied on deploy; the post-deploy `capability`
> smoke test is still missing) · **4 done** and proved by probe · **5 done** — D-017 decided it,
> the code implements it, and `/privacy` states the numbers; D-P04 (encryption) is still Proposed
> · **6 partial** — durable on `/api/humanize`, still absent on checkout, result, billing and
> events, and `/api/preview` is still on the isolate-local guard.
>
> Two conditions that did not exist in August must now be added to this list: **give the
> unauthenticated path a spend ceiling (SEC-25)** and **reconcile `/privacy` with the processor
> actually in use (SEC-26)**, both before `HUMANIZATION_PROVIDER=claude` reaches production.

Each condition must produce evidence, not an intention.

1. **Prove the auth boundary, or fail closed without it.** Produce a request from outside the platform showing (a) the production origin is unreachable except through the hosting boundary, and (b) the boundary strips inbound `oai-authenticated-user-*` headers. If either cannot be shown, implement the boundary-injected shared secret in SEC-01 first. Set `workers_dev: false` and bind the `ownword.pro` route regardless — the second origin should not exist either way.
2. **Add an existing-entitlement check to `/api/checkout`** (SEC-04) — refuse to create a second subscription for a customer who already holds an active one, and tell them so. This is a small change and it protects real money.
3. **Apply migrations on deploy** (SEC-07): add `wrangler d1 migrations apply --remote`, fix `migrations_dir`, and smoke-test that a production preview actually returns a `capability`.
4. **Fix the preview exposure policy** (SEC-02): a bounded fraction with a hidden-word floor that scales with input, and refuse inputs short enough to make the policy meaningless. A response with `hiddenWordCount: 0` must never be produced by the paid path.
5. **Retention** (SEC-06): either implement the 24-hour purge for unclaimed anonymous payloads, or record a dated, explicit Security/Legal acceptance of indefinite plaintext retention with the privacy notice matching it. Decide D-P04 one way or the other in writing.
6. **Abuse controls** (SEC-03): move rate/concurrency enforcement to a durable store and extend it to `/api/result`, `/api/checkout`, and `/api/billing/portal` — or accept a documented, dated risk that the preview is farmable and the billing routes are unthrottled.

Per `docs/AGENTS.md`, closing any QA gate or milestone is a PO decision; nothing in this document grants one.

## Findings, ranked by severity

### SEC-01 — Critical — RESOLVED 2026-08-25 — Forged platform identity headers were a full authentication bypass (proven)

> **Resolution.** `src/lib/chatgpt-identity.ts` and `app/chatgpt-auth.ts` are **deleted**, not deprecated.
> `resolveChatGPTUserFromHeaders()` no longer exists, and no code path anywhere reads
> `oai-authenticated-user-*`. There is no header left to forge, so this is a fix at the root rather
> than the containment the host gate provided.
>
> Identity now comes from an email magic-link session: a 256-bit CSPRNG token mailed to the address,
> redeemed exactly once through a guarded write decided on D1's rows-affected, exchanged for a
> `__Host-ownword_session` cookie (HttpOnly, Secure, SameSite=Lax, Path=/, no Domain). Only SHA-256
> digests of the token and the session id are stored, so a database read yields nothing presentable
> as a credential. Where a session cannot be carried safely (plain http off a dev host) the cookie
> builder returns null and sign-in is refused, rather than downgrading.
>
> The remediation items above are superseded, not completed as written: item 1 (`workers_dev: false`
> plus a bound route) shipped and remains in force; items 2 and 3 described how to make the header
> scheme survivable and no longer apply to a scheme that is gone.
>
> **What this trades.** A cookie is presented automatically by the browser, which a header scheme
> was not, so CSRF became reachable for the first time. That is answered by `SameSite=Lax` plus an
> Origin check on every state-changing route (checkout, billing portal, link request, sign-out); a
> mismatched Origin is 403, a missing one is allowed for non-browser callers. The remaining
> credential-theft surface is ordinary session theft (XSS, device access), which `HttpOnly` and the
> host gate reduce but do not eliminate.
>
> **Not yet evidenced.** *(Superseded 2026-08-26 — see the correction directly below.)* No
> adversarial pass has been run against the new scheme, and no deployed test asserts these
> properties on the production host. Verified against real SQLite, the built Worker without
> bindings, and 31 regression tests in `tests/magic-link.test.mts` covering single-use, expiry,
> tampering, enumeration-indistinguishability, rate limits, cookie flags, the host gate, and
> open-redirect refusal. The original finding is preserved below unchanged, as the record of what
> was fixed.
>
> **Correction, 2026-08-26.** The adversarial pass happened: it is SEC-16 through SEC-24, and it
> found nine things, one of them a login-CSRF that signed a customer into an attacker's account.
> `tests/magic-link.test.mts` now carries **54** tests, not 31, and `tests/e2e/session-integrity`
> covers the confirmation flow. Re-checked here: `src/lib/chatgpt-identity.ts` and
> `app/chatgpt-auth.ts` do not exist, and a repository-wide search for `oai-authenticated` finds
> exactly one hit — a comment in `src/lib/identity.ts` explaining what was deleted. **Observed:** a
> request carrying both forged `oai-authenticated-user-*` headers resolves to no session at all.
> Still true: no deployed test asserts any of this on the production host.

**Original finding (2026-08-24), retained for the record:**


**Where.** `src/lib/chatgpt-identity.ts:27` (`resolveChatGPTUserFromHeaders`) resolves identity from exactly two request headers, `oai-authenticated-user-id` and `oai-authenticated-user-email`. There is no signature, no shared secret, no origin check, and no allowlist. There is no `middleware.ts` anywhere in the repository (verified: none at root, `app/`, or `src/`), and `/signin-with-chatgpt` returns 404 locally because it is entirely the platform's route. Every authenticated surface — `app/api/result/route.ts`, `app/api/checkout/route.ts`, `app/api/billing/portal/route.ts`, `app/chatgpt-auth.ts` — funnels through that one function.

**Observed — end-to-end, not inferential.** A victim was seeded into the local D1 store (one `users` row with `external_subject = sec-victim-subject-9001`, one `active` `subscriptions` row, and one owned `humanization_jobs` row), reproducing exactly the state a real paying customer would be in. Then, from a plain shell with no session, no cookie, and no credential of any kind:

```
$ curl -s "http://localhost:3000/api/result?job=<victim-job>"
HTTP/1.1 401 Unauthorized
{"error":"Sign in to view this result."}

$ curl -s -H 'oai-authenticated-user-id: sec-victim-subject-9001' \
         -H 'oai-authenticated-user-email: attacker@evil.test' \
         "http://localhost:3000/api/result?job=<victim-job>"
HTTP/1.1 200 OK
{"original":"In today's busy world, it is important to note …",
 "result":"In today's busy world, clear communication plays a crucial role. …"}
```

The second response is the victim's complete paid rewrite. Two headers, no credential.

The billing portal authenticates the same forgery. `POST /api/billing/portal` with the same two headers returned **503 "Billing is not available yet."** — and that status is itself the proof: `app/api/billing/portal/route.ts:24` resolves the user and their Stripe customer ID *before* the Stripe client is constructed, so reaching the 503 branch means the forged identity successfully resolved to the victim's `cus_…`. It stops only because Stripe is unconfigured in this environment. With Stripe configured, that call returns a Billing Portal URL scoped to the victim's customer: invoices, payment method, cancellation.

**Also observed — the ownership check itself is sound.** Forging a *different* existing user's identity (`qa-user-A`) against the victim's job returned `404 {"error":"Result not found.","pending":true}`. There is no IDOR here. The defect is purely that identity is unauthenticated; every authorization decision downstream of it is correct.

**The second origin is real.** `.github/workflows/deploy.yml:44` runs `npx wrangler deploy --config dist/server/wrangler.json`. That file is generated by `vite.config.ts`, whose `localBindingConfig` sets neither `workers_dev: false` nor `routes` — verified in the generated artifact, which contains no `workers_dev` and no `routes` key. Wrangler's default with no route configured is to publish on the account's `*.workers.dev` hostname: an origin that by construction is not behind the ChatGPT hosting boundary.

**Exploit scenario.** An attacker who learns or guesses a victim's ChatGPT subject identifier sends two headers to the `workers.dev` origin and *is* that user. They read every unlocked rewrite the victim owns (`GET /api/result`), open a Billing Portal session against the victim's Stripe customer (`POST /api/billing/portal`) to view invoices and payment-method details or cancel the subscription, and can permanently claim a preview capability into an account of their choosing (`POST /api/checkout`). A subject identifier is an account identifier, not a credential — it is not designed to resist guessing, is not rotatable, and is the only thing between an attacker and full impersonation.

The threat table in this document already rates "Auth header spoof" **Critical** and names the required control: *"Hosting boundary strips/injects trusted headers; production origin not directly reachable; server helper only; deployment test."* None of the three is implemented or evidenced.

**Unverified portion.** The real production origin could not be tested — there is none yet, and `.openai/hosting.json` records only a `project_id`. If the platform turns out to be the sole reachable origin *and* it strips inbound `oai-*` headers, live risk drops sharply. But the repository's own deploy workflow creates a second origin, so this is not hypothetical; and the application has zero defence in depth if that assumption ever breaks — a route change, a custom domain, a platform migration, or someone running the deploy workflow as written.

**Plainly stated, as asked:** if this application is ever reachable other than through the trusted hosting boundary, it is **not safe**. It has no authentication at all in that configuration. Any anonymous internet user who can name a subject identifier becomes that user.

**Remediation.**
1. Set `workers_dev: false` and bind only the `ownword.pro` route in `vite.config.ts`'s `localBindingConfig`, so the generated Wrangler config never publishes a boundary-free origin; **and**
2. require a boundary-injected shared-secret header, compared in constant time, rejecting any request that lacks it — so a direct hit on *any* origin fails closed regardless of routing; **and**
3. add a deployment test that sends forged `oai-authenticated-user-*` headers at the production hostname and asserts 401.

Item 2 is the one that actually removes the single point of failure. Items 1 and 3 reduce the blast radius and prove it stays reduced.

### SEC-02 — High — RESOLVED 2026-08-26 — The paywall is extractable for free by shaping input; short inputs return the complete rewrite

> **Resolution.** The constant 8-word visible floor is gone. `src/lib/preview-projection.ts` now
> carries two constants instead: `MIN_HIDDEN_WORDS = 12`, enforced inside `projectPreview`, and
> `MIN_PAYWALLABLE_INPUT_WORDS = 25`, enforced at input validation in `app/api/humanize/route.ts`
> before any rewrite is attempted. A rewrite that cannot withhold 12 words returns
> `paywallable: false`, and the route turns that into a 422 rather than a complete rewrite with a
> price attached — deliberately *not* the ACT-01 `unchanged` path, since the text really was
> rewritten. The visible slice is also snapped back to the last complete sentence inside the
> budget, never rounded up to a later one.
>
> **Proved fixed, not assumed — `POST /api/humanize` was driven directly under plain Node:**
>
> - The exact 12-word body from the original finding now returns **400**
>   `"Add a little more context. At least 25 words works best."` The exploit's entry condition no
>   longer exists.
> - A sweep of realistic submissions from one to six sentences produced 8 paywalled 200s, 4
>   semantic-gate 422s, 6 sub-minimum 400s and 18 rate-limit 429s. **No response carried
>   `hiddenWordCount: 0`.** The worst visible fraction observed was 11 of 24 words — **45.8%**,
>   inside the 46% cap.
> - `projectPreview` was then driven directly across rewrite lengths 1 through 400: **zero** cases
>   where `paywallable` is true and `hiddenWordCount` is below 12. The invariant holds by
>   construction rather than by the input minimum happening to cover it.
>
> **Residual — the economics are bounded, not restored.** Up to ~46% of every submission still
> comes back free and unauthenticated, and because the preview ends on a sentence boundary,
> overlapping windows still reconstruct a document. The attacker's cost moved from roughly one
> request per 8 exposed words to one per 11, against a ceiling of 12 requests per 60 seconds per
> client key. That means a **rate limit** is now the control holding D-004's "the full product
> remains paid", which is SEC-03's territory, not this finding's. And under SEC-25 each of those
> requests can now cost the operator provider money, so what used to be pure paywall leakage is
> also a spend channel. The specific defect — the complete paid rewrite returned free, with
> nothing withheld — is closed.

**Original finding (2026-08-24), retained for the record:**


**Where.** `app/api/humanize/route.ts:125-128` — `partialPreview` exposes `Math.min(90, Math.max(8, Math.floor(words.length * 0.46)))` words of the rewrite. `app/api/humanize/route.ts:165` sets the minimum accepted input at 12 words. The endpoint requires no authentication and no capability.

**Observed.** A 12-word submission returned the whole rewrite:

```
$ curl -s -X POST /api/humanize -H 'x-idempotency-key: …' \
    -d '{"text":"It is important to note that clear communication plays a crucial role.","mode":"natural"}'
{"original":"It is important to note that clear communication plays a crucial role.",
 "preview":"Clear communication plays a crucial role.",
 "hiddenWordCount":0, …, "capability":"rXFvyf4g…"}
```

`hiddenWordCount: 0`. Nothing was withheld. The constant visible floor of 8 words means that whenever the rewrite is 8 words or shorter, the paid product is delivered in full, free, unauthenticated. `src/lib/preview-projection.ts:shouldOfferUnlock` correctly declines to render an unlock CTA in that state — which is honest, and is also precisely the point: there is nothing left to sell.

**Exploit scenario.** Split a document into overlapping ~12-word windows, submit each anonymously, reassemble. Each window yields at least 8 rewritten words, and shifting the window by 8 covers the seams. Cost to the attacker is one unauthenticated request per 8 words of output. The customer never pays and never signs in. D-004's "the full product remains paid" is defeated — not by leaking the hidden remainder (that boundary holds; see "What is genuinely sound") but by making the withheld fraction arbitrarily small through input shaping.

**Remediation.** Replace the constant visible floor with a fixed transparent fraction plus a *hidden*-word floor that scales with input: never expose more than ~40%, never hide fewer than N words, and refuse inputs short enough to make the policy meaningless. Treat any response that would carry `hiddenWordCount: 0` from the paid path as a bug, not as a preview. `ARCHITECTURE.md` already assigns "Partial preview selection" to PO + DES before M1-10; this finding is the security reason that decision cannot be deferred past launch.

### SEC-03 — Medium (was High), still open — Durable preview admission covers `/api/humanize` only; the other routes rely on authentication instead of a limiter

> **Re-status 2026-08-26 — severity lowered, because the blast radius collapsed.** The 2026-08-24
> text's worst case was "an unauthenticated attacker can drive unbounded Stripe API calls through
> `/api/billing/portal` with rotating forged identities." That required SEC-01, which is gone.
> Every paid-adjacent route now demands a real database-backed session, and the session cookie is
> refused on any Host other than `ownword.pro` / `www.ownword.pro`.
>
> **Observed — the route control matrix, exercised rather than grepped.** Each route below was
> imported and called directly with hostile inputs:
>
> | Route | Origin check | Session | Rate/concurrency limit |
> |---|---|---|---|
> | `POST /api/humanize` | — | fails closed on an unresolvable cookie | **D1-backed**, fails closed |
> | `POST /api/checkout` | 403 on `evil.test` | 401 without one | none |
> | `POST /api/billing/portal` | 403 on `evil.test` | 401 without one | none |
> | `DELETE /api/history/{id}` | 403 on `evil.test` | 401 without one | none |
> | `GET /api/result` | — | 401 without one | none — 3 rapid calls all answered |
> | `GET /api/preview` | — | n/a (capability) | isolate-local guard only |
> | `POST /api/events` | — | n/a | none — 3 rapid calls all 204 |
> | `GET /api/billing/readiness` | — | n/a | memoized per isolate (SEC-18) |
> | `POST /api/auth/request-link`, `/verify` | strict same-origin on the confirm POST | n/a | per-inbox / per-client (SEC-19, SEC-20) |
>
> **What an attacker gains today.** With a real account: unthrottled `POST /api/billing/portal`,
> one Stripe API call each, which is an authenticated amplifier against Stripe's rate limit rather
> than a way into anyone's data. Without an account: unthrottled `/api/events` (validated, stored
> nowhere, 204) and unthrottled `/api/result` 401s. The material residual exposure is the one SEC-02's
> residual names — anonymous `/api/humanize` at 12 requests per minute per client key is the only
> thing bounding both free paywall extraction and, under SEC-25, provider spend.
>
> **Still unverified, and still the deciding question:** whether the production edge presents the
> end user's address as `cf-connecting-ip`, or a single proxy address for everyone. If the latter,
> every customer shares one bucket of 12 requests per minute. This cannot be determined from the
> repository and was not testable here.
>
> **`GET /api/preview` is the one production route still on the isolate-local guard.**
> `app/api/preview/route.ts` constructs `new PreviewRequestGuard(...)` unconditionally — it does
> not fail closed onto the D1 guard the way `/api/humanize` does. Its per-isolate limit is
> therefore bypassable by spreading requests across isolates, and it is also where SEC-13's
> 256-entry ceiling remains reachable. Cost per admitted request is a few D1 reads, and no client
> code calls the route at all today, which is why this is Medium and not higher.

**Original finding (2026-08-24), retained for the record:**


**Current state.** `/api/humanize` now uses `DistributedPreviewRequestGuard` in
production. HMAC-keyed client/request/content identifiers, transactionally
batched fixed-window and active-lease checks, encrypted replay, fencing tokens, and
fail-closed binding/identity handling remove the per-isolate bypass described
below. Isolate memory remains an explicitly non-production fallback only.

**Historical observation.** Before the D1 guard, 20 rapid `/api/humanize`
requests against the dev server produced `200 200 429 429 …`; rotating a
client-supplied `cf-connecting-ip` bypassed that local-only control. Separately,
30 consecutive `/api/result` requests all returned 200, and 15 consecutive
`/api/billing/portal` requests all reached the Stripe branch. The latter route
coverage gap remains.

**Honest reading of the header-rotation result.** On real Cloudflare, `CF-Connecting-IP` is set by the edge and any client-supplied value is overwritten, so the rotation bypass observed above is a **dev-server artifact and is not by itself a production finding**. The 2026-08-23 draft claimed it as a live spoofing risk; that claim is withdrawn. What survives, and is enough on its own:

- **Shared-bucket collapse.** If the Worker sits behind the ChatGPT proxy and Cloudflare therefore sees the *proxy's* address, every customer in the world collapses into one shared bucket of 12 requests/minute and two concurrent requests. One user's normal activity throttles everyone else. Which branch applies is **unverified** — it depends on whether the platform forwards the end-user address, which cannot be determined from this repository.
- **Zero coverage where money is.** `/api/checkout`, `/api/result`, `/api/billing/portal`, and `/api/events` have no guard whatsoever. Combined with SEC-01, an unauthenticated attacker can drive unbounded Stripe API calls through `/api/billing/portal` with rotating forged identities.

**Remediation remaining.** Confirm the identity signal on the actual production
path, exercise D1 admission against real cross-colo contention, add an edge/WAF
layer for IP rotation and volumetric attacks, and extend appropriate protection
to checkout, result, billing, and event routes.

### SEC-04 — High — RESOLVED 2026-08-26 — `/api/checkout` never checks for an existing subscription, so a returning customer is charged twice

> **Resolution.** `app/api/checkout/route.ts` now calls `billing.getActiveEntitlement(db, userId)`
> and returns **409** `{ error: "You already have an active subscription.", alreadySubscribed: true,
> manageBillingPath: "/#manage-billing" }` before anything is claimed or charged. Ordering matters
> and is right: the check sits **above** `claimJobForUser`, so a refused second purchase does not
> also burn the customer's capability (which is what SEC-11 is about).
>
> The journey that produced the finding is closed twice over. A signed-in subscriber's
> `/api/humanize` request now takes the entitled branch (`completeEntitledRewrite`) and returns
> `{ result, paid: true }` with **no** `preview` and **no** `hiddenWordCount` — and
> `shouldOfferUnlock` requires both — so the unlock card cannot render for them at all. The 409 is
> the backstop for the one path that still reaches checkout: a subscriber who was signed out when
> they made the preview and signs in at the unlock step.
>
> **How this was proved.** The 409 branch itself is **code-verified**: it cannot be reached in this
> environment because `getStripeClient()` and the price-integrity call both run ahead of it and
> need real Stripe credentials. What *was* **observed** is the input the branch turns on: against a
> real SQLite database built from the real migrations, an active `subscriptions` row for a seeded
> user made `getActiveEntitlement` return `{ planId: "starter", subscriptionId: … }`, which is
> exactly the truthy value the route branches on. The branch is a straight-line early return with
> no intervening condition.
>
> **Residual.**
> - **No test covers the 409.** A repository-wide search for `alreadySubscribed` finds the route
>   and nothing else — no unit test, no E2E. The one branch standing between a returning customer
>   and a second $9.99/mo charge is uncovered, and `tests/checkout.test.mts` deliberately provides
>   no database, so it structurally cannot reach it. That is the highest-value missing test in the
>   repository.
> - **The client ignores the payload it is handed.** `app/landing-page.tsx` treats any non-200 as an error
>   and renders `payload.error` as text; it never reads `alreadySubscribed` or
>   `manageBillingPath`. The customer is told they are already subscribed and given no link to
>   their billing portal or their result. Remediation item "render *You're already subscribed*
>   with a link" is half done, and ACT-11's server-computed availability projection is still not
>   built.
> - Duplicate active subscriptions per customer are still not reconciled or alerted on in the
>   webhook projector, so a double-charge arriving by any other route stays invisible.

**Original finding (2026-08-24), retained for the record:**


**Where.** `app/api/checkout/route.ts` validates the plan, claims the capability (`:95`), reads the existing Stripe customer ID, and creates a Checkout Session (`:103`). At no point does it call `getActiveEntitlement`. `app/landing-page.tsx` is a client component with no identity or entitlement awareness at all — `getChatGPTUser` is referenced nowhere outside its own definition in `app/chatgpt-auth.ts` — so the unlock card, its price, and its CTA render identically for a brand-new visitor and for a paying subscriber.

**Why this is the default journey, not an edge case.** There is no history feature. The only way a subscriber can use what they paid for is to paste new text and run another rewrite. That returns a fresh preview with a fresh capability, which renders the unlock card again: *"Unlock full rewrite for $9.99/mo."* Clicking it, while already signed in, creates a second Checkout Session against the same Stripe customer. `{ idempotencyKey: "checkout:${jobId}:${planId}" }` (`:118`) is keyed per job, so it does not deduplicate across jobs — correctly, for its own purpose, but it means nothing here. Stripe does not refuse a second subscription to the same customer for the same price. The customer is now paying $19.98/month.

**Code-verified**; not exercised live because Stripe is unconfigured in this environment. The reasoning depends only on the absence of a check, which is directly observable, and on Stripe's documented default behaviour for subscription-mode Checkout.

**Downstream, the projection tolerates it silently.** `upsertSubscriptionFromStripe` keys on `stripeSubscriptionId`, so two active rows exist for one user; `getActiveEntitlement` returns the most recently updated one and everything appears normal. Nothing alerts. The customer discovers it on their card statement.

`docs/MONETIZATION.md`'s dark-pattern rules and this document's "Quota manipulation/race … double charge" row both cover this. Of every finding here, this is the one most likely to actually cost a real person real money in the first week.

**Remediation.** In `/api/checkout`, load `getActiveEntitlement` for the resolved user before creating a session; if one exists, return a distinct status and have the client render "You're already subscribed" with a link to the existing result and to the billing portal, rather than a purchase CTA. Implement ACT-11's server-computed availability projection so the unlock card knows the caller's state before it renders a price. Consider it defence in depth to also reconcile duplicate active subscriptions per customer in the webhook projector and alert on them.

### SEC-05 — High / Medium — RESOLVED 2026-08-26 — The advertised 50,000 words/month is enforced nowhere

> **Resolution.** `db/usage-ledger.ts` implements M2-07 as D-013 demanded: admission is **one
> statement**, a guarded `INSERT … SELECT … WHERE` that re-evaluates the balance inside the same
> write that records the reservation, with success decided by `meta.changes` and never by a
> re-read. `src/lib/paid-usage.ts` resolves the caller's entitlement, reads `wordLimit` from the
> server-owned catalog, and `app/api/humanize/route.ts` reserves before the pipeline runs and
> releases on any failure. A partial success commits only the words that came back.
>
> **Observed, against real SQLite built from the real migrations:**
>
> - **The advertised number is the enforced number.** 220 sequential 300-word reservations for a
>   Starter subscriber: **166 admitted, 54 refused**, the first refusal landing at 49,800 reserved
>   words with `{ allowance: 50000, remaining: 200 }`. 50,000 words per month is what the ledger
>   actually stops at.
> - **It does not race.** A user filled to 99 of 100, then 40 simultaneous one-word reservations:
>   **exactly one winner**, final consumed 100 of 100. This is the property D-013 refused to ship
>   without, and the repository's own precedent (`docs/MEMORY.md`) is that a concurrency test only
>   counts if a naive implementation fails it — `tests/usage-ledger.test.mts` records that having
>   been done.
> - `tests/pro-plan.test.mts` drives Pro's 200,000 against the same ledger and the same migrations,
>   and asserts the displayed feature bullet and the enforced `wordLimit` cannot drift apart.
>
> **Residual, and it is the whole of SEC-25.** The ledger governs *entitled* rewrites only. The
> anonymous `/api/humanize` path takes no reservation, because there is no account to charge it
> to — so the metered provider is reachable with no per-account ceiling at all by anyone who has
> not signed in. Quota enforcement answers "can a subscriber outspend their plan"; it does not
> answer "can a stranger outspend the business." See SEC-25.

**Original finding (2026-08-24), retained for the record:**


**Where.** `src/config/pricing.ts:11` declares `wordLimit: 50_000`. `src/lib/subscription-disclosure.ts:15` now renders that allowance into the purchase disclosure next to the unlock button (ACT-10), so it is a headline commitment at the point of sale. `db/schema.ts:278` defines `usage_entries` — and a repository-wide grep finds **no writer and no reader anywhere in the application**; the only other hits are the table's own indexes and check constraints. *Observed*: the local D1 `usage_entries` table has 0 rows after 120 persisted jobs. `getUnlockedResult` gates on entitlement + ownership only; there is no per-period accounting.

D-013 records this as deliberate: M2-07 was not implemented because a racy reservation would be worse than none. That reasoning is sound and this finding does not dispute it.

**Exploit scenario.** One $9.99 subscription confers unlimited generations and unlimited unlocks, indefinitely. Today the marginal cost is near zero — the provider is the local deterministic pipeline — so realised loss is small and the error favours the customer. The moment a real AI provider is wired in, this is unbounded cost per subscriber with no ceiling anywhere in the system.

**Remediation.** Implement M2-07 with the atomic "committed + active reservations + request ≤ allowance" admission step D-013 describes, with the concurrency test it demands, **before** any metered provider is connected. Until then, either soften the "50,000 words / month" claim wherever it appears (card, features list, purchase disclosure) or record an explicit acceptance that it is an unenforced ceiling.

### SEC-06 — High — RESOLVED 2026-08-26 — Customer writing is stored as indefinite plaintext, with no purge and no deletion path

> **Resolution.** All three halves of the finding are answered: there is a deletion path, there is
> a purge, and the promise is now a number rather than `PENDING`.
>
> - **Deletion is inline, not deferred.** `db/history-repository.ts:deleteHistoryEntryForUser`
>   voids `sourceRef`, `resultRef`, `previewProjection` and every `protected_items.valueRef` — and,
>   since M3-03, every `result_revisions` row — *inside the request that accepts the deletion*, so
>   the text is gone before the response is written. `jobPayloads.purgedAt` is the tombstone. The
>   route (`DELETE /api/history/{id}`) is behind a session and an Origin check (SEC-16).
> - **The queue exists and drains.** The delete enqueues a `deletion_jobs` row and a
>   `deletion_audit_events` record naming the subject, scope and authority — never text.
>   `vite.config.ts` declares `triggers: { crons: ["17 * * * *"] }`, present verbatim in the
>   generated `dist/server/wrangler.json`, and `worker/index.ts` has a real `scheduled()` handler
>   calling `runScheduledPurge`. The `"triggers":{}` the original finding quoted is gone.
> - **Anonymous retention is bounded and swept.** `purgeExpiredAnonymousPayloads` ages out
>   unclaimed anonymous payloads on the hourly cron, not only opportunistically on the write path.
>
> **Observed, against real SQLite built from the real migrations:** a 31-day-old anonymous payload
> holding `"MY SECRET DRAFT"` / `"MY SECRET REWRITE"` was swept to `sourceRef: ""`, `resultRef:
> null`, `purgedAt` set. A second pass over the same row purged **0** — idempotent. A payload five
> days old was left untouched, so the sweep is bounded by the published window rather than
> indiscriminate. `tests/purge-worker.test.mts` additionally asserts that no audit record and no
> queue row can contain source or result text.
>
> **The privacy notice now matches the code.** `/privacy` states 30 days for anonymous preview
> text, 24 hours for the capability itself, history kept until the customer deletes it, and — the
> sentence that makes it checkable — "A job that runs every hour enforces that sweep, so it does
> not depend on anyone else using the site." That is true of `["17 * * * *"]`.
>
> **Residual.**
> - **D-P04 is still Proposed.** `encryption_key_id` exists on the schema and nothing populates
>   it; payloads are plaintext in D1, protected by D1's at-rest encryption and by access control
>   only. That is a defensible answer but it has not been *decided* — the finding's "chosen by
>   default rather than by decision" still applies to encryption, just no longer to retention.
> - **Account deletion is still manual.** `deletion_jobs.scope` supports `full_account` and
>   `propagateAccountDeletion` implements it, but nothing enqueues one: `/privacy` directs the
>   customer to email support, and an operator must enqueue the row by hand. The runbook the
>   original finding asked for now has real tooling behind it, but it is still a runbook.
> - **The third-party-provider sentence went from over-disclosure to under-disclosure.** The
>   original finding flagged `/privacy` for claiming text goes to a provider when it did not. That
>   sentence has been corrected to "your text is not sent to any third-party AI provider" — which
>   is now the wrong way round the moment `HUMANIZATION_PROVIDER=claude` is set. See SEC-26.

**Original finding (2026-08-24), retained for the record:**


**Where and observed.** `db/repository.ts:141-142` writes `sourceRef: input.original` and `resultRef: input.result` — the customer's source text and the complete rewrite — directly into SQLite `text` columns (`db/schema.ts`, `job_payloads`). Reading the local D1 store directly:

- 120 `humanization_jobs` rows and 120 `job_payloads` rows, oldest dated **2026-08-23**, all still present.
- `encryption_key_id` is `NULL` on every row; `purged_at` is `NULL` on every row. Source and result are readable as plaintext straight out of the file.

There is **no** purge implementation of any kind. A repository-wide grep for `purgedAt`, `deletionJobs`, and `scheduled(` finds exactly one hit: the *read-side* tombstone check at `db/billing-repository.ts:311`. Nothing ever sets it. The generated `dist/server/wrangler.json` contains `"triggers":{}` — no cron, no scheduled handler. There is no deletion route.

The 24-hour `expiresAt` on `anonymous_sessions` stops *capability redemption* only. The job row, the protected-item rows, and the plaintext payload survive it indefinitely.

Persistence happens for **anonymous, unauthenticated** submissions (`app/api/humanize/route.ts` `tryPersist`, called unconditionally on every successful rewrite). The store therefore accumulates the writing of people who never created an account and have no mechanism — technical or contractual — to have it erased.

**Impact.** Launching today means indefinite plaintext retention of restricted-class customer content, chosen by default rather than by decision, with no ability to satisfy an erasure request through any tooling. This contradicts this document's own "Retention and deletion principles" and D-011, and it means **D-P01 (retention duration) and D-P04 (payload encryption) are not merely open — their absence is what ships.** A later decision to retain for 24 hours cannot retroactively delete what was kept from launch day onward.

`app/privacy/page.tsx` is honest about this: it marks retention as `PENDING` and states self-service deletion is "planned but not yet available," offering a manual email path instead. That honesty is why this is High rather than a "misleading deletion" Critical. It does not make the exposure acceptable, and note that the manual path has no tooling behind it — honouring it means an operator running ad-hoc SQL against production D1.

**Separately, in the safe direction:** that page states pasted text "is sent to a third-party AI provider." Today the pipeline is local and deterministic and no provider receives anything. Over-disclosure rather than under-disclosure, but COPY/LEGAL should reconcile it, and D-P05 must be resolved before that sentence becomes true.

**Remediation before charging.** Implement the 24-hour purge for unclaimed anonymous payloads — a scheduled Worker trigger, or purge-on-read as a stopgap. Decide D-P04 explicitly: either encrypt payloads with a key held outside D1, or record a dated Security acceptance that D1's at-rest encryption is the accepted control. State paid retention in the privacy notice with a number. Give the manual deletion promise an actual runbook.

### SEC-07 — Medium / launch-fatal — RESOLVED 2026-08-26 — Production D1 is never migrated

> **Resolution.** Both halves are fixed, and both were checked against the artifact rather than the
> intention.
>
> - `.github/workflows/deploy.yml` has an **Apply D1 migrations** step —
>   `npx wrangler d1 migrations apply DB --remote --config dist/server/wrangler.json` — placed
>   *before* the deploy, gated on the Cloudflare secrets being present. `DB` is the binding name;
>   `wrangler d1 migrations apply --help` in this tree confirms the positional accepts "the name or
>   binding of the DB", so the argument resolves.
> - `migrations_dir` is fixed. `vite.config.ts` passes the bare `"drizzle"` and lets vinext
>   re-relativize it; the **generated** `dist/server/wrangler.json` in this tree reads
>   `"migrations_dir": "../../drizzle"`, which resolves from `dist/server/` to the repository's real
>   `drizzle/` directory — 8 migrations, `0000_empty_eternals.sql` through `0007_mighty_devos.sql`.
>   None of them contains a trigger body, so Wrangler's remote statement splitting has nothing to
>   choke on (`docs/MEMORY.md` records why that matters).
>
> The step has been observed applying migrations against production by the operator. **That
> observation is not mine** — outbound access to the live host is blocked from this sandbox — and
> is recorded here as attributed, not verified.
>
> **Residual.** The post-deploy smoke test the remediation asked for — assert that a production
> preview response actually contains a `capability` — still does not exist. The failure mode the
> finding described is silent by construction (`tryPersist` swallows D1 errors deliberately, so
> that a driver error carrying the customer's text is never logged), so a *future* schema drift
> would again produce a site that renders previews and sells nothing, with no alert. The migration
> step removes today's cause; nothing yet detects tomorrow's.

**Original finding (2026-08-24), retained for the record:**


**Where.** `.github/workflows/deploy.yml` runs `npm ci`, `npm run build`, then `npx wrangler deploy`. It never runs `wrangler d1 migrations apply`. The generated `dist/server/wrangler.json` sets `"migrations_dir": "../../migrations"`, which resolves to a repository-root `migrations/` directory that **does not exist** (verified: `ls migrations` → No such file or directory). The schema actually lives in `drizzle/0000_empty_eternals.sql`.

**Impact.** Every D1 call in production throws. `tryPersist` swallows the error by design (`app/api/humanize/route.ts`), so previews still render — but no `capability` comes back, so `shouldOfferUnlock` is false and no unlock CTA is ever rendered. Nobody can buy anything. If it partially works, `claimJobForUser` fails and the customer is told "This preview link is no longer available" after clicking toward Stripe. The failure is silent by construction: no log (deliberately, to avoid leaking bound statement parameters — see SEC-14), no alert, no user-visible error.

**Remediation.** Add `npx wrangler d1 migrations apply site-creator-d1 --remote` to the deploy job, point `migrations_dir` at the real directory, and add a post-deploy smoke test asserting that a preview response contains a `capability`.

### SEC-08 — RESOLVED 2026-08-26 — Every production secret was exposed to `npm ci`'s lifecycle scripts

> **Resolution.** The install step now runs `npm ci --ignore-scripts` with every job-level credential blanked on that step. Verified empirically rather than assumed: a real clean install with scripts disabled builds and passes the whole suite. No package needs its install script — esbuild and workerd ship platform binaries in separate optional packages resolved at runtime, and fsevents is macOS-only.

**Residual:** the `npm run build` step still inherits all eleven job-level secrets and runs third-party code. That is remaining exposure and was out of the fix's scope.

**Original finding, retained for the record:**


> **Re-status 2026-08-26 — reproduced, and the blast radius grew.** The structure is unchanged and
> the exposure is now total. `.github/workflows/deploy.yml` still declares its secrets at **job**
> scope, and the list has grown from three to eleven since 2026-08-24:
> `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID`,
> `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`,
> `PREVIEW_GUARD_SECRET`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `AUTH_EMAIL_FROM`. Every one of
> them is in `process.env` for the `npm ci` step.
>
> **That is the application's entire secret set.** The Worker's own `--secrets-file` lists seven
> names; all seven are here, in an earlier step, alongside a Cloudflare token that can deploy
> Workers and read D1. A single compromised transitive dependency executing at install time takes
> the deploy credential, the Stripe live key, the webhook secret, the preview guard's HMAC and
> encryption key, the mail credential, and the Anthropic key in one read.
>
> **Observed.** There is no `.npmrc` anywhere in the repository and no `--ignore-scripts` on any
> `npm` invocation in `.github/`, so lifecycle scripts run. Parsing `package-lock.json` in this
> tree: **7 of 654 packages declare an install script today** — `esbuild` (three separate copies),
> `workerd`, `fsevents` (two copies). The count is not the exposure; any of the other 647 becomes
> one the moment a compromised release adds a `postinstall`.
>
> **Why this is now High rather than Medium.** In August this was one token guarding an
> unlaunched application whose stored writing was worth little. It is now the credential set for
> live payments, customer mail, and a metered AI account that can be billed by whoever holds the
> key. `docs/SECURITY.md`'s own release-blocker list names "exposed secrets".
>
> **Remediation, unchanged and still small.** Move each secret onto the single step that needs it —
> Cloudflare onto **Apply D1 migrations** and **Deploy via wrangler**, `D1_DATABASE_ID` onto the
> build step, the Stripe/Resend/Anthropic values onto the deploy step's `printf` only. Consider
> `npm ci --ignore-scripts` plus an explicit rebuild of the packages that genuinely need one. The
> `environment: production` gate is a good control and should stay.

**Original finding (2026-08-24), retained for the record:**


**Where.** `.github/workflows/deploy.yml:18-21` declares `CF_API_TOKEN`, `CF_ACCOUNT_ID`, and `CF_D1_ID` at **job** scope, so they are present in the environment of every step — including `npm ci`, which executes third-party postinstall scripts across the dependency tree.

**Exploit scenario.** A single compromised transitive dependency reads `CF_API_TOKEN` from `process.env` during install and exfiltrates it. That token can deploy Workers and read D1 — i.e. it is equivalent to the whole application plus every customer's stored writing (which, per SEC-06, is plaintext and unexpiring).

**Remediation.** Move the two Cloudflare secrets onto the `Deploy via wrangler` step only, keeping `D1_DATABASE_ID` on the build step where it is genuinely needed. The existing `environment: production` gate is a good control and should stay.

### SEC-09 — Medium, still open — CSP permits `'unsafe-inline'` for scripts, so it is not the XSS control the threat model claims

> **Re-status 2026-08-26 — reproduced, unchanged.** Still true, and now confirmed in the shipped
> artifact rather than only in source. The policy `worker/index.ts` sets on **every** response, read
> back verbatim out of the built `dist/server/index.js`:
>
> ```
> default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none';
> form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
> img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'
> ```
>
> **What it actually allows, stated plainly:** any inline `<script>` and any inline event handler,
> because of `'unsafe-inline'` on `script-src`; and any inline `style` attribute. **What it
> actually blocks:** every off-origin script, stylesheet, font, XHR/fetch/WebSocket destination
> and frame ancestor, plus `<base>` rewriting, plugins, and form posts to another origin.
>
> The operator reports a Cloudflare Insights beacon being blocked in production, which is
> consistent with `script-src 'self'` and `connect-src 'self'` — the off-origin half of the policy
> is enforcing. **That observation is not mine**; the live host is unreachable from this sandbox.
>
> The 2026-08-24 conclusion stands and the reasoning behind it was not re-litigated: React's text
> escaping is the control that actually holds, the only `dangerouslySetInnerHTML` in the codebase
> is still the static JSON-LD block, and no injection is known. Severity unchanged: CSP should not
> be carried on the required-controls list for XSS while it is permissive.

**Original finding (2026-08-24), retained for the record:**


**Where.** `worker/index.ts:52` — `script-src 'self' 'unsafe-inline'`. *Observed* live on every response from the running server.

The threat table lists CSP as a required prevention for stored/reflected XSS. With `'unsafe-inline'`, CSP would not stop an injected inline script or event handler. The control that actually holds today is React's text escaping.

**That escaping was re-verified and it holds.** *Observed*: a submission containing `<script>alert(1)</script>`, `"><img src=x onerror=alert(2)>` and `javascript:alert(3)` round-tripped through `/api/humanize` as inert JSON (`content-type: application/json`, `x-content-type-options: nosniff`) and is rendered as a React text child in `app/landing-page.tsx` (`{result.original}`, `{result.preview}`) and `app/checkout/success/page.tsx` (`{result.original}`, `{result.result}`). The only `dangerouslySetInnerHTML` in the entire codebase is `app/landing-page.tsx:170`, static JSON-LD built from server config with `<` escaped to `<`. A grep for `innerHTML` and `eval(` across `app/` and `src/` finds nothing else. There is no known injection today.

**Remediation.** Move to nonce- or hash-based `script-src` and drop `'unsafe-inline'`. Not a blocker on its own — but CSP should not be carried on the required-controls list while it is permissive.

### SEC-10 — Low/Medium, still open — Capability tokens are accepted in a URL query string on a Worker with observability enabled

> **Re-status 2026-08-26 — reproduced, unchanged.** `app/api/preview/route.ts` still reads the
> capability from `?capability=`, and the generated `dist/server/wrangler.json` in this tree still
> carries `"observability":{"enabled":true}`, so request URLs are captured in Workers Logs.
>
> Still latent for the same reason: a repository-wide search finds **no caller** of `/api/preview`
> in any client code. `app/landing-page.tsx` holds the capability in React state and sends it in the
> `/api/checkout` POST body; the Stripe `success_url` carries a job id, never a capability. The
> endpoint accepts the query form and nothing produces it.

**Original finding (2026-08-24), retained for the record:**


**Where.** `app/api/preview/route.ts:28` reads the capability from `?capability=`. The generated `dist/server/wrangler.json` sets `"observability":{"enabled":true}`, so request URLs are captured in Cloudflare Workers Logs.

A capability is a bearer token: it redeems a preview and, through `/api/checkout`, permanently claims the job to whoever presents it. In a query string it lands in platform logs, browser history, and `Referer` headers. Latent today — `app/landing-page.tsx` keeps the capability in React state and sends it in a POST body, so the query form is currently unused by the UI — but the endpoint accepts it.

**Remediation.** Accept the capability in a header or POST body. If the query form stays for refresh recovery, redact it at the log boundary and shorten its TTL.

### SEC-11 — Low, still open (narrowed) — Checkout consumes the one-time capability before payment

> **Re-status 2026-08-26 — reproduced, narrowed.** `claimJobForUser` still runs before
> `stripe.checkout.sessions.create`, so an abandoned or failed checkout still leaves `consumed_at`
> set on a customer whose entitlement never arrived.
>
> Two things narrowed it. SEC-04's entitlement check was inserted **above** the claim, so an
> already-subscribed customer is turned away at 409 without their capability being spent — the one
> case where burning it would have been most annoying. And there is a history surface now
> (`app/history`), so a customer who does complete payment has another way back to their work. The
> case that remains is a customer who abandons checkout: their preview is unreachable and they hold
> no entitlement, and history only lists rewrites made while signed in and entitled.
>
> Still not exploitable across users, for the reasons the original finding gives.

**Original finding (2026-08-24), retained for the record:**


`app/api/checkout/route.ts:95` calls `claimJobForUser` before the Checkout Session is created at `:103`. An abandoned or failed checkout leaves `consumed_at` set, so `/api/preview` no longer redeems that capability while the user holds no entitlement — their own preview becomes unreachable, and with no history feature there is no other way back to it.

Not exploitable across users: the token is a 256-bit secret, and same-user retry is handled correctly by the recovery branch in `claimJobForUser` (which returns the same `jobId` to the user who already owns it, and `null` to everyone else). This is a self-inflicted denial of the customer's own preview and a predictable support burden, not a security hole.

**Remediation.** Defer consumption until the Checkout Session is successfully created, or keep the preview projection readable to the owning user after consumption.

### SEC-12 — Informational (was Low) — Stripe return URLs are derived from the request's own Host

> **Re-status 2026-08-26 — the exploit path is closed by containment; the hygiene item stands.**
> Both routes still compute `const origin = new URL(request.url).origin`. What changed is that
> nothing can reach that line under a Host this application does not own.
>
> **Observed.** With a production runtime environment recorded and a well-formed session cookie
> presented, `readSessionCookie` was called across five Host values:
>
> | Host | trusted identity host | session read |
> |---|---|---|
> | `ownword.pro` | yes | yes |
> | `www.ownword.pro` | yes | yes |
> | `attacker.test` | no | **no** |
> | `humanizer.workers.dev` | no | **no** |
> | `localhost` | no | **no** |
>
> `src/lib/identity.ts:readSessionCookie` gates on `isTrustedIdentityHost` before it parses a
> cookie jar, and `isDevHost` returns false outright on a production binding (SEC-22). Both
> `/api/checkout` and `/api/billing/portal` refuse with 401 before `origin` is ever computed, so an
> attacker-chosen Host cannot produce an attacker-chosen `success_url`. `workers_dev: false` plus
> two bound custom domains means there is no second origin to try in the first place.
>
> **Residual.** Deriving the origin from `productConfig.domain` is still the right shape, and the
> `www` custom domain still produces `www`-scoped Stripe return URLs when a request arrives there
> (the Worker 308s `www` to the apex first, so this is cosmetic). Hygiene, not risk.

**Original finding (2026-08-24), retained for the record:**


`app/api/checkout/route.ts:100` and `app/api/billing/portal/route.ts:39` both compute `const origin = new URL(request.url).origin` and embed it in `success_url` / `cancel_url` / `return_url`. In a Worker, `request.url` is reconstructed from the inbound Host header.

**Code-verified; not exercised** — Stripe is unconfigured here, so no session could be created to inspect. Practically constrained: Cloudflare routes by hostname, so an arbitrary Host does not reach this Worker, and the only leak would be the attacker's *own* job ID going to their own domain. Worth fixing as hygiene once routes are bound (SEC-01 remediation item 1), by deriving the origin from server configuration (`productConfig.domain`) rather than from the request.

### SEC-13 — Low — RESOLVED for `/api/humanize`, still reachable on `/api/preview`

> **Re-status 2026-08-26.** The 256-entry ceiling is in `PreviewRequestGuard`, the isolate-local
> class. `app/api/humanize/route.ts` can no longer use it in production:
> `requestGuardForRuntime()` returns the D1-backed `DistributedPreviewRequestGuard` when the
> binding and `PREVIEW_GUARD_SECRET` are both present, and returns **null** — a 503 — otherwise,
> unless `ENVIRONMENT` explicitly says `development`/`local`/`test`. The distributed guard has no
> `maxEntries` ceiling and no global 429 path at all, so on the route the finding was written
> against, the defect no longer exists. **Code-verified**, not observed: the branch turns on the
> `cloudflare:workers` binding, which plain Node cannot provide.
>
> **Residual — `app/api/preview/route.ts` still constructs `new PreviewRequestGuard(...)`
> unconditionally**, with no distributed alternative and no fail-closed branch. The 256-entry
> ceiling, and the 429-everyone-in-this-isolate behaviour it produces, are live there. Reaching it
> needs 256 genuinely concurrent in-flight redemptions, which the per-client `maxConcurrent: 2`
> makes a ~128-distinct-address exercise; the payload is a few D1 reads; and no client code calls
> the route. Still Low, and now filed under SEC-03's route-coverage residual as well.

**Original finding (2026-08-24), retained for the record:**


`src/lib/preview-request-guard.ts:68` returns 429 "Preview capacity is temporarily full" to *any* caller once `this.requests.size >= maxEntries` (256, `:32`). `cleanup()` at `:137` evicts settled entries first, so this only fires when 256 requests are simultaneously **in flight** — which the per-client `maxConcurrent: 2` limit prevents for a single client identity, but not for a client able to present many identities or open many connections.

**Code-verified**, not exercised: building 256 genuinely concurrent in-flight requests against the deterministic local pipeline was not achievable here. Low, and it disappears once SEC-03's durable limiter replaces this map.

### SEC-14 — Informational — `npm audit`'s 4 moderate findings are not exploitable here

> **Re-status 2026-08-26 — re-run, not quoted from cache.** `npm audit` in this tree reports
> **4 moderate, 0 low, 0 high, 0 critical**, and `npm audit --omit=dev` reports **0
> vulnerabilities**. Identical to August, and the same single root:
>
> ```
> drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild@0.18.20
> ```
>
> GHSA-67mh-4wv8-2f99, concerning `esbuild serve`, which this project never runs. `npm ls esbuild`
> confirms the vulnerable copy is reachable only through that devDependency chain; the other three
> esbuild copies in the tree (`tsx`, `vite`, `wrangler`) are 0.25/0.28 and unaffected. The
> assessment is unchanged: not a launch risk, do not inflate it, track for upgrade when
> `drizzle-kit` drops `@esbuild-kit`. **The real supply-chain exposure here is SEC-08, which is now
> High.**

**Original finding (2026-08-24), retained for the record:**


*Observed*: `npm audit --omit=dev` reports **0 vulnerabilities**. The full `npm audit` reports 4 moderate, all tracing to one root: `esbuild <= 0.24.2`, GHSA-67mh-4wv8-2f99 — *"esbuild enables any website to send any requests to the development server and read the response."* It reaches the tree only through `drizzle-kit`, a devDependency, via `@esbuild-kit/core-utils` → `@esbuild-kit/esm-loader`. The advisory concerns `esbuild serve`, which this project never runs, and esbuild is not among the production dependencies.

**Assessment: genuinely not a launch risk.** Do not treat it as a blocker and do not inflate it. Track for upgrade when `drizzle-kit` drops `@esbuild-kit`. The real supply-chain exposure in this repository is SEC-08, not any specific package.

### SEC-15 — Informational — Test/live Stripe identifier mixing: resolved, with a residual

> **Re-status 2026-08-26 — residual unchanged, and now overdue.** The livemode check is still in
> place and still covered. The residual is not: `app/api/webhooks/stripe/route.ts` catches a failed
> `constructEventAsync` and returns a bare 400 with **no logging of any kind**, and neither the
> route nor `src/lib/stripe-webhook-projection.ts` contains a single `console.*` call. A wrong
> *account* webhook secret — undetectable by static inspection — therefore produces silence:
> customers are charged, no entitlement is ever projected, and nothing anywhere says so. A
> content-free counter or a rate-limited `console.error` on signature-verification failure is the
> only detector this class of misconfiguration has, and it is the cheapest item in this document.

**Original finding (2026-08-24), retained for the record:**


The 2026-08-23 draft raised that `SECRET_KEY_PATTERN` validated only key shape and the `whsec_` prefix, so a live key paired with a test webhook secret would fail every real subscription webhook signature — charging customers who are then never unlocked. That is now closed, and re-verified in this review: `src/lib/stripe-config.ts` derives `mode`/`livemode` from the secret key; `src/lib/stripe-webhook-projection.ts:ingestVerifiedStripeEvent` rejects any event whose own `livemode` disagrees **before** the inbox insert, returning 400 rather than 500 so a misconfiguration does not become a retry storm; `app/api/webhooks/stripe/route.ts:96` passes `config.livemode`. `tests/stripe-config.test.mts` and `tests/webhook-adversarial.test.mts` cover the branches, and the full suite passes 126/126.

**Residual, unchanged:** a wrong-*account* (not wrong-mode) webhook secret is still undetectable by static inspection, and the first webhook signature failure produces no alert anywhere. Add a webhook-failure alert per this document's observability requirements — it is the only detector for that class of misconfiguration.

## SEC-16 … SEC-24 — the sign-in hardening set (2026-08-25/26)

These nine were raised and (bar one) fixed in PR #27, *after* the review above was written, and
their reasoning was recorded in code rather than here. Recording them in this document is not
duplication — it stops the numbers being reused and stops a later reviewer concluding that the
gap between SEC-15 and SEC-25 means nothing happened. **Confirmed 2026-08-26** against the code;
each carries the marker or test cited.

| # | Severity | Finding | Status | Where the record lives |
|---|---|---|---|---|
| SEC-16 | Medium | `DELETE /api/history/{id}` was the one state-changing route with no Origin check. A real DELETE carrying `Origin: https://evil.test` and a valid cookie was answered 200 while the sentence route on the same job answered 403. | Fixed | `src/lib/history-access.ts:184`; `tests/history-access.test.mts:457` |
| SEC-17 | High | Login CSRF. An attacker mailed a customer the attacker's own magic link; clicking it signed the customer's browser into the attacker's account, silently, because no page named the account. Fixed with a per-browser link nonce plus a confirmation POST, and an account indicator showing the address. | Fixed | `src/lib/magic-link.ts:321,411`; `src/lib/identity.ts:57`; `tests/magic-link.test.mts:709+` |
| SEC-18 | Medium | `GET /api/billing/readiness` was an unauthenticated 1:1 amplifier into `stripe.prices.retrieve()`, fetched on every landing-page load. Exhausting Stripe's read limit tells real customers checkout is unavailable. Fixed by a per-isolate memo with a clock. | Fixed | `src/lib/billing-readiness.ts:44`; `tests/landing-activation.test.mts:68` |
| SEC-19 | Medium | The per-address mail-bomb bound counted the exact string typed, so ten `+tag`/dot aliases of one Gmail address each got their own budget — 3× the documented figure, delivered to one inbox as correctly-signed mail from a verified domain. Fixed by folding to the canonical inbox. | Fixed | `src/lib/magic-link.ts:69,276`; `src/lib/identity.ts:240` |
| SEC-20 | Low/Medium | Magic-link redemption had no bound at all: 25 invented tokens produced 25 redirects and 50 UPDATEs. Not credential guessing (256-bit CSPRNG) but a free unauthenticated write amplifier against the database that also serves entitlement and quota. | Fixed | `src/lib/magic-link.ts:83,449,534` |
| SEC-21 | Medium | `/signin` re-implemented the `return_to` guard as a local `startsWith("/") && !startsWith("//")` instead of using the canonical one — a second, weaker copy of an open-redirect check. Deleted in favour of the single guard. | Fixed | `app/signin/page.tsx:32`; `tests/security-blockers.test.mts:198` |
| SEC-22 | Low | `isSecureRequest` read `x-forwarded-proto` *before* the request URL. On a Worker that is backwards: the URL is runtime-populated and unforgeable, the header is not. Only self-denial was reachable, but two stated properties — Secure is never dropped, the unprefixed cookie name is dev-only — rested on a client-controlled value. | Fixed | `src/lib/identity.ts:108,137`; `worker/index.ts:76`; `tests/security-blockers.test.mts:293` |
| SEC-23 | Low | The per-address rate limit is an activity oracle: five requests against one address reveal whether someone signed in with it recently. | **Deliberately not fixed** | `src/lib/magic-link.ts:101` |
| SEC-24 | Nit | `Origin: null` — an opaque origin from a sandboxed iframe or `file://` page — was treated as a *missing* Origin and allowed. A missing Origin stays allowed, as judged; `null` does not. | Fixed | `src/lib/identity.ts:497` |

**SEC-23 is the one to read.** The reasoning in `src/lib/magic-link.ts:101` is that the cheap fix
— answering a throttled request with the same "check your inbox" as an accepted one — would make
this module lie to the customer about mail that was not sent, which is exactly the failure it
exists to prevent, and the customer lied to is the one being mail-bombed. It also states honestly
that SEC-19's inbox folding *widened* the oracle from one spelling to one inbox. **That is the
right trade and the right way to record it.** Re-affirmed here, not re-litigated. The named fix
shape — a per-client probe budget consulted before the address bucket — remains open work.

**Observed here, for SEC-24 specifically**, since it is a one-line predicate that is easy to
regress: `isCrossSiteRequest` was driven across six Origin values. `null` → cross-site.
`https://evil.test` → cross-site. `https://ownword.pro.evil.test` → cross-site. `https://ownword.pro`
→ same-site. A missing Origin → allowed, as designed for non-browser callers.

*One residual noticed while probing it, too small for its own number:* both `isCrossSiteRequest`
and `isSameOriginRequest` compare `URL.host` only, so `Origin: http://ownword.pro` is accepted on
an `https://ownword.pro` request. Not independently exploitable — schemeful same-site means a
browser will not attach the `SameSite=Lax` session cookie across that scheme boundary anyway, and
`__Host-`/`Secure` keeps it off plain http — but comparing `origin` rather than `host` costs
nothing and removes the reasoning step.

## New findings, 2026-08-26

Numbering continues from SEC-24. All three arrived with work that landed after the review above.

### SEC-25 — RESOLVED 2026-08-26 — A metered AI provider was reachable from an unauthenticated route with an alarm and no ceiling

> **Resolution.** A distributed spend budget now reserves the per-rewrite ceiling **before** the provider call, atomically, in the preview guard's existing D1 table under a reserved key. No migration. Admission is decided on `result.meta.changes`; actual cost settles the reservation afterwards, and a sustained breach burns the rest of the window. Refusal is a 503 with `retry-after` and no usage charged, never a 500.

**Proved against the old code** on this finding's own scenario: 50 rewrites at 50× the ceiling went from 50 served / 0 refused / ~$250 to **1 served / 49 refused / $5**. Atomicity across 40 concurrent instances, window roll, and refusal when D1 is unreachable are all covered.

**Residual:** the ceiling (~$30/hour globally) is a safety number chosen to stop a bleed, not a product decision, and the entitled path still has no second ceiling beyond the word ledger.

**Original finding, retained for the record:**


**Where.** `app/api/humanize/humanization-runtime.ts` selects `ClaudeHumanizationProvider` when
`HUMANIZATION_PROVIDER=claude` and `ANTHROPIC_API_KEY` are both set (M4-01, PR #29).
`app/api/humanize/route.ts` requires **no authentication**: an anonymous caller reaching the
non-entitled branch gets a full pipeline run — a real model call, and a second sample if the first
fails verification — with a 45-second budget. SEC-05's ledger governs *entitled* rewrites only;
the anonymous path takes no reservation because there is no account to charge.

**The only thing between an anonymous caller and the provider's meter is a rate limit.**
`PREVIEW_GUARD_LIMITS` is 12 requests per 60 seconds per client key, and the client key is derived
from `cf-connecting-ip`. Whether that is one bucket per user or one bucket for the entire customer
base is SEC-03's open question, and it cuts both ways here: per-address buckets mean an attacker
with many addresses has many budgets.

**The cost guard is an alarm, not a control — observed.** `RewriteCostGuard.record()` returns a
`CostAlarm` and calls `console.error`; `app/api/humanize/route.ts` discards the return value.
Driven directly: 50 rewrites at 50× the per-rewrite ceiling produced **50 alarms and 0
refusals**, a simulated $250 of spend, and the pipeline would have served every one of them.
There is no spend ceiling, no daily cap, and no kill switch anywhere in the repository.

**What an attacker gains.** Nothing of the customer's — this is purely an economic attack on the
operator. At the guard's own per-rewrite alarm ceiling of $0.10, one client key can drive
**$72/hour**; `docs/BENCHMARKS.md`'s model puts a realistic 250-word Opus rewrite at $0.011–$0.086,
so $8–$62/hour per address is the honest range, multiplied by however many addresses the attacker
has. SEC-02's residual is the same requests with a different motive: the words extracted are free
to the attacker and now billable to the operator.

**Not live today, and that is the whole of the conditionality.** `resolveHumanizationProvider`
fails closed to the deterministic engine unless `HUMANIZATION_PROVIDER` explicitly says `claude` —
**observed**: passing only `ANTHROPIC_API_KEY` yields
`{ provider: "deterministic", reason: "not-configured" }`. But `ANTHROPIC_API_KEY` is a **required**
gate secret in `.github/workflows/deploy.yml` (the deploy fails without it), so the key is present
in production by construction and only the optional `HUMANIZATION_PROVIDER` variable stands
between here and a live meter.

**Remediation.** Before `HUMANIZATION_PROVIDER=claude` reaches production: give the anonymous path
a spend ceiling that *refuses* rather than logs — a global per-window budget in the same D1 store
the preview guard already uses is the shape the codebase already has — and decide whether an
unauthenticated visitor should reach a metered model at all, or whether the free preview should
stay deterministic and the model be an entitled-only capability. The second is smaller, cheaper,
and closes SEC-02's residual at the same time. That is a PO/Product decision, not this document's.

### SEC-26 — RESOLVED 2026-08-26 — `/privacy` promised no third-party AI provider, and one optional deploy secret made that false

> **Resolution.** The disclosure is now derived from the same `resolveHumanizationProvider(env)` the pipeline calls, and the processor catalog is typed as a total record over the non-deterministic provider names, so **adding a provider without writing its disclosure does not compile**. No literal denial, provider name, or subprocessor count survives in the copy.

Unconfirmed region, retention and training terms are marked unconfirmed and the page says they are being confirmed; zero retention is explicitly disclaimed; and a test fails if GDPR, CCPA, SOC 2, HIPAA, "compliant" or "certified" ever appears, because none has been audited.

**Proved against the old code:** the tests fail on `main`'s previous page, and a third greps the built output and fails against the pre-fix build.

**Residual:** this is customer-facing legal copy written without counsel. M4-03 now covers it.

**Original finding, retained for the record:**


**Where.** `app/privacy/page.tsx` states, in the present tense and without qualification:

> "Today your text is not sent to any third-party AI provider. Rewrites are produced by a
> deterministic engine that runs on our own infrastructure, so the text you paste stays within the
> service. If we later introduce a third-party model provider, we will name it here, state its
> retention and training terms, and update this page before that change takes effect."

and, in "Who else handles your data", names exactly three companies — Cloudflare, Stripe, Resend —
followed by "Nobody else receives your writing."

**The gap.** Setting `HUMANIZATION_PROVIDER=claude` sends the customer's complete draft to
Anthropic on every rewrite. Nothing couples that switch to the page. **Observed**: a
repository-wide search finds no reference to Anthropic, to a provider name, or to
`HUMANIZATION_PROVIDER` anywhere in `app/privacy/page.tsx` or `app/terms/page.tsx`; no test asserts
the coupling; and no deploy-time check fails when the provider is on and the disclosure is not.
The privacy page's own promise — "we will update this page **before** that change takes effect" —
is enforced by nothing but memory, on a change that is one optional GitHub secret.

**Why this is High and not a copy nit.** This document already carries the exact requirement, in
"Third-party AI disclosure principles": *"Before customer text is sent, the privacy notice must
clearly identify each production AI provider … provider retention period/settings, training
policy … Changing a provider is a privacy/security change, not a silent model configuration
tweak."* It is a silent configuration tweak today. The release-blocker list names
"undisclosed/unapproved provider use" outright, and the M4-01 subsection above already records
that the model provider exists and that the injection corpus has never been run against it. `docs/DECISIONS.md`'s **D-P05 is still under
"Proposed; must resolve before named milestone"** — nobody has approved a production provider set,
recorded Anthropic's retention and training terms, or checked whether zero-retention is available
on this account. M4-01 shipped the provider; the decision M4 was supposed to gate it behind did
not. A privacy notice that is false is a different class of problem from one that is vague: the
first is a representation a customer relied on.

**Nothing here says the provider is misconfigured.** No claim is made about Anthropic's actual
retention or training terms — that is precisely what D-P05 exists to establish and what has not
been done.

**Remediation.** Do not deploy with `HUMANIZATION_PROVIDER=claude` until (a) D-P05 is decided and
recorded with the processor's actual retention and training terms, (b) `/privacy` names the
provider, states those terms, and drops the "not sent to any third-party" sentence and the
three-company list, and (c) something mechanical ties the two together — the pattern this
repository already uses is `tests/security-blockers.test.mts` asserting a workflow and a code path
agree, and the same shape works here: a test that fails if the provider catalog names a processor
the privacy page does not.

### SEC-27 — RESOLVED 2026-08-26 — The cost guard's sustained-breach flag read clean during exactly the runaway it existed to catch

> **Resolution.** `evaluateSustained()` is split out and runs before the per-rewrite branch, so both checks evaluate on every observation and both are raised when both come due. 60 rewrites at $5.00 now report `sustainedBreach: true`.

**Residual:** `humanizationCostSnapshot()` still has no caller anywhere in the repository, so nothing surfaces these numbers operationally.

**Original finding, retained for the record:**


**Where.** `src/lib/humanization/cost-guard.ts:record()`. When an observation breaches the
per-rewrite ceiling, the method raises that alarm and **returns**, so the sustained-cost-per-word
evaluation below it never runs and `this.sustainedBreach` is never set.

**Observed — two guards, identical thresholds, identical token profiles:**

| Scenario | cost/word | ceiling | `sustainedBreach` | `perRewriteBreaches` |
|---|---|---|---|---|
| A — 60 rewrites at $5.00 each (a real runaway) | $0.025 | $0.0000475 | **false** | 60 |
| B — 60 rewrites at $0.09 each (55× cheaper) | $0.00045 | $0.0000475 | **true** | 0 |

The economically worse state reports clean and the better one reports breaching. Adding a single
sub-ceiling rewrite after scenario A flips the flag to `true`, which confirms the mechanism: the
early return, not the arithmetic.

**Why this is Low and not higher.** The per-rewrite alarm still fires on every one of those 60
rewrites, so an operator watching logs is not silent — they are told sixty times. And
`humanizationCostSnapshot()`, the only reader of the flag, currently has **no caller anywhere in
the repository**, so the wrong value is not yet displayed to anyone. It is filed because the
snapshot is the intended operational view for SEC-25's spend problem, and it will be wrong in the
one case that matters on the day something reads it.

**Remediation.** Evaluate the sustained check before returning the per-rewrite alarm, or record
the breach state without returning early. One test: assert that a window of uniformly
over-ceiling rewrites reports `sustainedBreach: true`.

## What is genuinely sound

Verified in this review and recorded deliberately, so a later reviewer does not re-litigate it. Several of these are better than the threat model requires.

- **Auth *authorization* — correct, even though authentication is not.** *Observed*: with a forged identity belonging to a different existing user, the victim's job returned an identical `404 {"error":"Result not found.","pending":true}`. `db/billing-repository.ts:getUnlockedResult` requires entitlement **and** `job.ownerUserId === userId` **and** `state === "succeeded"` **and** a non-purged payload. There is no cross-user IDOR. SEC-01 is an identity-forgery problem, not an authorization problem — which matters, because it means fixing the boundary fixes it completely.
- **Enumeration oracle — holds on every path, including the ones that are hard.** *Observed*: `/api/preview` returned a byte-identical `404 {"error":"This preview link is no longer available."}` for all five states — valid-shape unknown token, malformed token, missing parameter, **already-consumed** capability, and **expired** capability (the last two produced by mutating the local store directly). `/api/result` returned identical `404 … pending:true` for an unknown external subject, a known user with no entitlement, a known user querying someone else's job, and a known user querying a nonexistent job. In code, `db/repository.ts:redeemPreviewCapability` and `claimJobForUser` collapse unknown/expired/consumed into a single `null`, and the same-user recovery branch reveals ownership only to the caller who already owns it.
- **No reproducible timing oracle.** *Observed*: 60 samples per class, repeated twice, against `/api/result` for unknown-subject / known-user-not-owner / known-user-bogus-job. p50s clustered at 25–30 ms with no stable separation and inconsistent ordering between runs. The 2026-08-23 draft left this "not excluded"; it can now be downgraded to "measured locally, no separation observed." This is not proof for production network conditions, but it is no longer an open concern.
- **Capability model — exactly as specified.** 32 bytes from `crypto.getRandomValues`, base64url-encoded (*observed*: 43-character tokens), only the SHA-256 digest persisted (`db/repository.ts:digestCapabilityToken`), and a unique index on `anonymous_sessions.job_id` enforcing the 1:1 job binding, plus a unique index on the digest (`db/schema.ts:93-106`). *Observed* in the local store: `capability_digest` columns contain 64-hex digests, no raw tokens anywhere.
- **No client-supplied value reaches an entitlement decision (D-003/D-006).** `planId` is validated against the server catalog via `isPurchasablePlan`; the price ID comes from env and is never accepted from a client; `client_reference_id` and Checkout metadata are opaque internal references. `src/lib/result-access.ts:buildResultResponse` reads the URL for exactly one thing — the job ID — and its doc comment makes ignoring `session_id`/`success`/`plan` explicit; `app/checkout/success/page.tsx` reads only `job` from the query and never `session_id`. Asserted in `tests/result-access.test.mts`.
- **Webhook handling — correct by construction.** Raw body read exactly once and size-capped (1 MB) *before* parsing; `constructEventAsync` performs HMAC and timestamp verification; `livemode` checked before the inbox; `stripe_events.id` is the primary key and the replay defense, with a bounded retry budget that distinguishes a true duplicate from a transient failure from an exhausted one; the subscription object is always **re-fetched** from Stripe rather than trusting the delivered payload, so out-of-order delivery cannot resurrect a canceled entitlement; the plan is re-derived from the live price rather than from stale metadata, which correctly survives a Billing-Portal downgrade. Signature acceptance/tampering is now covered by a passing test (`tests/webhook.test.mts`, suite entry 126) — an item the previous draft could not verify.
- **Claim transaction — race-free.** The guarded `UPDATE … WHERE consumed_at IS NULL AND expires_at > now` with winner detection by rows-changed is sound, and the doc comment records that the earlier timestamp-comparison approach was unsound and how it was caught. Covered by a concurrent test.
- **Entitlement drift — closed.** `isExpiredCancellation` denies access once a cancel-at-period-end subscription's period has elapsed, independently of whether the final webhook ever arrives — which matters precisely because the retry budget deliberately gives up on permanently failing events. Correctly scoped to `cancelAtPeriodEnd` only, so a slow renewal webhook cannot lock out a paying customer.
- **Price integrity.** `assertPriceMatchesCatalog` blocks amount/currency/interval/archived drift between the advertised price and the Stripe Price, rounds cents correctly (`Math.round(9.99 * 100)`), and fails closed to 503 rather than charging. Cached per price ID, so rotating `STRIPE_PRICE_STARTER` re-verifies.
- **Secret handling — clean.** *Observed*: a pattern scan of the entire built client output (`dist/client/**`) for `sk_test`/`sk_live`/`rk_`/`whsec_`/`price_…`/`AKIA…`/PEM headers returned **zero** matches, as did a scan for `STRIPE_*` / `CLOUDFLARE_*` / `D1_DATABASE_ID` identifiers. `.dev.vars` is gitignored (alongside `.env*`), is untracked, and appears nowhere in git history (`git log --all --diff-filter=A` finds only `.dev.vars.example`). Every Stripe value resolves from the Workers `env` binding at runtime via `db/stripe-client.ts`, the single module that imports `cloudflare:workers` for secrets.
- **Error responses — uniformly generic.** Checkout, portal, result, and webhook all return fixed strings; no Stripe or D1 driver internals reach a client. The **only** `console.*` in any request path across `app/`, `src/`, `db/` and `worker/` is `app/api/checkout/route.ts:86`, which prints a `PriceMismatchError` message containing a plan ID and expected/actual minor units — no secrets, no customer text. `app/api/humanize/route.ts`'s `tryPersist` deliberately swallows D1 errors without logging them, with a comment explaining that driver errors can carry bound statement parameters (i.e. the customer's text).
- **Analytics — content-free.** Server-side allowlists for both event names and property names (`app/api/events/route.ts`), string values capped at 64 characters, non-conforming payloads rejected with 400, and the route stores and forwards nothing (204). Client call sites pass only `mode`, `wordCount`, `issuesImproved`, `planId`.
- **Preview boundary (D-004) — holds.** *Observed*: preview responses contain `preview` plus `hiddenWordCount` and never the remainder. The lock in `app/landing-page.tsx` is a row of empty placeholder `<span>`s sized from `hiddenWordCount` — not blurred real text — so there is nothing to recover from the DOM, the RSC payload, or CSS. The full rewrite is reachable only through `/api/result` behind ownership + entitlement. (SEC-02 defeats the paywall economically, but not by leaking the remainder.)
- **Security headers — verified live** on the running server for both HTML and API responses: CSP, `x-frame-options: DENY`, `x-content-type-options: nosniff`, `referrer-policy: strict-origin-when-cross-origin`, `permissions-policy: camera=(), microphone=(), geolocation=(), payment=(self)`, `cross-origin-opener-policy: same-origin`, and `cache-control: no-store` on every API and authenticated response (`no-store, must-revalidate` on pages).
- **Input bounds.** `/api/humanize` enforces content-type, a declared-length check, a streaming 10 KB body cap with cancel-on-exceed, strict UTF-8 decoding, 12–300 words, 2,400 characters, an allowlisted mode, a validated idempotency-key format, and a 5-second abort-signalled deadline. `/api/webhooks/stripe` and `/api/events` use the same streaming-cap pattern at their own sizes.
- **Schema invariants.** Unique indexes on `users.external_subject`, `anonymous_sessions.job_id`, `anonymous_sessions.capability_digest`, `job_payloads.job_id`, `(client_fingerprint, idempotency_key)`, and `(operation_key, entry_type)`; CHECK constraints on mode, job state, protected-item kind, and verification status; full result text confined to `job_payloads` and never inlined onto a queryable row. Drizzle parameterizes every query; no dynamic SQL is built from content.
- **Cancellation path is real** (ACT-09). `src/components/manage-billing.tsx` calls the portal route from both the landing page and the post-purchase page, and `src/lib/billing-portal.ts` maps every failure status (401/404/503/other) to an honest, actionable message rather than a silent no-op. The redirect target comes from our own server's response, never from user input.

## Corrections to the 2026-08-23 draft

Recorded so the two documents are not read as disagreeing by accident.

- **Withdrawn:** the claim that `cf-connecting-ip` rotation is a direct header-spoof bypass in production. Cloudflare sets that header at its edge and overwrites inbound copies; the rotation observed against the dev server is a dev-runtime artifact. The later D1 guard closes the per-isolate portion of SEC-03; shared-bucket collapse and unguarded paid-adjacent routes remain.
- **Strengthened:** SEC-01 moved from "two forged headers move every route to the authenticated branch" to a proven end-to-end retrieval of another user's paid rewrite, plus confirmation that the billing-portal path resolves the victim's Stripe customer before failing on unconfigured Stripe.
- **Strengthened:** SEC-02 — the previous draft reported 67% of the paid output exposed. The observed worst case is 100%, with `hiddenWordCount: 0`.
- **New:** SEC-04 (double-charge), which the previous review did not identify.
- **Downgraded:** timing-based enumeration moved from "not excluded" to "measured, no separation observed."
- **Closed:** webhook signature verification is now covered by a passing test; the previous draft could not verify it.
- **Renumbered:** identifiers shifted because of the new finding. Old SEC-04 (quota) is now SEC-05, old SEC-05 (retention) is now SEC-06, old SEC-06 (migrations) is now SEC-07, old SEC-07 (CI token) is now SEC-08, old SEC-08 (CSP) is now SEC-09, old SEC-10/11 are now SEC-10/11, old SEC-09 (Stripe mode) is now SEC-15, and old SEC-12 (npm audit) is now SEC-14.

## Could not verify, and why

*Re-stated 2026-08-26. Items settled since August are struck through with what settled them; the
rest still stand, plus three new ones at the end.*

- ~~**Whether the production hosting boundary strips inbound `oai-authenticated-user-*` headers.**~~ **Moot.** The headers are not read anywhere; there is nothing to strip. Identity is a database-backed session cookie gated on the canonical Host.
- **Whether the platform forwards the end-user address as `cf-connecting-ip`.** This decides which branch of SEC-03 applies: a per-user bucket that is merely weak, or a single global bucket of 12 requests/minute for the entire customer base.
- **HSTS on production responses.** `worker/index.ts:55` emits it only when `url.protocol === "https:"`; the dev server is HTTP, so it was never seen. Confirm on the real origin, and confirm the boundary does not proxy over plain HTTP internally, which would suppress it.
- **Live Stripe behaviour.** Signature rejection could not be distinguished end-to-end from configuration failure (an unconfigured client returns 500 before the signature branch is reached); idempotency-key collisions, double-charge under Stripe's own retries, and real webhook ordering all need configured credentials and test clocks. The logic is covered by `tests/webhook-adversarial.test.mts` against real SQLite, which is the right substitute but is not the same thing.
- ~~**SEC-04 against real Stripe.**~~ Now academic in the other direction: the check exists and refuses with 409. What remains untested is the 409 branch *itself*, which needs configured Stripe credentials, and which no unit or E2E test covers — see SEC-04's residual.
- **D1 behaviour under real concurrency.** Unchanged. The ledger's admission is now proven race-free against real SQLite (40 concurrent claimants, one winner), and `tests/preview-request-guard-d1.test.mts` exercises the guard, but the local SQLite harness is not D1 and the cross-colo spike `ARCHITECTURE.md` requires has still not happened.
- **SEC-13's saturation threshold.** Unchanged: 256 simultaneously in-flight requests could not be generated here. It is now only reachable through `/api/preview`.

*New to this pass:*

- **The 50 E2E tests.** Not run — this sandbox has no provisioned Playwright browser. Per `docs/MEMORY.md`, a skipped E2E run reports green, so they are recorded as **not run** rather than as passing. Everything E2E-only — the SEC-17 confirmation flow in a real browser, the locked-remainder DOM, the signed-in journey — is therefore code-verified here at best.
- **Anything on the live host.** Outbound access to `ownword.pro` is blocked from this sandbox. The two production observations this document now carries — that the deploy applies migrations, and that a Cloudflare Insights beacon is CSP-blocked — are the operator's, are attributed as such, and were not reproduced by Security.
- **Whether Anthropic's account-level retention and training terms are what D-P05 requires.** Not checkable from this repository, and not checked. SEC-26 asserts only that the privacy notice and the code disagree, never anything about the processor's actual terms.

### Reproducing SEC-01

The victim fixture used above was removed from the local store after testing, so the dev database is back to its prior state. To reproduce, seed one `users` row with a known `external_subject`, one `subscriptions` row for that user with `status = 'active'` and a future `current_period_end`, and set `humanization_jobs.owner_user_id` on any succeeded job to that user's ID; then issue the two `curl` commands in SEC-01.
