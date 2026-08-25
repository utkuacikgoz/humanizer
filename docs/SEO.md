# Ownword SEO/GEO Strategy (V1)

**Owner:** SEO/GEO Agent
**Status:** V1 acquisition architecture
**Updated:** 2026-08-25
**Canonical brand:** Ownword at `ownword.pro` (`humanizer` remains the internal codename and a generic query category)

## 0. Current build reality (verified 2026-08-25, second pass)

Most of this document describes the target architecture, not what exists in `app/` today. The routes that
actually exist are `/` (homepage/workspace), `/privacy`, `/terms`, `/history` (private, `noindex`),
`/checkout/success` (private, `noindex`), plus `/robots.txt` and `/sitemap.xml`. None of the cluster pages in
Section 4's information architecture (`/pricing`, `/how-it-works`, `/examples/*`, `/ai-writing-patterns`,
`/make-ai-writing-sound-natural`, `/meaning-preserving-rewrite`, mode pages, `/compare`, `/research`,
`/guides`, `/trust/*`) exist yet. Do not read Section 4 as a description of the live site — it is the target,
gated behind the query-to-page decision rule in Section 3 and the publication-velocity caps in Section 7.

### Withdrawn: the parked-domain blocker

**The earlier claim that `ownword.pro` serves a Hostinger parked-domain page is no longer true and has been
removed from this document.** The application is deployed on Cloudflare Workers with `ownword.pro` and
`www.ownword.pro` bound as custom domains and D1 migrations applied. The repository evidences the binding:
`vite.config.ts`'s `productionRoutes()` emits `{ pattern: "ownword.pro", custom_domain: true }` and the same
for `www.ownword.pro`, with `workers_dev: false`, and the generated `dist/server/wrangler.json` carries both
routes. SEO-003, SEO-004 and SEO-009 were previously marked *Blocked (Hosting)* against that blocker; it no
longer exists, and they have been re-statused against what can and cannot be verified from this repository.

What an agent cannot do from this repository is fetch the live site — this session's network egress to
`ownword.pro` is blocked by the proxy, so **every live-HTTP assertion below is an owner action, not a Done.**
Repository behavior is verified by rendering the built Worker in `tests/`; live behavior is verified by a
human with a browser and a Search Console login.

### The sign-in blocker, resolved 2026-08-25

Every sign-in link used to target `/signin-with-chatgpt`, a route this repository does not contain (it was
provided by the OpenAI hosting platform), so on `ownword.pro` checkout, unlock, history, and billing were all
unreachable. Email magic-link sign-in shipped at `/signin` and the dead links are gone; `/signin` is
`noindex` and robots-disallowed by design.

What remains is not an SEO blocker but bounds every conversion claim on this page: **no purchase has ever
completed end to end on the production host.** Sign-in has not run against a real mailer there, and the
checkout readiness probe is still failing. Treat organic conversion metrics as unmeasurable until one real
purchase completes.

This does not block indexing: the pages a crawler sees are public, server-rendered, and correct. It does
block the conversion half of the funnel. Until auth lands, **do not write measurement copy, targets, or page
promises that assume a purchase can complete today**, and do not treat any preview-to-paid metric in
Section 9 as measurable.

### Verified working today (against the current repository)

- `app/robots.txt/route.ts` and `app/sitemap.xml/route.ts` gate all output on the request `Host` header
  matching `productConfig.domain` (`ownword.pro`) exactly (case-insensitive). Off that host — including
  localhost, staging, preview, and `www.ownword.pro` — robots.txt returns a blanket `Disallow: /` and the
  sitemap is an empty `<urlset>`. This is enforced by `tests/rendered-html.test.mjs` and is by design
  (SEO-002), not a defect. On the `ownword.pro` Host, robots.txt allows crawling (with `/api/`, `/account/`,
  `/admin/`, `/billing/`, `/checkout/`, `/history/`, `/result/`, `/signin` disallowed) and
  references the sitemap. The sitemap lists exactly `/`, `/privacy`, and `/terms`.
- `src/lib/public-pages.ts` is the single registry of publicly indexable pages and the single builder for
  the metadata contract (SEO-005). `app/layout.tsx`, `app/privacy/page.tsx`, `app/terms/page.tsx` and
  `app/sitemap.xml/route.ts` all read from it, so the sitemap cannot list a URL whose page does not exist.
  `app/robots.txt/route.ts` still carries its own copy of the host rule — see the handoff list in Section 11.
- `src/lib/site-structured-data.ts` emits `Organization` + `WebSite` JSON-LD on the canonical host only
  (SEO-006). The homepage additionally emits `SoftwareApplication` from `app/page.tsx`, whose `Offer` block
  is conditional on `productConfig.billingEnabled` (currently `true`). Commercial launch still requires the
  legal, security, and pricing release gates.
- `/privacy` and `/terms` return 200 with unique Ownword metadata, the configured operator and support
  address, substantive policy text, and host-gated canonical/index directives. They contain no `PENDING`
  placeholders, but final counsel review remains part of M4-03.
- `/checkout/success` and `/history` are private: both emit `noindex, nofollow, nocache`, both now drop the
  inherited homepage canonical, and rendered tests prove neither appears in the sitemap.
- `tests/metadata-contract.test.mjs` is the CI gate for SEO-005: it crawls the canonical-host sitemap and
  fails the build if any listed URL is not 200, or is missing a title, meta description, self-canonical,
  `og:title/description/type/url/site_name/image`, `twitter:card/title/description`, or exactly one H1.


## 1. Outcome and guardrails

SEO is a primary acquisition channel, but it must compound trust rather than trade it away. The first goal is not maximum traffic. It is qualified, non-branded discovery that produces paid users and credible third-party citations.

### V1 outcomes

- Make the public product experience indexable, fast, understandable, and easy to cite.
- Own a small set of high-intent topic clusters around natural writing and meaning preservation.
- Publish original evidence and tools that earn links instead of manufacturing pages.
- Measure the entire organic journey: search impression -> landing -> paste -> preview -> checkout -> paid -> second use.
- Establish a repeatable editorial system before increasing publishing velocity.

### Non-negotiable guardrails

