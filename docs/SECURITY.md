# Security, Privacy, and Threat Model

Last updated: 2026-08-24
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
unavailable. Request-path orchestration has a five-second deadline and
propagates an abort signal; provider adapters must honor that signal to stop
upstream work. Before connecting a paid provider, verify the guarded D1 batches
under real cross-colo concurrency and degraded-store conditions and layer an
edge/WAF control over IP-only identity.

---

# Pre-launch security review — 2026-08-24

Reviewer: Security Agent. Scope: payment/entitlement integrity, anonymous capability model, auth boundary, secret handling, data minimization, web security surface, abuse/availability, supply chain.

Supersedes the 2026-08-23 review, which was cut off mid-engagement. Every claim carried forward from it was re-verified against the current tree; several were corrected (see "Corrections to the 2026-08-23 draft"). Snapshot: `6c79614`, working tree clean apart from DES's in-flight `app/page.tsx` / `app/globals.css` edits. `npm test` 126/126 passing, lint and `tsc --noEmit` clean.

Method:

- **observed** — reproduced against the running development server at `http://localhost:3000` with hostile/malformed requests, or read directly out of the local D1 store (`.wrangler/state/v3/d1/…`).
- **code-verified** — confirmed by reading the implementation, but not exercisable live here (usually because Stripe is unconfigured in this environment).
- **unverified** — stated as such, with the reason.

Where an empirical result depends on the local dev runtime rather than real Cloudflare, that is called out explicitly rather than generalized.

## Verdict: NO-GO for charging real customers today

Five blockers, below. One of them (SEC-01) is a proven, end-to-end authentication bypass that hands one person another person's paid writing. One (SEC-04) charges a returning subscriber a second time on the *normal* journey, not an edge case. The rest are controls this document already declares release-critical.

This is not a verdict about carelessness. The entitlement path, the claim transaction, the webhook inbox, the preview projection, the enumeration-oracle discipline, and secret hygiene are built to the standard this document asks for, and most of them were verified sound under adversarial probing (see "What is genuinely sound" — it is long, and it is meant to be). The blockers sit almost entirely at the seam between this application and the platform it is about to be deployed onto, plus the privacy commitments that were deliberately deferred.

### Blockers

1. **SEC-01 (Critical)** — Two forged request headers are a complete authentication bypass. *Proven end-to-end against the running server*: forged headers returned a victim's full unlocked rewrite with HTTP 200. The application has no defence of its own; it relies entirely on an unproven assumption about the hosting boundary, and the repo's own deploy path publishes a second origin.
2. **SEC-02 (High)** — The paywall is extractable for free, at scale, by shaping input. For short inputs the server returns the **entire** rewrite with `hiddenWordCount: 0`.
3. **SEC-04 (High)** — `/api/checkout` never checks whether the caller is already subscribed. The default returning-customer journey walks an existing subscriber straight into a second $9.99/mo subscription.
4. **SEC-06 (High)** — Customer writing is stored in D1 as indefinite plaintext with no purge, no expiry sweeper, and no deletion path. D-P01 and D-P04 are still OPEN, so this would ship as an accident rather than a decision.
5. **SEC-07 (Medium security / launch-fatal operationally)** — The deploy workflow never applies D1 migrations, and the generated `migrations_dir` points at a directory that does not exist. On a real deploy the schema is absent, no capability is ever issued, and nobody can complete a purchase — silently.

SEC-03 (High) is not listed separately as a blocker only because it is inseparable from SEC-02: `README.md` already states that distributed abuse controls are mandatory before the paid model is exposed publicly, and that condition is unmet.

### The minimum GO-WITH-CONDITIONS set, if the owner launches anyway

Each condition must produce evidence, not an intention.

