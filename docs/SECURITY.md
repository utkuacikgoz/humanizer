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

The Phase 0 preview currently validates idempotency keys, coalesces/replays duplicates for 60 seconds, caps each observed client at 12 requests per minute and two concurrent requests, bounds the replay cache, and rejects request-path orchestration after five seconds while propagating an abort signal. Provider adapters must honor that signal to stop upstream work. These controls live inside one Worker runtime and are not a distributed security boundary. Before connecting a paid provider, move rate/concurrency enforcement to an edge or durable store, define trusted client identity at the hosting boundary, and test cross-isolate and degraded-store behavior.

---

# Pre-launch security review — 2026-08-23

Reviewer: Security Agent. Scope: payment/entitlement integrity, anonymous capability model, secret handling, data minimization, web security surface, abuse/availability, supply chain.

Method: read of the actual implementation plus empirical probing of the running development server (`http://localhost:3000`) with hostile and malformed requests. Findings marked *observed* were reproduced against that server; findings marked *code-verified* were confirmed by reading the implementation but could not be exercised live (usually because Stripe is unconfigured in this environment); findings marked *unverified* say so and explain why.

Snapshot: working tree at `dc34772` plus uncommitted in-flight edits by other agents. `db/stripe-client.ts`, `db/billing-repository.ts`, `app/api/result/route.ts`, and `app/api/webhooks/stripe/route.ts` changed **during** this review; line numbers below were correct at the moment each finding was taken and should be re-resolved by function name if they have drifted.

## Verdict: NO-GO for taking real customer money today

Four launch blockers, listed in the conditions below. None of them is a disagreement about polish; each is either a control the threat model above already declares release-critical, or a defect that prevents the paid flow from functioning at all in production.

This is not a judgement that the codebase is careless — the opposite. The entitlement path, the webhook inbox, the claim transaction, the preview projection, and secret hygiene are all built to the standard this document asks for, and several of them are genuinely well done (see "What is genuinely sound"). The blockers are concentrated in the boundary between this application and the platform it will be deployed onto, and in the privacy commitments that were deliberately deferred.

### Blockers

1. **SEC-01** — Platform identity headers are trusted with no verification, and the repository's own deploy path publishes a second origin that is not behind the boundary that is supposed to inject them.
2. **SEC-02 + SEC-03** — The paywall is extractable for free at scale, and the only abuse control is keyed on a client-supplied header. `README.md` already states distributed abuse controls are mandatory before the paid model is exposed publicly; that condition is unmet.
3. **SEC-05** — Customer writing is stored in D1 as plaintext, indefinitely, with no purge, no expiry sweeper, and no deletion path of any kind. D-P01 and D-P04 are still OPEN, which means indefinite plaintext retention would be launched as an accident rather than as a decision.
4. **SEC-06** — The deploy workflow never applies D1 migrations and the generated `migrations_dir` points at a directory that does not exist. On a real deploy, the database has no schema, so no capability is ever issued and nobody can complete a purchase.

### If the owner intends to launch anyway, the minimum GO-WITH-CONDITIONS set

- Prove, with a request from outside the platform, that the production origin cannot be reached without the hosting boundary, **and** that the boundary strips inbound `oai-authenticated-user-*` headers. If either cannot be proven, implement the shared-secret check in SEC-01 first. This is a verification task, not necessarily a code change, but it must produce evidence.
- Add `wrangler d1 migrations apply --remote` to the deploy job and fix `migrations_dir`; smoke-test that a preview returns a `capability` in production.
- Move rate limiting to a durable store, or accept a documented, dated risk that the free preview is farmable and the service is DoS-able by one client.
- Either implement the 24-hour purge for unclaimed anonymous payloads, or record an explicit dated Security/Legal acceptance of indefinite plaintext retention with the privacy notice matching it. The current privacy page is honest about deletion being unavailable, which is why this is a condition rather than a misrepresentation.

Per `docs/AGENTS.md`, closing any QA gate or milestone remains a PO decision; nothing here grants one.

## Findings, ranked by severity

### SEC-01 — Critical — Platform identity headers are accepted from any caller; the deploy path creates a boundary-free origin

