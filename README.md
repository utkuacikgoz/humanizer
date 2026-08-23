# Humanizer

`PROJECT_CODENAME=humanizer`

Humanizer is a paid-first writing product that turns generic AI-assisted drafts into natural writing while preserving the author's meaning. The customer-facing name is temporary and comes from one configuration source.

## Current foundation

- Anonymous 12–300 word preview flow with Natural, Professional, Academic, and Casual modes
- Targeted, model-independent humanization pipeline
- Structured protection for names, companies, products, dates, quantities, citations, URLs, code, references, and supplied terminology
- Semantic verification, configurable quality gates, safe retries, and attempted-versus-successful usage metrics
- Prototype partial-result presentation with honest qualitative trust signals
- 100-fixture deterministic benchmark scaffold across the ten required categories
- Central brand and plan configuration
- Cloudflare Worker deployment metadata
- Bounded per-runtime preview abuse guard with idempotent replay, concurrency/rate ceilings, and a five-second request-path deadline
- Product, architecture, monetization, security, QA, SEO, and backlink operating documents

The deterministic provider and benchmark fixtures are contract-testing and product-demo baselines, not production quality evidence. The complete rewrite is generated on the server, but the anonymous response exposes only the allowed preview and a hidden-word count; the browser never receives the locked remainder. The in-memory request guard is defense-in-depth for this prototype; distributed edge/store-backed abuse controls remain mandatory before a paid model is exposed publicly. Durable server-side result persistence is still required before checkout can unlock that remainder. Stripe checkout, anonymous-result storage, webhook projection, quotas, history, and account deletion remain release-blocking milestones documented in the backlog.

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
- Local Stripe/D1 secrets: copy `.dev.vars.example` to `.dev.vars` (gitignored) — see that file for where each value comes from. Production secrets are set through the deployment platform's own secret store, not this repo.

Do not scatter the temporary name, pricing values, or plan rules through application logic.

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