1. **Prove the auth boundary, or fail closed without it.** Produce a request from outside the platform showing (a) the production origin is unreachable except through the hosting boundary, and (b) the boundary strips inbound `oai-authenticated-user-*` headers. If either cannot be shown, implement the boundary-injected shared secret in SEC-01 first. Set `workers_dev: false` and bind the `ownword.pro` route regardless — the second origin should not exist either way.
2. **Add an existing-entitlement check to `/api/checkout`** (SEC-04) — refuse to create a second subscription for a customer who already holds an active one, and tell them so. This is a small change and it protects real money.
3. **Apply migrations on deploy** (SEC-07): add `wrangler d1 migrations apply --remote`, fix `migrations_dir`, and smoke-test that a production preview actually returns a `capability`.
4. **Fix the preview exposure policy** (SEC-02): a bounded fraction with a hidden-word floor that scales with input, and refuse inputs short enough to make the policy meaningless. A response with `hiddenWordCount: 0` must never be produced by the paid path.
5. **Retention** (SEC-06): either implement the 24-hour purge for unclaimed anonymous payloads, or record a dated, explicit Security/Legal acceptance of indefinite plaintext retention with the privacy notice matching it. Decide D-P04 one way or the other in writing.
6. **Abuse controls** (SEC-03): move rate/concurrency enforcement to a durable store and extend it to `/api/result`, `/api/checkout`, and `/api/billing/portal` — or accept a documented, dated risk that the preview is farmable and the billing routes are unthrottled.

Per `docs/AGENTS.md`, closing any QA gate or milestone is a PO decision; nothing in this document grants one.

## Findings, ranked by severity

### SEC-01 — Critical — Forged platform identity headers are a full authentication bypass (proven)

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

### SEC-02 — High — The paywall is extractable for free by shaping input; short inputs return the complete rewrite

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

### SEC-03 — High, partially remediated — Preview admission is shared; paid-adjacent routes remain unguarded

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

### SEC-04 — High — `/api/checkout` never checks for an existing subscription, so a returning customer is charged twice

**Where.** `app/api/checkout/route.ts` validates the plan, claims the capability (`:95`), reads the existing Stripe customer ID, and creates a Checkout Session (`:103`). At no point does it call `getActiveEntitlement`. `app/page.tsx` is a client component with no identity or entitlement awareness at all — `getChatGPTUser` is referenced nowhere outside its own definition in `app/chatgpt-auth.ts` — so the unlock card, its price, and its CTA render identically for a brand-new visitor and for a paying subscriber.

**Why this is the default journey, not an edge case.** There is no history feature. The only way a subscriber can use what they paid for is to paste new text and run another rewrite. That returns a fresh preview with a fresh capability, which renders the unlock card again: *"Unlock full rewrite for $9.99/mo."* Clicking it, while already signed in, creates a second Checkout Session against the same Stripe customer. `{ idempotencyKey: "checkout:${jobId}:${planId}" }` (`:118`) is keyed per job, so it does not deduplicate across jobs — correctly, for its own purpose, but it means nothing here. Stripe does not refuse a second subscription to the same customer for the same price. The customer is now paying $19.98/month.

**Code-verified**; not exercised live because Stripe is unconfigured in this environment. The reasoning depends only on the absence of a check, which is directly observable, and on Stripe's documented default behaviour for subscription-mode Checkout.

**Downstream, the projection tolerates it silently.** `upsertSubscriptionFromStripe` keys on `stripeSubscriptionId`, so two active rows exist for one user; `getActiveEntitlement` returns the most recently updated one and everything appears normal. Nothing alerts. The customer discovers it on their card statement.

`docs/MONETIZATION.md`'s dark-pattern rules and this document's "Quota manipulation/race … double charge" row both cover this. Of every finding here, this is the one most likely to actually cost a real person real money in the first week.

**Remediation.** In `/api/checkout`, load `getActiveEntitlement` for the resolved user before creating a session; if one exists, return a distinct status and have the client render "You're already subscribed" with a link to the existing result and to the billing portal, rather than a purchase CTA. Implement ACT-11's server-computed availability projection so the unlock card knows the caller's state before it renders a price. Consider it defence in depth to also reconcile duplicate active subscriptions per customer in the webhook projector and alert on them.

### SEC-05 — High (on provider connect) / Medium (today) — The advertised 50,000 words/month is enforced nowhere

