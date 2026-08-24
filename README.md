# Ownword

`PROJECT_CODENAME=humanizer`

Ownword is a paid-first writing product at [ownword.pro](https://ownword.pro) that turns generic AI-assisted drafts into natural writing while preserving the author's meaning. The customer-facing name and domain live in one configuration source (`src/config/product.ts`); `humanizer` remains the internal codename and repository name.

The confirmed operator is Bosphorus Elevate LLC and the monitored support address is `support@ownword.pro`. Ownword uses a text wordmark until the founder supplies approved logo and favicon artwork.

## Current foundation

- Anonymous 12–300 word preview flow with Natural, Professional, Academic, and Casual modes
- Targeted, model-independent humanization pipeline
- Structured protection for names, companies, products, dates, quantities, citations, URLs, code, references, and supplied terminology
- Semantic verification, configurable quality gates, safe retries, and attempted-versus-successful usage metrics
- Prototype partial-result presentation with honest qualitative trust signals
- 100-fixture deterministic benchmark scaffold across the ten required categories
- Central brand and plan configuration
- Cloudflare Worker deployment metadata
- D1 backed preview abuse guard with encrypted idempotent replay, shared concurrency and rate ceilings, and a five-second request-path deadline
- Product, architecture, monetization, security, QA, SEO, and backlink operating documents

Stripe checkout, anonymous-result persistence, verified webhook projection, server-authoritative unlock, and the billing portal are implemented (M2-01 through M2-06 and M2-08 through M2-10).

Still open and release-blocking: the deterministic provider and benchmark fixtures are contract-testing and product-demo baselines, not production quality evidence. Production deployment must apply the D1 guard migrations, configure `PREVIEW_GUARD_SECRET`, and add an edge/WAF layer for network rotation and shared NAT behavior. The usage ledger (M2-07) is deliberately unimplemented pending a concurrency-safety spike — see D-013 in the decision log. Quotas, history, and account deletion remain backlog milestones.

The complete rewrite is generated on the server, but the anonymous response exposes only the allowed preview and a hidden-word count; the browser never receives the locked remainder.

## Local development

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the local URL printed by the development server.

## Validation

```bash
npm run build
npm test
npm run lint
npm run benchmark
```

The current test suite covers protected-content extraction, targeted rewriting, verification failure, deadline cancellation, retry accounting, idempotent preview replay, preview response shaping, hostile input, privacy-safe analytics, benchmark shape, protected benchmark facts, the product example, server rendering, centralized copy, and starter-template removal regressions. The broader suites and release gates in [Quality assurance](docs/QA.md) are planned and are not yet implemented.

## Configuration

- Product identity: `src/config/product.ts`
- Plan catalog: `src/config/pricing.ts`
- Stripe plan-to-price mapping: `src/config/stripe.ts`
- Evaluation thresholds: `src/lib/humanization/pipeline.ts`
- Hosting metadata: `.openai/hosting.json`
- Anonymous preview abuse protection: D1 migrations plus `PREVIEW_GUARD_SECRET`

Production deploys must set `PREVIEW_GUARD_SECRET` to at least 32 random bytes
with `wrangler secret put PREVIEW_GUARD_SECRET`, set `D1_DATABASE_ID`, and apply
all `drizzle/*.sql` migrations before serving traffic. The in-memory request
guard is used only by plain-Node tests and builds explicitly marked `local`,
`development`, or `test`; production fails closed when D1 or the secret is
unavailable.
- Local Stripe/D1 secrets: copy `.dev.vars.example` to `.dev.vars` (gitignored) — see that file for where each value comes from. Production secrets are set through the deployment platform's own secret store, not this repo.

Do not scatter the temporary name, pricing values, or plan rules through application logic.

## CI/CD

- `.github/workflows/ci.yml`: lint, typecheck, test, benchmark on every push/PR.
- `.github/workflows/deploy.yml`: manual-only (`workflow_dispatch`). Needs `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID` repo secrets — vinext generates `wrangler.json` at build time from `vite.config.ts`. Do not enable auto-deploy-on-merge until it's confirmed whether `.openai/hosting.json`'s hosting platform already auto-deploys, to avoid double-deploying.

## Documentation

- [Product and milestones](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Agent ownership](docs/AGENTS.md)
- [Decision log](docs/DECISIONS.md)
- [Monetization](docs/MONETIZATION.md)
- [Security and privacy](docs/SECURITY.md)
- [Quality assurance](docs/QA.md)
- [Benchmarks](docs/BENCHMARKS.md)
- [SEO and GEO](docs/SEO.md)
- [Backlink program](docs/BACKLINKS.md)

## Product guardrails

- Never claim guaranteed detector bypass.
- Never expose a rewrite that fails semantic verification.
- Never charge quota for failed attempts or internal retries.
- Never train on customer writing without explicit future consent.
- Never log full customer documents unnecessarily.
- Never trade factual accuracy for a detector score.