- `src/lib/chatgpt-identity.ts:27` (`resolveChatGPTUserFromHeaders`) — identity is `headers.get("oai-authenticated-user-id")` and `...-email`. There is no signature, no shared secret, no origin check, no allowlist, and no middleware anywhere in the app (`middleware.ts` does not exist; `/signin-with-chatgpt` returns 404 because it is entirely the platform's route).
- `.github/workflows/deploy.yml:44` runs `npx wrangler deploy --config dist/server/wrangler.json`. The generated `dist/server/wrangler.json` sets neither `workers_dev: false` nor `routes`, so a deploy publishes the Worker on its default `*.workers.dev` hostname — an origin that by construction is **not** behind the ChatGPT hosting boundary.

**Observed.** Against the running server:

```
curl -H 'oai-authenticated-user-id: attacker-sub' -H 'oai-authenticated-user-email: a@b.com' \
     '/api/result?job=00000000-0000-4000-8000-000000000000'
  -> 404 {"error":"Result not found.","pending":true}     # authenticated code path
curl '/api/result?job=...'
  -> 401 {"error":"Sign in to view this result."}          # unauthenticated code path
curl -X POST -H 'oai-authenticated-user-id: victim-subject-123' ... '/api/billing/portal'
  -> 404 {"error":"No billing account found."}             # authenticated code path
curl -X POST '/api/billing/portal'
  -> 401 {"error":"Sign in to manage billing."}
```

Two forged headers move every route from the unauthenticated branch to the authenticated branch.

**Exploit scenario.** An attacker who learns or guesses a victim's ChatGPT subject identifier sends requests to the `workers.dev` origin with those two headers and becomes that user. They can read the victim's unlocked rewrites (`GET /api/result`), open a Stripe Billing Portal session bound to the victim's customer (`POST /api/billing/portal` → invoices, payment-method details, cancel the subscription), and permanently claim a preview capability into an account of their choosing (`POST /api/checkout`). The subject identifier is an account identifier, not a credential — it is not designed to resist guessing, and it is the only thing standing between an attacker and full impersonation.

The threat table above already rates "Auth header spoof" **Critical** and names the required control: *"Hosting boundary strips/injects trusted headers; production origin not directly reachable; deployment test."* None of the three is implemented or evidenced.

**Unverified portion.** I could not test the real production origin — there is none yet, and `.openai/hosting.json` records only a `project_id`. If the platform is the sole origin and it strips inbound `oai-*` headers, the live risk drops sharply. But the repository's own deploy workflow creates the second origin, so this is not hypothetical, and the app has zero defence in depth if the assumption ever breaks (a route change, a custom domain, a platform migration).

**Remediation.**
1. Set `workers_dev: false` and bind only the `ownword.pro` route in the generated Wrangler config; **and**
2. Require a boundary-injected shared secret header, compared in constant time, rejecting any request that lacks it — so that a direct hit on any origin fails closed regardless of routing; **and**
3. Add a deployment test that sends forged `oai-authenticated-user-*` headers at the production hostname and asserts 401.

### SEC-02 — High — The paywall is extractable for free by chunking input into minimum-size previews

- `app/api/humanize/route.ts:109` — `partialPreview` exposes `Math.min(90, Math.max(8, Math.floor(words.length * 0.46)))` words.
- `app/api/humanize/route.ts:149` — the minimum accepted input is 12 words. The endpoint requires no authentication.

**Observed.** A 12-word submission returned `preview` of 8 words with `hiddenWordCount: 4` — 67% of the paid output, free, per request. The floor of 8 means the shorter the chunk, the higher the free fraction.

**Exploit scenario.** Split a document into overlapping ~12-word windows and submit each anonymously, then reassemble. Every window yields at least 8 rewritten words and the windows can be shifted to cover the seams. The customer never pays and never signs in. Combined with SEC-03 there is no effective throttle on the loop. D-004's "the full product remains paid" is defeated not by leaking the hidden remainder (that boundary holds — see below) but by making the visible fraction arbitrarily large through input shaping.

**Remediation.** Make the exposure policy a fixed transparent fraction with a hidden-word floor that scales with input rather than a constant visible floor (never expose more than ~40%, never hide fewer than N words), and refuse inputs short enough to make the policy meaningless. `ARCHITECTURE.md` already assigns "Partial preview selection" to PO + DES before M1-10 — this finding is the security reason that decision cannot be deferred past launch.

### SEC-03 — High — Rate limiting is keyed on a client-supplied header, is per-isolate, and defaults to a shared constant

- `src/lib/preview-request-guard.ts:57` keys the replay cache `${clientId}:${idempotencyKey}`; line 77 keys the rate-limit window on `clientId` alone.
- `app/api/humanize/route.ts:167` and `app/api/preview/route.ts:33` both derive it as `request.headers.get("cf-connecting-ip")?.trim() || "anonymous-runtime"`.

**Observed.** After the default bucket returned 429 (requests 9–15 of a burst), six consecutive requests carrying rotating `cf-connecting-ip: 10.0.0.1` … `10.0.0.6` all returned 200. Rotating one header fully resets the limit.

**Exploit scenario, two branches, and both are bad.**
- If the Worker is reachable outside Cloudflare's edge (which SEC-01 shows it will be), `cf-connecting-ip` is attacker-controlled: unlimited previews, which is the engine for SEC-02 and, once a metered AI provider is connected, unlimited cost.
- If the Worker sits behind the ChatGPT proxy, Cloudflare sets `cf-connecting-ip` to the *proxy's* address, so every customer in the world collapses into one bucket of 12 requests/minute. One user's normal activity denies service to everyone else.
- Either way the `Map` is per-isolate and Workers isolates are many and ephemeral, so the real ceiling is `12 × (number of live isolates)` and the replay cache — the idempotency guarantee — evaporates on isolate recycle. `app/api/humanize/route.ts:19-39` already documents that consequence honestly.
- `/api/checkout`, `/api/result`, `/api/billing/portal`, and `/api/events` have **no** guard at all. With SEC-01, an unauthenticated attacker can drive unbounded Stripe API calls through `/api/billing/portal` with rotating forged identities.

**Remediation.** Move rate and concurrency enforcement to a Durable Object, KV, or Cloudflare's Rate Limiting binding. Derive client identity at the hosting boundary and treat a missing signal as fail-closed, never as the shared constant `"anonymous-runtime"`. Extend coverage to the billing and result routes.

### SEC-04 — High (on provider connect) / Medium (today) — The advertised 50,000 words/month is enforced nowhere

- `src/config/pricing.ts:11` declares `wordLimit: 50_000` and `app/page.tsx` renders "50,000 words / month" as a plan feature.
- `db/schema.ts`'s `usageEntries` table has **no writer and no reader anywhere in the codebase**. D-013 records this as deliberate: M2-07 was not implemented because a racy reservation would be worse than none.
- `db/billing-repository.ts`'s `getUnlockedResult` gates on entitlement + ownership only; there is no per-period accounting.

**Exploit scenario.** One $9.99 subscription confers unlimited generations and unlimited unlocks, indefinitely. Today the marginal cost is near zero because the provider is the local deterministic one, so the realised loss is small and the direction of the error favours the customer (no dark pattern). The moment a real AI provider is wired in, this becomes unbounded cost per subscriber with no ceiling anywhere in the system.

**Remediation.** Implement M2-07 with the atomic "committed + active reservations + request ≤ allowance" admission step D-013 describes, with the concurrency test it demands, **before** any metered provider is connected. Until then, either remove the "50,000 words / month" claim from the pricing card or record an explicit acceptance that it is an unenforced ceiling.

### SEC-05 — High — Customer writing is stored as indefinite plaintext with no purge and no deletion path

- `db/repository.ts:141` writes `sourceRef: input.original` and `resultRef: input.result` — the customer's source text and the complete rewrite — directly as SQLite `text` columns (`db/schema.ts`, `jobPayloads`). `encryptionKeyId` exists in the schema and is never populated.
- There is **no** sweeper, no scheduled handler, and no cron trigger: `dist/server/wrangler.json` contains `"triggers":{}`. There is no deletion route. `purgedAt` is honoured on read (`getUnlockedResult`) but nothing ever sets it.
- The 24-hour `expiresAt` on `anonymous_sessions` only stops *capability redemption*. The job row, the protected-item rows, and the plaintext payload survive forever.
- Persistence happens for **anonymous, unauthenticated** submissions (`app/api/humanize/route.ts` `tryPersist`). The store therefore accumulates the writing of people who never created an account and have no mechanism — technical or contractual — to have it erased.

**Impact.** Launching today means indefinite plaintext retention of restricted-class customer content, chosen by default rather than by decision, with no ability to satisfy an erasure request. This contradicts the "Retention and deletion principles" section above and D-011, and it means **D-P01 (retention duration) and D-P04 (payload encryption) are not merely open decisions — their absence is being shipped.** A future decision to retain for 24 hours cannot retroactively delete what was kept from launch day onward.

The privacy page (`app/privacy/page.tsx`) is honest about this: it marks retention as unresolved and states self-service deletion is "planned but not yet available". That honesty is why this is High rather than a "misleading deletion" Critical. It does not make the underlying exposure acceptable. (Separately, that page states pasted text "is sent to a third-party AI provider"; today the pipeline is local and deterministic and no provider receives anything. The error is in the safe direction, but COPY/LEGAL should reconcile it.)

**Remediation before charging.** Implement the 24-hour purge for unclaimed anonymous payloads — a scheduled Worker trigger, or purge-on-read as a stopgap. Decide D-P04 explicitly: either encrypt payloads with a key held outside D1, or record a dated Security acceptance that D1's at-rest encryption is the accepted control. State paid retention in the privacy notice with a number.

### SEC-06 — Medium (security) / launch-blocking (operational) — Production D1 is never migrated

- `.github/workflows/deploy.yml` runs `npm ci`, `npm run build`, then `npx wrangler deploy`. It never runs `wrangler d1 migrations apply`.
- `dist/server/wrangler.json` sets `"migrations_dir": "../../migrations"`, which resolves to a repository-root `migrations/` directory that **does not exist**. The schema lives in `drizzle/0000_empty_eternals.sql`.

**Impact.** Every D1 call in production throws. `tryPersist` swallows the error by design, so previews still render — but no `capability` is returned, so `app/page.tsx:264` renders the disabled Unlock button and nobody can buy. If it partially works, `claimJobForUser` fails and the customer gets "This preview link is no longer available" after being sent toward Stripe. The failure is silent: no log, no alert, no user-visible error.

**Remediation.** Add `npx wrangler d1 migrations apply site-creator-d1 --remote` to the deploy job, point `migrations_dir` at the real directory, and add a post-deploy smoke test asserting that a preview response contains a `capability`.

### SEC-07 — Medium — The Cloudflare API token is exposed to `npm ci`'s lifecycle scripts

- `.github/workflows/deploy.yml:18-21` declares `CF_API_TOKEN`, `CF_ACCOUNT_ID`, and `CF_D1_ID` at **job** scope, so they are in the environment of every step — including `npm ci`, which executes third-party postinstall scripts across a 643-package tree (`esbuild`, `workerd`, and any future addition).

**Exploit scenario.** A single compromised transitive dependency reads `CLOUDFLARE_API_TOKEN` from `process.env` during install and exfiltrates it. That token can deploy Workers and read D1 — i.e. it is equivalent to the whole application and every customer's stored writing.

**Remediation.** Move the two Cloudflare secrets onto the `Deploy via wrangler` step only, keeping `D1_DATABASE_ID` on the build step. The existing `environment: production` gate is good and should stay.

### SEC-08 — Medium — CSP permits `'unsafe-inline'` for scripts, so it is not the XSS control the threat model claims

- `worker/index.ts:52` — `script-src 'self' 'unsafe-inline'`.

The threat table lists CSP as a required prevention for stored/reflected XSS. With `'unsafe-inline'`, CSP would not stop an injected inline script or event handler; the actual control is React's text escaping.

**That escaping was verified and holds.** *Observed:* a submission containing `<script>alert(1)</script>` and `</script><img src=x onerror=alert(2)>` round-tripped through `/api/humanize` as inert JSON text (`content-type: application/json`, `x-content-type-options: nosniff`) and is rendered as a React text child in `app/page.tsx` and `app/checkout/success/page.tsx`. The only `dangerouslySetInnerHTML` in the codebase is `app/page.tsx:154`, static JSON-LD from server config with `<` escaped to `<`. There is no known injection today.

**Remediation.** Move to nonce- or hash-based `script-src` and drop `'unsafe-inline'`. Not a blocker on its own — but do not carry CSP on the control list while it is permissive.

### SEC-09 — Medium — RESOLVED IN THE WORKING TREE DURING THIS REVIEW

Test/live Stripe identifiers had no cross-field consistency check: `SECRET_KEY_PATTERN` validated only the shape of the secret key and the `whsec_` prefix, so a live key paired with a test webhook secret would fail every real subscription webhook signature — charging customers who are then never unlocked, with only generic errors surfacing. While this review was in progress another agent added `src/lib/stripe-config.ts` (deriving `mode`/`livemode` from the secret key) and `src/lib/stripe-webhook-projection.ts:187`, which rejects any event whose own `livemode` disagrees, **before** the inbox insert; `app/api/webhooks/stripe/route.ts:96` passes `config.livemode`. Recorded here so it is not re-reported. Not independently re-verified end-to-end — the code landed mid-review.

Residual: a wrong-account (not wrong-mode) webhook secret is still undetectable statically, and the first webhook signature failure produces no alert. Add a webhook-failure alert per the observability requirements above.

### SEC-10 — Low/Medium — Capability tokens are accepted in a URL query string on a Worker with observability enabled

- `app/api/preview/route.ts:28` reads the capability from `?capability=`.
- `dist/server/wrangler.json` sets `"observability":{"enabled":true}`, so request URLs are captured in Cloudflare Workers Logs.

A capability is a bearer token that redeems a preview and, through `/api/checkout`, permanently claims the job. In a query string it lands in platform logs, browser history, and `Referer` headers. Latent today: `app/page.tsx` keeps the capability in React state and sends it in a POST body, so the query-string path is currently unused by the UI.

**Remediation.** Accept the capability in a header or POST body. If the query form stays for refresh recovery, redact it at the log boundary and shorten its TTL.

### SEC-11 — Low — Checkout consumes the one-time capability before payment

`app/api/checkout/route.ts:95` calls `claimJobForUser` before the Stripe Checkout Session is created at line 103. An abandoned or failed checkout leaves `consumed_at` set, so `/api/preview` will no longer redeem that capability, while the user holds no entitlement — their own preview becomes unreachable. Not exploitable across users (the token is a 256-bit secret), and same-user retry is handled correctly by the recovery branch in `claimJobForUser`. It is a self-inflicted denial of the customer's own preview and a predictable support burden.

**Remediation.** Either defer consumption until the Checkout Session is successfully created, or keep the preview projection readable to the owning user after consumption.

### SEC-12 — Informational — `npm audit`'s 4 moderate findings are not exploitable here

All four (`esbuild`, `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`, `drizzle-kit`) trace to a single root: `esbuild <= 0.24.2`, GHSA-67mh-4wv8-2f99 — *"esbuild enables any website to send any requests to the development server and read the response."* It reaches the tree only through `drizzle-kit`, a devDependency, via `@esbuild-kit/*`. The advisory concerns `esbuild serve`, which this project never runs; the application ships 9 production dependencies and esbuild is not among them.

**Assessment: genuinely not a launch risk.** Do not treat it as a blocker and do not inflate it. Track for upgrade when `drizzle-kit` drops `@esbuild-kit`.

Build-time exfiltration was checked separately: enumerating install lifecycle scripts across `node_modules` found only `esbuild` and `workerd` `postinstall` hooks (both platform-binary downloads, both expected). Every other hit is a `prepare` script, which npm runs only for git/source installs, not registry tarballs. The real supply-chain exposure here is SEC-07, not any specific package.

## What is genuinely sound

Verified, and deliberately recorded so a later reviewer does not re-litigate it:

- **Secret handling — clean.** A pattern scan of the built client output (`dist/client/**`, all chunks and assets) for `sk_`/`rk_`/`whsec_`/`price_`/`sk-`/`AKIA`/PEM headers and for `STRIPE_*`/`CLOUDFLARE_*` identifiers returned **zero** matches. `.dev.vars` is gitignored (`.gitignore`, alongside `.env*`), is untracked, and has never appeared in git history; the only matches for secret-shaped patterns across all commits are the validation regex itself in `db/stripe-client.ts`. Every Stripe value resolves from the Workers `env` binding at runtime. Error responses are uniformly generic across checkout, portal, result, and webhook — no Stripe or D1 driver internals reach a client. The single `console.*` call in any request path (`app/api/checkout/route.ts:86`) prints a `PriceMismatchError` message containing a plan id and expected/actual amounts: no secrets, no customer text. `app/api/humanize/route.ts:71-78` deliberately swallows D1 errors rather than logging them, precisely because driver errors can carry bound statement parameters. This objective is met.
- **Capability model — holds as specified.** 32 bytes from `crypto.getRandomValues`, base64url-encoded (*observed*: 43-character tokens), only the SHA-256 digest persisted, and a unique index on `anonymous_sessions.job_id` enforcing the 1:1 job binding (`db/repository.ts:90-109,163-169`; `db/schema.ts:93-106`).
- **Enumeration oracle — holds on every path tested.** *Observed*: `/api/preview` returns a byte-identical 404 body for a valid-shaped unknown token, a malformed token, and a missing parameter. `/api/result` returns identical `{"error":"Result not found.","pending":true}` for an unknown job, a job owned by someone else, and an owner without entitlement. In code, `db/repository.ts:191` and `claimJobForUser` collapse unknown/expired/consumed into a single `null`, and the same-user recovery branch reveals ownership only to the caller who already owns it.
- **No client-supplied value reaches an entitlement decision (D-003/D-006).** `planId` is validated against the server catalog (`isPurchasablePlan`); the price ID comes from env and is never accepted from the client; `client_reference_id` and Checkout metadata are opaque internal references; the success page's `session_id` is never read as authority — `src/lib/result-access.ts:39-53` makes ignoring it explicit and asserts it in tests.
- **Webhook handling — correct by construction** (*code-verified*; not exercised live because Stripe is unconfigured here, so a bogus signature returned 500 from the unconfigured-client branch rather than the 400 the signature branch produces). Raw body read exactly once and size-capped *before* parsing; `constructEventAsync` performs HMAC and timestamp verification; `stripe_events.id` is the primary key and the replay defense, with a bounded retry budget that distinguishes a true duplicate from a transient failure; the subscription object is always re-fetched from Stripe rather than trusting the delivered payload; the plan is re-derived from the live price rather than from stale metadata, which correctly survives a Billing-Portal downgrade.
- **Claim transaction — race-free.** The guarded `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now` with winner detection by rows-changed is sound, and the doc comment records that the earlier timestamp-comparison approach was unsound and how it was caught.
- **Entitlement drift — closed.** `isExpiredCancellation` denies access once a cancel-at-period-end subscription's period has elapsed, independent of whether the final webhook ever arrives — which matters because the retry budget deliberately gives up on permanently failing events.
- **Price integrity.** `assertPriceMatchesCatalog` blocks amount/currency/interval/archived drift between the advertised price and the Stripe Price, and fails closed to 503 rather than charging.
- **Analytics — content-free.** Server-side event and property allowlists (`app/api/events/route.ts`), and every client call site passes only `mode`, `wordCount`, `issuesImproved`, `planId`. No document text, no PII, and the route stores nothing.
- **Preview boundary (D-004) — holds.** *Observed*: responses contain only the truncated `preview` plus `hiddenWordCount`. The full rewrite appears in no JSON response, no HTML, and no RSC payload; it is reachable only through `/api/result` behind ownership + entitlement. (SEC-02 defeats the paywall economically, but not by leaking the remainder.)
- **Security headers — verified live** on the running server for both page and API responses: CSP, `x-frame-options: DENY`, `x-content-type-options: nosniff`, `referrer-policy: strict-origin-when-cross-origin`, `permissions-policy`, `cross-origin-opener-policy: same-origin`, and `cache-control: no-store` on every authenticated/API response.

## Could not verify, and why

- **Whether the production hosting boundary strips inbound `oai-authenticated-user-*` headers.** No production deployment exists and `.openai/hosting.json` documents only a `project_id`. This is the single most important open question in this review — it decides whether SEC-01 is a live Critical or a latent one. It must be answered with an actual request from outside the platform before launch.
- **HSTS on production responses.** `worker/index.ts:54` sets it only when `url.protocol === "https:"`; the dev server is HTTP, so it was never emitted. Confirm on the real origin, and confirm the boundary does not proxy over plain HTTP internally, which would suppress it.
- **Webhook signature rejection end-to-end.** Stripe is unconfigured in this environment, so signature-failure responses could not be distinguished from configuration-failure responses. `tests/webhook.test.mts` and the new `tests/webhook-adversarial.test.mts` exist; per instruction the suite was not run, and other agents were mid-edit.
- **Timing-based enumeration.** Response *content* is uniform, but the code paths behind unknown / expired / unowned differ in database work performed. Timing was not measured. Not excluded.
- **D1 behaviour under real concurrency.** The claim transaction was reasoned about and is covered by a concurrent test, but the ledger concurrency spike `ARCHITECTURE.md` requires before M2-07 has not happened, and the local SQLite harness is not D1.
- **Live Stripe behaviour** — idempotency-key collisions, double-charge under retry, and real webhook ordering — all require configured Stripe credentials and test clocks.