**Where.** `src/config/pricing.ts:11` declares `wordLimit: 50_000`. `src/lib/subscription-disclosure.ts:15` now renders that allowance into the purchase disclosure next to the unlock button (ACT-10), so it is a headline commitment at the point of sale. `db/schema.ts:278` defines `usage_entries` — and a repository-wide grep finds **no writer and no reader anywhere in the application**; the only other hits are the table's own indexes and check constraints. *Observed*: the local D1 `usage_entries` table has 0 rows after 120 persisted jobs. `getUnlockedResult` gates on entitlement + ownership only; there is no per-period accounting.

D-013 records this as deliberate: M2-07 was not implemented because a racy reservation would be worse than none. That reasoning is sound and this finding does not dispute it.

**Exploit scenario.** One $9.99 subscription confers unlimited generations and unlimited unlocks, indefinitely. Today the marginal cost is near zero — the provider is the local deterministic pipeline — so realised loss is small and the error favours the customer. The moment a real AI provider is wired in, this is unbounded cost per subscriber with no ceiling anywhere in the system.

**Remediation.** Implement M2-07 with the atomic "committed + active reservations + request ≤ allowance" admission step D-013 describes, with the concurrency test it demands, **before** any metered provider is connected. Until then, either soften the "50,000 words / month" claim wherever it appears (card, features list, purchase disclosure) or record an explicit acceptance that it is an unenforced ceiling.

### SEC-06 — High — Customer writing is stored as indefinite plaintext, with no purge and no deletion path

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

### SEC-07 — Medium (security) / launch-fatal (operational) — Production D1 is never migrated

**Where.** `.github/workflows/deploy.yml` runs `npm ci`, `npm run build`, then `npx wrangler deploy`. It never runs `wrangler d1 migrations apply`. The generated `dist/server/wrangler.json` sets `"migrations_dir": "../../migrations"`, which resolves to a repository-root `migrations/` directory that **does not exist** (verified: `ls migrations` → No such file or directory). The schema actually lives in `drizzle/0000_empty_eternals.sql`.

**Impact.** Every D1 call in production throws. `tryPersist` swallows the error by design (`app/api/humanize/route.ts`), so previews still render — but no `capability` comes back, so `shouldOfferUnlock` is false and no unlock CTA is ever rendered. Nobody can buy anything. If it partially works, `claimJobForUser` fails and the customer is told "This preview link is no longer available" after clicking toward Stripe. The failure is silent by construction: no log (deliberately, to avoid leaking bound statement parameters — see SEC-14), no alert, no user-visible error.

**Remediation.** Add `npx wrangler d1 migrations apply site-creator-d1 --remote` to the deploy job, point `migrations_dir` at the real directory, and add a post-deploy smoke test asserting that a preview response contains a `capability`.

### SEC-08 — Medium — The Cloudflare API token is exposed to `npm ci`'s lifecycle scripts

**Where.** `.github/workflows/deploy.yml:18-21` declares `CF_API_TOKEN`, `CF_ACCOUNT_ID`, and `CF_D1_ID` at **job** scope, so they are present in the environment of every step — including `npm ci`, which executes third-party postinstall scripts across the dependency tree.

**Exploit scenario.** A single compromised transitive dependency reads `CF_API_TOKEN` from `process.env` during install and exfiltrates it. That token can deploy Workers and read D1 — i.e. it is equivalent to the whole application plus every customer's stored writing (which, per SEC-06, is plaintext and unexpiring).

**Remediation.** Move the two Cloudflare secrets onto the `Deploy via wrangler` step only, keeping `D1_DATABASE_ID` on the build step where it is genuinely needed. The existing `environment: production` gate is a good control and should stay.

### SEC-09 — Medium — CSP permits `'unsafe-inline'` for scripts, so it is not the XSS control the threat model claims

**Where.** `worker/index.ts:52` — `script-src 'self' 'unsafe-inline'`. *Observed* live on every response from the running server.

The threat table lists CSP as a required prevention for stored/reflected XSS. With `'unsafe-inline'`, CSP would not stop an injected inline script or event handler. The control that actually holds today is React's text escaping.