- Never promise guaranteed AI-detector or Turnitin bypass.
- Never optimize detector scores at the expense of meaning, facts, citations, or writing quality.
- Do not describe the product as a generic paraphraser or conceal its use.
- Do not create near-duplicate pages for keyword, profession, school, location, or model-name variants.
- Do not publish automated drafts without expert review, original value, factual verification, and a named accountable owner.
- Do not use fabricated statistics, testimonials, ratings, expert identities, or fake precision.
- Do not expose private customer text to crawlers, analytics, logs, public examples, or training workflows.
- Academic pages must frame the product as a revision and clarity aid, not a way to evade academic-integrity controls.

Google's current generative-search guidance says conventional SEO remains the foundation for AI visibility, prioritizes original non-commodity content, and explicitly rejects special GEO hacks such as unnecessary `llms.txt` files or manufactured mentions. This plan follows that model: accessible pages, original evidence, clear entities, and useful answers. See [Google's generative AI search guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide), [AI-generated content guidance](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content), and [spam policies](https://developers.google.com/search/docs/essentials/spam-policies).

## 2. Positioning for search

### Search proposition

> Rewrite AI-assisted text so it reads naturally while protecting the author's meaning, facts, terminology, citations, and intended tone.

### Proof hierarchy

Every commercial page should prove the promise in this order:

1. A real before/after example appropriate to the page's intent.
2. A concise explanation of what changed and what remained protected.
3. Product evidence: semantic verification, protected terminology, meaningful differences, and honest assessments.
4. Clear limitations: no guaranteed detector result; users remain responsible for their work and applicable policies.
5. A direct path to paste text without signup, followed by the paid unlock model.

### Differentiation entities to reinforce consistently

- Natural writing
- Meaning preservation
- Protected facts and terminology
- Targeted rewriting rather than indiscriminate paraphrasing
- Natural, Professional, Academic, and Casual modes
- Trustworthy assessment without invented percentages
- Personal voice as a future capability, not a V1 claim

The canonical brand is Ownword and the canonical domain is `ownword.pro`. Bosphorus Elevate LLC and `support@ownword.pro` are the configured operator and support contact. All resolve from centralized product configuration. Social profiles and official logo artwork remain unconfirmed and must not be invented for structured data. Use a text wordmark until approved visual assets are supplied.

## 3. Search-intent map

Priority is based on likely commercial proximity and product fit, not unvalidated search volume. Before creating the second page in any cluster, validate query language in Search Console, paid-search query reports, customer interviews, and a keyword dataset. Consolidate overlapping intents into the strongest page.

| Priority | Intent cluster | Representative queries | Searcher job | Best page / asset | Conversion action | Guardrail |
|---|---|---|---|---|---|---|
| P0 | Core AI humanization | AI humanizer; AI text humanizer; humanize AI text | Improve AI-assisted copy now | Homepage/product workspace | Paste text | Do not promise detector bypass |
| P0 | Natural-sounding rewrite | make AI writing sound human; make ChatGPT sound human; make AI writing sound natural | Remove robotic patterns without losing meaning | `/make-ai-writing-sound-natural` | Try Natural mode | One consolidated page, not model variants |
| P0 | Pattern diagnosis | remove AI writing patterns; why does AI writing sound robotic; repetitive AI writing | Identify and fix specific writing problems | `/ai-writing-patterns` plus diagnostic | Run diagnostic / paste text | Diagnostic must explain evidence, not issue fake probability |
| P1 | Professional writing | professional humanizer; make AI email sound natural; humanize business writing | Sound credible and natural at work | `/professional-writing-humanizer` | Try Professional mode | Avoid profession-by-profession doorway pages |
| P1 | Academic revision | academic humanizer; make academic writing sound natural; revise AI-assisted essay | Improve clarity and flow while preserving citations | `/academic-writing-humanizer` | Try Academic mode | Integrity notice; no evasion claims |
| P1 | Meaning preservation | rewrite without changing meaning; preserve citations while rewriting; paraphrase without changing facts | Reduce semantic risk | `/meaning-preserving-rewrite` | Paste a fact-heavy sample | Demonstrate benchmark evidence and limitations |
| P1 | Product comparison | best AI humanizer; [competitor] alternatives; AI humanizer comparison | Choose a paid solution | `/compare/ai-humanizers` initially | Compare, then try | Evidence-backed, dated, fair, no cloned pages |
| P2 | Technique/how-to | vary sentence structure; remove corporate filler; fix repetitive sentence openings | Learn a specific editing technique | Curated `/guides/*` articles | Use diagnostic or product | Each guide needs original examples and expert review |
| P2 | Evaluation/research | AI writing pattern research; semantic preservation benchmark; humanizer evaluation | Find citable evidence or methodology | `/research/humanization-benchmark` | Download/cite methodology; then try | Publish methods, sample composition, and limitations |
| P2 | Casual/creator | casual writing humanizer; make captions sound natural | Adjust informal voice | `/casual-writing-humanizer` only after demand validation | Try Casual mode | Do not split into every platform/use case |
| Exclude | Evasion/cheating | bypass Turnitin; undetectable AI; guaranteed detector bypass | Defeat a control | No dedicated landing page | None | Do not target, buy ads, or build links for this intent |

### Query-to-page decision rule

Create a new indexable URL only if all are true:

1. The searcher has a meaningfully different job or evaluation criterion.
2. The page can provide a distinct demonstration, dataset, workflow, or expert answer.
3. At least 60% of the page would differ from the nearest existing page without swapping keywords.
4. The page has a clear internal-link role and a conversion action.
5. The page owner can update it when product facts or evidence change.

Otherwise, expand the existing page and use an anchored section. This is the main defense against doorway pages and cannibalization.

## 4. Initial information architecture

### Launch-critical public pages

```text
/
├── product workspace and core AI-humanizer intent
├── pricing
├── how-it-works
├── examples
│   ├── professional
│   ├── academic
│   └── casual
├── ai-writing-patterns
├── make-ai-writing-sound-natural
├── meaning-preserving-rewrite
├── professional-writing-humanizer
├── academic-writing-humanizer
├── compare
│   └── ai-humanizers
├── research
│   └── humanization-benchmark
├── guides
│   └── [only approved, original guides]
├── trust
│   ├── semantic-verification
│   ├── privacy
│   └── responsible-use
└── legal
    ├── terms
    └── privacy
```

The workspace and content can share the homepage only if the product input remains the dominant action and sufficient descriptive copy is server-rendered below it. If experimentation shows the editorial content distracts from the first paste, keep the workspace at `/` and place the fuller explanation at `/how-it-works`; do not move the core product behind a sign-in wall.

### Indexation classes

| Class | Examples | Directive |
|---|---|---|
| Public commercial/editorial | Homepage, pricing, examples, research, approved guides | Index, self-canonical |
| Private product state | Result, history, account, billing, checkout return | `noindex`; authentication where appropriate |
| Generated/session URLs | Preview IDs, query-state URLs, regeneration URLs | `noindex`, canonical to stable parent when public access is required; otherwise block access |
| Internal/admin | Benchmark admin, QA, API, staging, debug | Authentication and `noindex`; do not rely on robots.txt for security |
| Thin/unfinished content | Draft guides, empty category pages, search pages | Keep unpublished or `noindex` until acceptance criteria pass |

### Internal-link system

- Every indexable page links to the product action with natural descriptive copy.
- Every mode page links to its relevant example and trust proof.
- Guides link upward to one primary commercial page and sideways to no more than three genuinely useful related resources.
- Research and benchmark pages link to methodology, downloadable artifacts, product limitations, and the core product.
- Breadcrumbs must reflect the actual hierarchy and use `BreadcrumbList` structured data only where visible breadcrumbs exist.
- Do not force exact-match anchors. Prefer specific, readable anchors such as “see how meaning preservation is checked.”
- Orphan-page threshold: zero indexable pages.

## 5. Page briefs

### Homepage (`/`)

- **Primary intent:** AI humanizer / humanize AI text.
- **Title direction:** `Ownword | Natural AI Rewrites That Preserve Meaning`.
- **H1 direction:** `Make AI-assisted writing sound naturally yours.`
- **Required modules:** working input, four modes, partial preview explanation, real before/after, protected-content proof, semantic-verification explanation, pricing summary, privacy statement, responsible-use boundary, concise FAQ.
- **Success event:** `humanization_started`; commercial success: `checkout_completed`; quality success: `second_humanization`.

### Natural-writing page

- Explain detectable writing patterns without treating them as proof of AI authorship.
- Show a before/after with annotated sentence openings, rhythm, transitions, filler, and preserved claims.
- Link to the pattern diagnostic and Natural mode.

### Academic page

- Focus on clarity, flow, terminology, quotations, citations, and meaning preservation.
- Include a visible academic-integrity notice and encourage compliance with institutional policies.
- Do not use “undetectable,” “bypass,” “beat,” or guaranteed-detection language in title, headings, metadata, examples, or outreach.

### Comparison page

- Start with one maintained category comparison, not a page per competitor.
- State the evaluation date, criteria, test corpus, limitations, and commercial relationships.
- Include real strengths and weaknesses, and invite corrections.
- Add competitor-specific pages only when there is demonstrated query demand and enough firsthand testing for a distinct, fair page.

### Research page

- Publish benchmark version, sample-category definitions, inclusion/exclusion criteria, protected-fact annotations, evaluation procedure, aggregate results, error bars or uncertainty where applicable, model/version dates, known limitations, changelog, and machine-readable tables.
- Never publish customer writing. Use licensed, commissioned, public-domain, synthetic, or permissioned test passages with provenance.
- Make charts downloadable in SVG/PNG and data available as CSV/JSON when licensing permits.

## 6. Technical SEO requirements

### Rendering and discovery

- All public acquisition pages must return meaningful server-rendered HTML without requiring client interaction.
- Each indexable URL returns HTTP 200; missing pages return a genuine 404; permanent moves use 301/308.
- Publish an absolute-URL XML sitemap containing only canonical, indexable, 200-status URLs. Emit `lastmod` only
  when a material per-page modification date is tracked; omission is preferable to a fabricated current date.
- Publish a robots.txt that references the sitemap and does not block CSS/JS required to render public pages.
- Verify production in Google Search Console and Bing Webmaster Tools; submit the sitemap to both.
- Keep canonical host/protocol/trailing-slash behavior consistent and redirect every alternative in one hop.
- Do not ship `llms.txt` as a Google ranking tactic. Consider it only if a specific, documented consumer requires it and maintenance has an owner.

### Metadata and social previews

- Every indexable page has a unique, accurate `<title>`, meta description, canonical, H1, Open Graph title/description/image, and Twitter card.
- Titles describe the page before the brand and avoid boilerplate keyword repetition.
- Descriptions make honest claims and can be rewritten by search engines; treat them as conversion copy, not ranking fields.
- Social images contain readable text, a stable brand mark from configuration, and no false score claims.
- Pagination, filters, query parameters, and experiments cannot silently create indexable duplicates.

### Structured data

- Homepage: `Organization` and `WebSite`; use final legal/public entity facts only.
- Product/pricing surface: `SoftwareApplication` with truthful `applicationCategory`, operating system, and current `Offer` data. Never mark up ratings that are absent from the visible page or aggregate first-party ratings in a misleading way. Validate against [Google's SoftwareApplication requirements](https://developers.google.com/search/docs/appearance/structured-data/software-app).
- Editorial content: `Article` only when the visible page has a real headline, author, publish/modified dates, and editorial ownership.
- Breadcrumb pages: `BreadcrumbList` matching visible navigation.
- FAQ content may use semantic headings for readers, but do not prioritize `FAQPage` markup for a rich result unless the page and current eligibility guidelines warrant it.
- CI or release checks must parse JSON-LD and reject invalid URLs, stale prices, missing required properties, or content/markup mismatches.

### Page experience and accessibility

- V1 performance budgets at the 75th percentile on mobile: LCP <= 2.5 s, INP <= 200 ms, CLS <= 0.1.
- Keep the product input interactive while secondary examples, charts, and comparison content load progressively.
- Reserve layout dimensions for locked previews, result panels, images, and pricing cards.
- Use semantic landmarks, one clear H1, keyboard-accessible controls, visible focus, labeled inputs, adequate contrast, and descriptive alt text.
- Avoid intrusive interstitials. The paywall belongs after the partial result, not over the landing content.

### Privacy and crawl safety

- Result and history pages must never be included in sitemaps or structured data.
- Use opaque, unguessable result identifiers; never place customer text in URLs, titles, analytics payloads, referrers, or social tags.
- Public examples require explicit rights/provenance and must be scrubbed of personal or confidential material.
- Preview URLs shared across checkout must remain private, expire according to retention policy, and be inaccessible across accounts.

### Release gate

No acquisition page is considered done until:

- It is useful and readable with JavaScript disabled where feasible for static content.
- Canonical, robots, status, title, H1, structured data, sitemap membership, internal links, and analytics have been verified.
- Mobile performance meets the budget or has an approved exception with owner and due date.
- Claims, examples, citations, privacy, and responsible-use copy have been reviewed.
- The page has one primary search intent and one primary conversion action.

## 7. Editorial and GEO operating system

### Why GEO is handled as evidence-led SEO

Generative systems select and synthesize source passages. The durable response is not special markup or robotic “answer chunks”; it is publishing crawlable, clearly attributed, original facts and explanations that can stand alone when cited. Google explicitly advises against special GEO markup, inauthentic mentions, or variant-page proliferation.

### Content standards

Every new guide or research page needs:

- A documented audience question and target page in the intent map.
- A named author/editor with relevant experience and a short accountability statement.
- At least one original contribution: benchmark result, annotated example, expert experiment, dataset, tool, template, or first-party observation.
- Primary-source citations for factual or technical claims.
- Clear distinction among measured fact, expert judgment, and hypothesis.
- Concrete examples that preserve meaning and protected content.
- Publication and material-update dates plus a changelog for research assets.
- A content brief, plagiarism/duplication check, factual review, legal/claim review, and final human edit.

### Citation-friendly presentation

- Lead sections with a direct answer, then explain method, evidence, and limitations.
- Give tables explicit headings, units, sample sizes, definitions, and dates.
- Put methodology next to results rather than hiding it in a generic footer.
- Provide stable section IDs for important definitions and findings.
- Use consistent entity names and define product-specific terms such as “meaning preservation” and “protected content.”
- Include an author/contact route for corrections and respond publicly with changelog entries when warranted.

### Publication velocity

- Days 0-30: no more than four commercial/supporting pages plus one flagship asset after the launch-critical pages.
- Days 31-60: at most two substantial pieces per week, contingent on quality-gate pass and indexing health.
- Days 61-90: increase only if pages earn impressions, qualified engagement, citations/links, or assisted conversions. Consolidate or retire failures.

AI can assist with outlining, transcription, or transformations, but the page owner remains responsible for original value, accuracy, relevance, and disclosure where useful. Do not use the product itself to mass-rewrite competitors' content.

## 8. Linkable-asset roadmap

These assets are designed jointly with the Backlink Agent. Detailed promotion is in `BACKLINKS.md`.

| Order | Asset | Original value | Search/citation role | MVP definition |
|---|---|---|---|---|
| 1 | AI Writing Pattern Diagnostic | Highlights repetitive openings, rhythm, filler, transitions, and protected entities without claiming authorship probability | Embeddable educational tool; earns guide/resource links | Browser-safe sample or pasted-text analysis; no storage by default; shareable summary contains no source text |
| 2 | Humanization Quality Benchmark | Reproducible comparison of naturalness, meaning failures, protected-content failures, latency, and cost | Flagship research and category-definition source | 100-passages methodology, aggregate data, limitations, changelog, downloadable tables |
| 3 | Meaning-Preservation Checklist | Practical checklist for facts, entities, numbers, dates, citations, terminology, relationships, and conclusions | Teacher/editor/writer resource | Web page plus accessible one-page PDF; permissive citation terms |
| 4 | AI Writing Patterns Field Guide | Annotated, non-accusatory examples of common robotic patterns and targeted fixes | Evergreen learning resource | 12+ annotated patterns, counterexamples, downloadable visual |
| 5 | State of AI-Assisted Writing | Original annual/quarterly analysis from benchmark and opt-in, aggregate product data | Digital PR and recurring citation event | Only after sample, privacy, methodology, and statistical review are credible |

Do not launch a superficial tool merely to attract links. Every interactive asset must function as described and have accessible static documentation; misleading functionality violates search quality policies.

## 9. Measurement framework

### Source of truth

- Google Search Console: impressions, clicks, queries, pages, countries/devices, indexing, enhancements, Core Web Vitals, manual actions, and generative-AI performance where available.
- Bing Webmaster Tools: discovery, indexing, crawl issues, and search performance.
- Product analytics: anonymous landing session through paid and retained use.
- Server logs or privacy-safe edge analytics: verified crawler access, status codes, and rendering failures without capturing document content.
- Backlink tracker: referring URL/domain, target, anchor, link attributes, discovery/live/lost dates, relevance score, and relationship source.

### Funnel dimensions

Add `landing_page`, `content_cluster`, `organic_engine`, `device`, and privacy-safe `first_touch/last_touch` attribution to the existing funnel events. Never put pasted text, rewritten text, result IDs, email addresses, or sensitive document metadata in analytics.

### KPI hierarchy

| Level | KPI | V1 interpretation |
|---|---|---|
| Business | Organic paid customers; organic MRR; second-use rate; gross-margin-adjusted CAC | Primary outcome; report by first and assisted touch |
| Funnel | Organic paste rate; completion rate; preview-to-checkout; checkout-to-paid | Find friction between discovery and value |
| Demand | Non-branded qualified clicks; impressions by intent cluster; brand search trend | Directional, never a success metric alone |
| Visibility | Indexed canonical pages; top-10/top-20 query cohorts; cited/linked research | Diagnose discoverability and authority |
| Quality | Engaged product starts; pogo/quick-return proxy where consented; content-assisted conversions | Determine whether pages satisfy the query |
| Technical | Valid pages; crawl errors; CWV pass rate; structured-data validity | Release and maintenance health |
| Risk | Manual actions; spammy referring-domain share; false-claim incidents; private URL exposure | Must remain zero or trigger incident response |

### Initial targets (replace after 30-day baseline)

- 100% of intended launch pages canonical, indexable, in sitemap, and inspected.
- 0 private result/history/account URLs indexed.
- 0 structured-data critical errors and 0 price/content mismatches.
- >= 90% of public landing-page URL groups pass all three Core Web Vitals at p75 by day 60.
- >= 25% organic visitor-to-paste rate on commercial pages after enough traffic for a stable sample.
- Track preview-to-paid and second-use rates by page; set targets only after 100 qualified organic product starts.
- At least 60% of published editorial pages earn one of: 50 qualified organic clicks, one editorial referring domain, one verifiable third-party citation, or one paid/assisted conversion within 90 days. Review, merge, improve, or retire the rest.

Never present rank as the only SEO KPI. A lower-volume page that produces retained paid users is more valuable than an informational page with unqualified traffic.

## 10. 30/60/90-day plan

### Days 0-30: establish indexability, intent, and proof

- Finalize canonical-domain behavior and configuration-driven brand metadata.
- Ship technical foundations: robots.txt, sitemap, metadata, canonical rules, social cards, schema, 404s, and private-URL `noindex` coverage.
- Verify Search Console/Bing, analytics dimensions, conversion events, and privacy-safe crawl logging.
- Publish/upgrade homepage, pricing, how-it-works, examples, semantic-verification, privacy, and responsible-use pages.
- Produce the `/make-ai-writing-sound-natural` and `/ai-writing-patterns` briefs; publish only when examples and diagnostic are real.
- Freeze the benchmark methodology and create the public-safe research schema.
- Establish baseline query, indexing, performance, conversion, and link profile reports.

### Days 31-60: create original demand assets

- Launch the AI Writing Pattern Diagnostic and Meaning-Preservation Checklist.
- Publish the benchmark methodology and first defensible aggregate results.
- Publish Academic and Professional pages with mode-specific examples and policy review.
- Start editorial outreach against the asset roadmap; record every relationship and link outcome.
- Inspect Search Console weekly for cannibalization, soft 404s, duplicate canonicals, structured-data issues, and emerging queries.
- Run title/description experiments only on pages with enough impressions; judge success by qualified starts and paid conversions, not CTR alone.

### Days 61-90: consolidate winners and expand evidence

- Publish one maintained category comparison using firsthand testing.
- Expand only clusters with demonstrated impressions, qualified starts, citations, links, or conversions.
- Refresh underperforming pages by improving evidence and intent match; merge duplicates before creating new URLs.
- Release a benchmark update or expert commentary tied to a real finding, not an arbitrary press announcement.
- Evaluate whether localized or additional use-case pages have distinct demand and sufficient localized expertise; keep them out of V1 if not.
- Set next-quarter targets from actual conversion and retention cohorts.

## 11. Atomic backlog with acceptance criteria

IDs are stable for orchestration. `P0` blocks an SEO-ready public launch; `P1` creates the first acquisition loop; `P2` follows evidence.

Status values (updated 2026-08-25 verification pass): **Done** — acceptance criteria verified against the current
codebase; **Partial** — some but not all acceptance criteria hold; **Open** — not started or not verifiable
from this repo; **Blocked** — implementation is not the gap, a human/Legal decision is; **owner action** — no
agent can close it, because it needs a login, a DNS record, or a human decision. An honest *Partial* is worth
more than a *Done* nobody can support; do not upgrade a row without evidence named in the row itself.

| ID | Pri | Task | Owner | Depends on | Status | Acceptance criteria |
|---|---|---|---|---|---|---|
| SEO-001 | P0 | Define canonical domain and brand metadata contract | Engineering + Product | Naming config | Partial | One config source supplies confirmed product name, domain, support email, and legal entity, and staging cannot emit production canonicals. Official logo artwork and social handles remain unconfirmed and are intentionally omitted. |
| SEO-002 | P0 | Implement indexation matrix | Engineering + Security | SEO-001 | Partial | Rendered tests prove the canonical-host public allow path, the off-host `noindex`/empty-sitemap default, and `noindex` + no-canonical on both private surfaces (`/checkout/success`, `/history`); no private URL appears in the sitemap. `tests/metadata-contract.test.mjs` re-checks this every build. Remaining gap: the framework 404 page still inherits the homepage canonical (see handoff H-4), and account/admin surfaces do not exist yet. |
| SEO-003 | P0 | Implement canonical and redirect policy | Engineering | SEO-001 | Partial | Repository behavior is verified: `/`, `/privacy`, `/terms` self-canonicalize on the canonical host only, private surfaces carry no canonical, and off-host output fails closed. Not verified and not implementable from SEO's owned files: `www.ownword.pro` is bound as a second custom domain (`vite.config.ts`) and currently serves the app under `Disallow: /` + `noindex` with no redirect, so www earns nothing and consolidates nothing. One-hop `www` -> apex and HTTP -> HTTPS redirects are owner action O-6 / handoff H-3. |
| SEO-004 | P0 | Generate XML sitemap and robots.txt | Engineering | SEO-002 | Done (repository) / owner-verified live | Canonical-host output lists exactly `/`, `/privacy`, `/terms`, each an existing 200 route drawn from `src/lib/public-pages.ts`; robots.txt references the sitemap; off-host output fails closed. `lastmod` is emitted only for `/privacy` and `/terms`, from the same constant those pages display, and a test fails if a sitemap date is not visible on its page; `/` tracks no material modification date and correctly omits `lastmod`. `/history` is private and is proven absent. Live fetch of the two files is owner action O-1. |
| SEO-005 | P0 | Build reusable metadata API | Engineering + Copy | SEO-001 | Partial | `src/lib/public-pages.ts` is the shared registry + builder; `app/layout.tsx`, `/privacy` and `/terms` are migrated to it. `tests/metadata-contract.test.mjs` is the CI check: every sitemap URL must return 200 with a unique title and description, a self-canonical, the OG and Twitter set, and exactly one H1. Two adoptions remain: `app/page.tsx` (ENG-locked during auth work, handoff H-1) and `app/robots.txt/route.ts` (ENG-locked, handoff H-2). The gate passes on the homepage today because it checks rendered output, not source. |
| SEO-006 | P0 | Add truthful structured data | Engineering + SEO | SEO-001, pricing config | Partial | `Organization` + `WebSite` JSON-LD ship from `src/lib/site-structured-data.ts` on the canonical host only. Every property is verifiable from `src/config/product.ts`: brand name, `legalName` Bosphorus Elevate LLC, origin, support `ContactPoint`, `inLanguage`. `logo`, `sameAs`, `aggregateRating`, `foundingDate`, `address` and `SearchAction` are deliberately absent and a test fails if any appears. `SoftwareApplication` on `/` still carries its `Offer` from the catalog. Remaining: live Rich Results validation (owner action O-4). |
| SEO-007 | P0 | Protect customer text from discovery/analytics | Security + Engineering | SEO-002 | Partial | Test confirms text never appears in URL, metadata, analytics, sitemap, public cache, or unauthorized response; private result access control passes. Holds for what is built (anonymous preview, `track()` calls); there is no history/account surface yet (M3) for this to apply to |
| SEO-008 | P0 | Establish performance budgets | Engineering + Design | Core UI | Open | Not verified in this pass; outside SEO's owned files |
| SEO-009 | P0 | Verify search-engine consoles | SEO + Hosting (owner action) | Live deployment | Partial (owner-reported 2026-08-25) | The owner reports Google Search Console is connected for `ownword.pro`. **Not independently verified** — no agent in this project can reach GSC or the live host, so this status is the owner's report, not evidence. Still open: submit `https://ownword.pro/sitemap.xml` and confirm 3 discovered URLs; run a live URL Inspection on `/` for Indexing allowed = Yes with canonical `https://ownword.pro`; repeat for `/privacy` and `/terms`; add Bing via *Import from Google Search Console*. Steps 4 onward in Section 11.1. |
| SEO-010 | P0 | Connect organic funnel attribution | Analytics + Engineering | Existing events | Open | Funnel events exist (`track()` calls per `PRODUCT.md`); no GSC-joined dashboard exists |
| SEO-011 | P0 | Write responsible claims standard | Legal + Copy + SEO | Product brief | Open | Guardrails are stated in this document, `PRODUCT.md`, and `README.md`, but there is no single Legal-approved allowed/forbidden claims list |
| SEO-012 | P0 | Publish trust proof modules | Humanization + Copy | Benchmark evidence | Open | No `/trust/*` pages exist; homepage carries inline trust copy only |
| SEO-013 | P1 | Create page-template quality gate | SEO + Engineering | SEO-005 | Open | Template requires intent, unique evidence, author/reviewer, dates, internal links, CTA, claims check, canonical, analytics, and accessibility sign-off |
| SEO-014 | P1 | Launch AI Writing Pattern Diagnostic | Humanization + Engineering | Privacy review | Open | Tool analyzes stated patterns, does not infer authorship probability, stores no text by default, has an accessible explanation and useful empty/error states |
| SEO-015 | P1 | Publish field guide | SEO + Copy | SEO-014 | Open | Contains >=12 original annotated examples, counterexamples, source/method notes, stable anchors, and links to the live diagnostic |
| SEO-016 | P1 | Publish benchmark methodology/results | Humanization + SEO | Benchmark V1 | Open | Page documents corpus, metrics, versions/dates, aggregate results, failures, limitations, provenance, changelog, and downloadable data where licensed |
| SEO-017 | P1 | Publish Academic mode page | SEO + Legal + Copy | SEO-011, real examples | Open (evidence-blocked) | Distinct academic workflow/example, citation protection proof, visible integrity notice, and zero evasion claims. Blocked on evidence, not on writing: see the note under SEO-018. |
| SEO-018 | P1 | Publish Professional mode page | SEO + Copy | Real examples | Open (evidence-blocked) | Distinct business workflow/example, factual/terminology proof, and product start CTA; not duplicated from core page. **Deliberately not built in the 2026-08-25 pass.** The deployed engine is a deterministic demo baseline: `src/lib/humanization/deterministic-provider.ts` distinguishes Professional from the other modes by exactly three regular-expression substitutions layered on a shared table. A page claiming a distinct professional workflow, or mode-specific quality, would state something the product cannot do today, which Section 1 forbids outright. Build it when the mode genuinely differs and a real annotated before/after exists. |
| SEO-019 | P1 | Publish meaning-preservation checklist | Humanization + SEO | SEO-012 | Open | Web and accessible downloadable versions cover all protected claim classes, cite methodology, and contain no customer text |
| SEO-020 | P1 | Run crawl/render QA | QA + SEO | SEO-002..008 | Partial | A render pass over every existing route (`/`, `/privacy`, `/terms`, `/history`, `/checkout/success`, `/robots.txt`, `/sitemap.xml`, an unknown path) is recorded in Section 11.2. Three defects were found and fixed (`nonocache` robots directive, private pages inheriting the homepage canonical, sitemap/registry drift). Of the three findings then open in ENG-locked files, the dead sign-in links are fixed; the 404 page's inherited canonical and the un-redirected `www` host remain open. No orphan indexable page, no broken internal link between public pages, and no invalid JSON-LD were found. |
| SEO-021 | P1 | Create weekly SEO scorecard | SEO + Analytics | SEO-009, SEO-010 | Open | Report includes business, funnel, demand, quality, technical, link, and risk KPIs with 7/28-day comparisons and written decisions |
| SEO-022 | P2 | Publish category comparison | SEO + Legal | Firsthand test corpus | Open | Dated methodology, real testing, balanced findings, relationship disclosures, correction route, and update owner are visible |
| SEO-023 | P2 | Build content pruning cadence | SEO | 60 days of data | Open | Monthly review labels each page keep/improve/merge/retire; changes preserve redirects and are tied to traffic/conversion/citation evidence |
| SEO-024 | P2 | Evaluate localization | SEO + Product | Demand evidence | Open | Decision memo documents demand, product support, translation/review ownership, hreflang design, and why each proposed locale is genuinely useful |
| SEO-025 | P2 | Agent-friendly product audit | Engineering + SEO | Stable public UI | Open | Public product flow has semantic controls, labels, understandable errors, and stable product/pricing facts; no new protocol adopted without consumer evidence |
| SEO-026 | P0 | Publish Privacy and Terms pages | SEO + Legal | SEO-001 | Blocked (Legal signoff) | `/privacy` and `/terms` exist, return 200, carry unique host-gated metadata, use the configured Ownword/operator identity, and contain substantive retention, billing, refund, governing-law, liability, eligibility, and termination language without `PENDING` placeholders. The Terms page explicitly records that counsel has not reviewed it; M4-03 therefore remains blocked until LEGAL approves the disclosures. |

### 11.1 Owner actions: search-console verification (SEO-009)

No agent can do any of this. It needs a Google account, a Bing account, and access to the `ownword.pro` DNS
zone or the Cloudflare dashboard. Do them in this order; each step's check is the entry condition for the next.

**Progress (owner-reported 2026-08-25):** Google Search Console is connected. Steps 1 to 3 are therefore done.
Continue from step 4. One caution before submitting the sitemap: the production deploy has not run since the
sign-in work merged, so the live host may still be serving a build whose sitemap and robots output predate it.
Re-run step 1's two checks against the live host first; submitting a sitemap the deploy has not published yet
just records errors in Search Console.

1. **Confirm the live files first.** In a browser (or `curl -I`), open `https://ownword.pro/robots.txt`. It
   must contain `Allow: /` and `Sitemap: https://ownword.pro/sitemap.xml`. Then open
   `https://ownword.pro/sitemap.xml`: it must list exactly three `<loc>` values — `https://ownword.pro/`,
   `https://ownword.pro/privacy`, `https://ownword.pro/terms`. If either file instead shows `Disallow: /` or
   an empty `<urlset>`, the request is not arriving with `Host: ownword.pro` — stop and fix routing before
   touching Search Console, because the site is telling every crawler to stay out.
2. **Create the Google Search Console property.** Go to <https://search.google.com/search-console>, click
   *Add property*, and choose **Domain** (not URL-prefix). Enter `ownword.pro`. Domain properties cover the
   apex, `www`, and both protocols in one property, which is what this site needs.
3. **Verify by DNS TXT.** Google shows one `google-site-verification=...` TXT value. Add it in Cloudflare
   under the `ownword.pro` zone: DNS -> Records -> Add record -> Type `TXT`, Name `@`, Content = the exact
   value Google gave. Save, wait a few minutes, then click *Verify*. Keep the record forever — removing it
   un-verifies the property.
4. **Submit the sitemap.** In the verified property: Sitemaps -> enter `sitemap.xml` -> Submit. Within a day
   it should read *Success* with 3 discovered URLs. Anything less than 3 means a route regressed.
5. **Inspect the homepage live.** Use URL Inspection on `https://ownword.pro/`, then *Test live URL*. Confirm:
   URL is on Google or eligible; **Indexing allowed = Yes**; user-declared canonical `https://ownword.pro`;
   and, under the rendered HTML, that the `Organization`, `WebSite` and `SoftwareApplication` JSON-LD are
   present. Then *Request indexing*. Repeat the inspection (without requesting indexing) for `/privacy` and
   `/terms`.
6. **Check the `www` behavior.** Open `https://www.ownword.pro/`. Today it serves the application with
   `Disallow: /` and `noindex` and no redirect (handoff H-3). Until that is fixed, do not link to, advertise,
   or build links to any `www` URL.
7. **Bing Webmaster Tools.** Go to <https://www.bing.com/webmasters>, add `https://ownword.pro`, and use
   *Import from Google Search Console* (fastest, and it carries the verification across). If importing is
   declined, verify with the same DNS TXT method, then submit `https://ownword.pro/sitemap.xml`.
8. **Record the outcome here.** Write the verification date, property type, and the URL counts each console
   reports into this section, and only then move SEO-009 off *Open*. Also open Google's Rich Results Test
   (<https://search.google.com/test/rich-results>) against `https://ownword.pro/` and record that it reports
   zero errors for `Organization`, `WebSite`, and `SoftwareApplication` — that closes the live half of SEO-006.

Do not request indexing for `/checkout/success`, `/history`, or any `/api/` URL. They are private by design.

### 11.2 Crawl and render QA pass (SEO-020, 2026-08-25)

Method: every route that exists was rendered from the built Worker (`dist/server/index.js`) on
`Host: ownword.pro` and on an off-canonical host, and the returned HTML was parsed for status, title,
description, canonical, robots, OG/Twitter tags, H1 count, JSON-LD validity, and internal links.

Fixed in this pass:

- **Malformed robots directive on every indexable page.** Pages shipped `<meta name="robots" content="index,
  follow, nonocache">`. Next serializes an explicit `nocache: false` as the literal token `nonocache`, which
  no crawler defines. `nocache` is now emitted only when it is true.
- **Canonical conflict on two private URLs.** `/history` and `/checkout/success` inherited the root layout's
  self-canonical and so declared `https://ownword.pro` — the homepage — as their canonical, along with the
  homepage's title and OG card. Both layouts now set `alternates: { canonical: null }`.
- **Sitemap/route drift risk.** The sitemap kept its own hand-maintained list. It now derives from the same
  registry the pages use, and a test fails the build if a sitemap URL does not return 200.

Open findings, all in files SEO does not own (see handoffs):

- ~~**Three dead sign-in links.**~~ **Fixed 2026-08-25.** All three now point at `/signin`, which exists,
  is `noindex`, and is robots-disallowed. Re-verified after the auth work landed. (was H-1)
- **The 404 page inherits the homepage canonical.** An unknown path correctly returns HTTP 404 and
  `noindex`, but also emits `<link rel="canonical" href="https://ownword.pro">`. A genuine 404 should not
  point at `/`. Needs an `app/not-found.tsx`. (H-4)
- **`www.ownword.pro` is a bound custom domain with no redirect.** It serves the whole application under
  `Disallow: /` and `noindex`. Fail-closed, so no duplicate content is indexed, but any link earned on a
  `www` URL is wasted. (H-3)

Verified clean: zero orphan indexable pages (`/privacy` and `/terms` are linked from the homepage footer and
from each other; every sitemap URL is reachable); zero broken internal links between public pages; one H1 per
public page; valid, parseable JSON-LD on every route that emits it; no private surface indexable; no customer
text in any URL, title, canonical, sitemap entry, or OG tag.

Not covered by this pass, and still open: Core Web Vitals / performance budgets (SEO-008) — they need field
data or Lighthouse against the live host, not a rendered-HTML parse.

### 11.3 Handoffs — work SEO deliberately did not do

Each of these is in a file another agent is actively editing (magic-link authentication). They are written up
rather than done, on purpose. Pick them up once auth lands.

- **H-1 — Adopt the shared metadata helper in `app/page.tsx`.** The homepage's metadata currently comes from
  the root layout via the `/` registry entry, which is correct but implicit. Once `app/page.tsx` is free,
  give it `export async function generateMetadata()` returning
  `buildPublicPageMetadata(publicPage("/"), readRequestHost(await headers()))`. The dead-link half of this
  handoff is already done: `app/page.tsx` now links to `/signin`. Do not add a second `<h1>` — the CI gate
  fails the build on it.
- **H-2 — Adopt the shared host rule in `app/robots.txt/route.ts`.** It still carries its own copy of
  `configuredSiteUrl()` + host normalization. Replace with `canonicalOrigin()` / `isCanonicalHost()` /
  `normalizeHost()` from `src/lib/public-pages.ts`. Behavior must not change: off-host stays `Disallow: /`
  with no `Sitemap:` line, and `tests/rendered-html.test.mjs` enforces that. While there, add the new
  sign-in route to the `Disallow` list; note that `Disallow: /history/` does not cover `/history` itself,
  which is intentional — a `noindex` page must stay crawlable for the `noindex` to be seen.
- **H-3 — Redirect `www.ownword.pro` to the apex in one hop.** Either a Cloudflare Redirect Rule
  (`http.host eq "www.ownword.pro"` -> `https://ownword.pro${http.request.uri.path}`, status 301, preserve
  query string), or, in `worker/index.ts` before `handler.fetch`, a 308 to the apex when the request host
  equals `www.` + `productConfig.domain`. Prefer 308 in the Worker if it is done in code: it preserves method
  and body, so a POST to a webhook or API path is not silently downgraded to GET. Add a rendered test
  asserting one hop and a `Location` on the apex.
- **H-4 — Add `app/not-found.tsx`.** A real 404 page with one H1, a link back to `/`, no canonical
  (`alternates: { canonical: null }`), and `robots: { index: false, follow: false }`. This is also a copy
  surface, so COPY should own the words.
- **H-6 — No new content page was published in this pass, on purpose.** The two safest candidates were
  assessed and both fail today's evidence bar. `/how-it-works` would substantially restate the homepage's
  existing `#how-it-works` section, and Section 3's decision rule requires at least 60% of a new page to
  differ from the nearest existing one; Section 4 gates that split on experiment evidence that does not
  exist yet. The Professional mode page (SEO-018) would have to describe mode behavior the deterministic
  baseline does not have. A `/pricing` page was ruled out for the same near-duplicate reason. The first new
  page worth building is one carrying evidence the product can actually back — the pattern diagnostic
  (SEO-014) or the benchmark results (SEO-016) — not another description of the same claims.

- **H-5 — Re-check the funnel copy once purchases can complete.** Section 9's preview-to-checkout and
  checkout-to-paid KPIs are unmeasurable while sign-in is broken. When auth lands, confirm the events fire
  end to end before any acquisition target is set against them.


## 12. Operating cadence and decision rules

### Weekly

- Review indexing alerts, query/page movements, new links/citations, organic funnel conversion, and technical regressions.
- Log actions and expected outcomes; do not react to daily rank noise.
- Send high-intent query insights to Product and Copy, and product-quality objections back to Humanization.

### Monthly

- Score each cluster on qualified impressions, product starts, paid/assisted conversions, second use, links/citations, and maintenance cost.
- Improve evidence before increasing page count.
- Review link profile and disavow only when there is a documented manual-action or substantial manipulative-link risk; random spam alone is not a reason for routine disavowal.
- Recheck public claims, prices, schema, examples, benchmark versions, and competitor facts.

### Stop rules

Pause publishing and investigate when any of these occurs:

- A private result or customer document is indexed or accessible without authorization.
- A manual action, security incident, or material structured-data/content mismatch appears.
- A content pattern creates more than two substantially similar pages.
- Outreach produces requests for undisclosed payment, followed links, fake reviews, or editorial control.
- A page attracts primarily evasion intent or requires deceptive claims to convert.

## 13. Current risks and open decisions

| Risk / decision | Why it matters | V1 response |
|---|---|---|
| Sign-in exists but is unproven in production (updated 2026-08-25) | Magic-link sign-in shipped and the dead `/signin-with-chatgpt` links are gone, but no sign-in has completed against a real mailer on the production host, and checkout readiness is still failing there | Treat organic conversion targets as unmeasurable until one real purchase completes end to end. Do not publish page copy, ads, or measurement claims that assume a purchase can complete today |
| `www.ownword.pro` is a bound custom domain with no redirect | It serves the whole application under `Disallow: /` and `noindex`, so it cannot be indexed (good) but also consolidates nothing (bad): any link earned on a `www` URL is wasted | One-hop 301/308 `www` -> apex (handoff H-3). Until then, never link to, advertise, or build links to a `www` URL |
| Competitive query space is spam-heavy | Pressure toward bypass claims and manufactured backlinks | Differentiate with meaning protection, original benchmark evidence, and strict claim/link rules |
| “Academic humanizer” can imply misconduct | Legal, trust, institution, and reputation exposure | Frame as revision support; visible integrity language; exclude evasion keywords |
| Benchmark may not yet support public claims | Weak evidence can damage trust and invite misleading marketing | Publish methods/limitations first; no performance superlatives until data is reproducible |
| Product and SEO homepage may compete for attention | Long copy can reduce paste rate | Keep input dominant; test supporting modules by qualified starts and paid conversion |
| Indexable user results can leak sensitive writing | Severe privacy and security harm | Private-by-default result architecture, noindex, access controls, and automated crawl tests |
| Mass content is tempting for this category | Doorway/scaled-content penalties and brand dilution | Enforce query-to-page rule, velocity caps, and pruning cadence |
| AI referral reporting is incomplete across platforms | GEO performance can be overclaimed | Use Search Console's available reporting, referrer data, third-party citation logs, and clearly label inference |
| `billingEnabled` is `true` and paid schema is emitted while sign-in is broken | The markup truthfully reflects the configured catalog and the visible price, but a crawler-visible `Offer` implies a purchase path a customer cannot currently walk to the end | Keep checkout readiness fail-closed; re-validate the live catalog, Stripe binding, and visible price the moment auth lands, and before any acquisition spend |
| `/privacy` and `/terms` contain substantive terms but are explicitly not counsel-approved | Complete-looking draft language can be mistaken for legal release approval | Treat M4-03 as a release blocker; LEGAL must approve processor, retention/deletion, subscription, cancellation/refund, and prohibited-claim disclosures before real customer charges |

## 14. Reference policy baseline

- [Google: Optimizing for generative AI features](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [Google: Spam policies, including link spam and scaled content abuse](https://developers.google.com/search/docs/essentials/spam-policies)
- [Google: Guidance on AI-generated content](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content)
- [Google: SoftwareApplication structured data](https://developers.google.com/search/docs/appearance/structured-data/software-app)
- [FTC: Disclosures 101 for social media influencers](https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers)

Review this baseline quarterly and whenever Search Console, Google Search Central, Bing Webmaster, or applicable advertising/endorsement rules materially change.