**That escaping was re-verified and it holds.** *Observed*: a submission containing `<script>alert(1)</script>`, `"><img src=x onerror=alert(2)>` and `javascript:alert(3)` round-tripped through `/api/humanize` as inert JSON (`content-type: application/json`, `x-content-type-options: nosniff`) and is rendered as a React text child in `app/page.tsx` (`{result.original}`, `{result.preview}`) and `app/checkout/success/page.tsx` (`{result.original}`, `{result.result}`). The only `dangerouslySetInnerHTML` in the entire codebase is `app/page.tsx:170`, static JSON-LD built from server config with `<` escaped to `<`. A grep for `innerHTML` and `eval(` across `app/` and `src/` finds nothing else. There is no known injection today.

**Remediation.** Move to nonce- or hash-based `script-src` and drop `'unsafe-inline'`. Not a blocker on its own — but CSP should not be carried on the required-controls list while it is permissive.

### SEC-10 — Low/Medium — Capability tokens are accepted in a URL query string on a Worker with observability enabled

**Where.** `app/api/preview/route.ts:28` reads the capability from `?capability=`. The generated `dist/server/wrangler.json` sets `"observability":{"enabled":true}`, so request URLs are captured in Cloudflare Workers Logs.

A capability is a bearer token: it redeems a preview and, through `/api/checkout`, permanently claims the job to whoever presents it. In a query string it lands in platform logs, browser history, and `Referer` headers. Latent today — `app/page.tsx` keeps the capability in React state and sends it in a POST body, so the query form is currently unused by the UI — but the endpoint accepts it.

**Remediation.** Accept the capability in a header or POST body. If the query form stays for refresh recovery, redact it at the log boundary and shorten its TTL.

### SEC-11 — Low — Checkout consumes the one-time capability before payment

`app/api/checkout/route.ts:95` calls `claimJobForUser` before the Checkout Session is created at `:103`. An abandoned or failed checkout leaves `consumed_at` set, so `/api/preview` no longer redeems that capability while the user holds no entitlement — their own preview becomes unreachable, and with no history feature there is no other way back to it.

Not exploitable across users: the token is a 256-bit secret, and same-user retry is handled correctly by the recovery branch in `claimJobForUser` (which returns the same `jobId` to the user who already owns it, and `null` to everyone else). This is a self-inflicted denial of the customer's own preview and a predictable support burden, not a security hole.

**Remediation.** Defer consumption until the Checkout Session is successfully created, or keep the preview projection readable to the owning user after consumption.

### SEC-12 — Low — Stripe return URLs are derived from the request's own Host

`app/api/checkout/route.ts:100` and `app/api/billing/portal/route.ts:39` both compute `const origin = new URL(request.url).origin` and embed it in `success_url` / `cancel_url` / `return_url`. In a Worker, `request.url` is reconstructed from the inbound Host header.

**Code-verified; not exercised** — Stripe is unconfigured here, so no session could be created to inspect. Practically constrained: Cloudflare routes by hostname, so an arbitrary Host does not reach this Worker, and the only leak would be the attacker's *own* job ID going to their own domain. Worth fixing as hygiene once routes are bound (SEC-01 remediation item 1), by deriving the origin from server configuration (`productConfig.domain`) rather than from the request.

### SEC-13 — Low — One client can exhaust the shared replay cache and 429 everyone in the isolate

`src/lib/preview-request-guard.ts:68` returns 429 "Preview capacity is temporarily full" to *any* caller once `this.requests.size >= maxEntries` (256, `:32`). `cleanup()` at `:137` evicts settled entries first, so this only fires when 256 requests are simultaneously **in flight** — which the per-client `maxConcurrent: 2` limit prevents for a single client identity, but not for a client able to present many identities or open many connections.

**Code-verified**, not exercised: building 256 genuinely concurrent in-flight requests against the deterministic local pipeline was not achievable here. Low, and it disappears once SEC-03's durable limiter replaces this map.

### SEC-14 — Informational — `npm audit`'s 4 moderate findings are not exploitable here

*Observed*: `npm audit --omit=dev` reports **0 vulnerabilities**. The full `npm audit` reports 4 moderate, all tracing to one root: `esbuild <= 0.24.2`, GHSA-67mh-4wv8-2f99 — *"esbuild enables any website to send any requests to the development server and read the response."* It reaches the tree only through `drizzle-kit`, a devDependency, via `@esbuild-kit/core-utils` → `@esbuild-kit/esm-loader`. The advisory concerns `esbuild serve`, which this project never runs, and esbuild is not among the production dependencies.

**Assessment: genuinely not a launch risk.** Do not treat it as a blocker and do not inflate it. Track for upgrade when `drizzle-kit` drops `@esbuild-kit`. The real supply-chain exposure in this repository is SEC-08, not any specific package.

### SEC-15 — Informational — Test/live Stripe identifier mixing: resolved, with a residual

The 2026-08-23 draft raised that `SECRET_KEY_PATTERN` validated only key shape and the `whsec_` prefix, so a live key paired with a test webhook secret would fail every real subscription webhook signature — charging customers who are then never unlocked. That is now closed, and re-verified in this review: `src/lib/stripe-config.ts` derives `mode`/`livemode` from the secret key; `src/lib/stripe-webhook-projection.ts:ingestVerifiedStripeEvent` rejects any event whose own `livemode` disagrees **before** the inbox insert, returning 400 rather than 500 so a misconfiguration does not become a retry storm; `app/api/webhooks/stripe/route.ts:96` passes `config.livemode`. `tests/stripe-config.test.mts` and `tests/webhook-adversarial.test.mts` cover the branches, and the full suite passes 126/126.

**Residual, unchanged:** a wrong-*account* (not wrong-mode) webhook secret is still undetectable by static inspection, and the first webhook signature failure produces no alert anywhere. Add a webhook-failure alert per this document's observability requirements — it is the only detector for that class of misconfiguration.

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
- **Preview boundary (D-004) — holds.** *Observed*: preview responses contain `preview` plus `hiddenWordCount` and never the remainder. The lock in `app/page.tsx` is a row of empty placeholder `<span>`s sized from `hiddenWordCount` — not blurred real text — so there is nothing to recover from the DOM, the RSC payload, or CSS. The full rewrite is reachable only through `/api/result` behind ownership + entitlement. (SEC-02 defeats the paywall economically, but not by leaking the remainder.)
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

- **Whether the production hosting boundary strips inbound `oai-authenticated-user-*` headers, and whether the production origin is reachable without it.** No production deployment exists; `.openai/hosting.json` records only a `project_id`. This is the single most important open question in this review — it decides whether SEC-01 is live or latent. It must be answered with an actual request from outside the platform before launch, and the answer must be written down.
- **Whether the platform forwards the end-user address as `cf-connecting-ip`.** This decides which branch of SEC-03 applies: a per-user bucket that is merely weak, or a single global bucket of 12 requests/minute for the entire customer base.
- **HSTS on production responses.** `worker/index.ts:55` emits it only when `url.protocol === "https:"`; the dev server is HTTP, so it was never seen. Confirm on the real origin, and confirm the boundary does not proxy over plain HTTP internally, which would suppress it.
- **Live Stripe behaviour.** Signature rejection could not be distinguished end-to-end from configuration failure (an unconfigured client returns 500 before the signature branch is reached); idempotency-key collisions, double-charge under Stripe's own retries, and real webhook ordering all need configured credentials and test clocks. The logic is covered by `tests/webhook-adversarial.test.mts` against real SQLite, which is the right substitute but is not the same thing.
- **SEC-04 against real Stripe.** The absence of an entitlement check is directly observable in code; that Stripe will actually create the second subscription is inferred from its documented default behaviour, not demonstrated here.
- **D1 behaviour under real concurrency.** The claim transaction is covered by a concurrent test, but the ledger concurrency spike `ARCHITECTURE.md` requires before M2-07 has not happened, and the local SQLite harness is not D1.
- **SEC-13's saturation threshold.** 256 simultaneously in-flight requests could not be generated against the deterministic local pipeline.

### Reproducing SEC-01

The victim fixture used above was removed from the local store after testing, so the dev database is back to its prior state. To reproduce, seed one `users` row with a known `external_subject`, one `subscriptions` row for that user with `status = 'active'` and a future `current_period_end`, and set `humanization_jobs.owner_user_id` on any succeeded job to that user's ID; then issue the two `curl` commands in SEC-01.
