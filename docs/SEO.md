# Ownword SEO/GEO Strategy (V1)

**Owner:** SEO/GEO Agent
**Status:** V1 acquisition architecture
**Updated:** 2026-08-25 (SEO backlog completion pass)
**Canonical brand:** Ownword at `ownword.pro` (`humanizer` remains the internal codename and a generic query category)

## 0. Current build reality (verified 2026-08-25, second pass)

Most of this document describes the target architecture, not what exists in `app/` today. The routes that
actually exist are `/` (homepage/workspace), `/privacy`, `/terms`, `/signin` (private, `noindex`),
`/history` (private, `noindex`), `/checkout/success` (private, `noindex`), a real 404 at any unknown path,
plus `/robots.txt` and `/sitemap.xml`. None of the cluster pages in
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

### The sign-in blocker, closed 2026-08-25

Every sign-in link used to target `/signin-with-chatgpt`, a route this repository does not contain (it was
provided by the OpenAI hosting platform), so on `ownword.pro` checkout, unlock, history, and billing were all
unreachable. Email magic-link sign-in shipped at `/signin`, the dead links are gone, and a rendered pass over
the current build confirms `/signin` exists, returns 200, is `noindex, nofollow, nocache`, carries no
canonical, and is `Disallow`ed in robots.txt. The owner reports the flow works in production. **This finding
is closed.**

What remains is not an SEO blocker but still bounds every conversion claim on this page: **no purchase has
been evidenced end to end on the production host from this repository.** Treat organic conversion metrics as
unmeasurable until the owner confirms one real purchase completed.

This does not block indexing: the pages a crawler sees are public, server-rendered, and correct. It does bound
the conversion half of the funnel. **Do not write measurement copy, targets, or page promises that assume a
measured purchase rate exists today**, and do not treat any preview-to-paid metric in Section 9 as measurable
until the funnel has been observed end to end.

### Verified working today (against the current repository)

- `app/robots.txt/route.ts` and `app/sitemap.xml/route.ts` gate all output on the request `Host` header
  matching `productConfig.domain` (`ownword.pro`) exactly (case-insensitive). Off that host — localhost,
  staging, preview — robots.txt returns a blanket `Disallow: /` and the sitemap is an empty `<urlset>`. This
  is enforced by `tests/rendered-html.test.mjs` and is by design (SEO-002), not a defect. On the
  `ownword.pro` Host, robots.txt allows crawling (with `/api/`, `/account/`, `/admin/`, `/billing/`,
  `/checkout/`, `/history/`, `/result/`, `/signin` disallowed) and references the sitemap. The sitemap lists
  exactly `/`, `/privacy`, and `/terms`. Both routes now read the one host rule from
  `src/lib/public-pages.ts` rather than a private copy of it.
- `www.ownword.pro` no longer serves the application. `worker/index.ts` answers it with a **308** to the
  apex before anything else runs, preserving path, query, and method. Verified in `tests/rendered-html.test.mjs`
  for one hop, for query preservation, for a `POST`, for a mixed-case `Host`, and for the neighbouring
  hostnames (`staging.ownword.pro`, `wwwownword.pro`, `www.ownword.pro.example.com`) that must *not* be swept
  up. The decision reads the real `Host` and ignores `x-forwarded-host`, so a spoofed header cannot redirect
  the apex to itself. **Live behavior is unverified from this repository** — see owner action O-6.
- `src/lib/public-pages.ts` is the single registry of publicly indexable pages and holds both metadata
  builders (SEO-005): `buildPublicPageMetadata()` for indexable pages and `buildPrivateSurfaceMetadata()` for
  everything that must claim nothing. `app/layout.tsx`, `app/privacy/page.tsx`, `app/terms/page.tsx`,
  `app/robots.txt/route.ts`, `app/sitemap.xml/route.ts`, `app/not-found.tsx` and the three private layouts
  all read from it, so the sitemap cannot list a URL whose page does not exist and a private page cannot
  quietly inherit the homepage's identity. The one file that does not read it is `app/page.tsx` — see H-1.
- `src/lib/site-structured-data.ts` emits `Organization` + `WebSite` JSON-LD on the canonical host only
  (SEO-006). The homepage additionally emits `SoftwareApplication` from `app/page.tsx`, whose `Offer` block
  is conditional on `productConfig.billingEnabled` (currently `true`). That second block is **not** host-gated
  — `app/page.tsx` is a client component and cannot read the request host — so it ships on staging and
  localhost too, on pages that are `noindex` there. See finding F4 in Section 11.2. Commercial launch still
  requires the legal, security, and pricing release gates.
- `/privacy` and `/terms` return 200 with unique Ownword metadata, the configured operator and support
  address, substantive policy text, and host-gated canonical/index directives. They contain no `PENDING`
  placeholders, but final counsel review remains part of M4-03.
- `/signin`, `/history` and `/checkout/success` are private: all three emit `noindex, nofollow, nocache` and,
  since this pass, no canonical, no meta description, and no Open Graph or Twitter card at all. Rendered tests
  prove none of them appears in the sitemap.
- A genuine 404 is a genuine 404. `app/not-found.tsx` returns HTTP 404 with one H1, a link back to `/`, no
  canonical, and no inherited homepage card. Trailing slashes normalize in one hop (`/privacy/` -> 308 ->
  `/privacy`).
- `tests/metadata-contract.test.mjs` is the CI gate for SEO-005: it crawls the canonical-host sitemap and
  fails the build if any listed URL is not 200, or is missing a title, meta description, self-canonical,
  `og:title/description/type/url/site_name/image`, `twitter:card/title/description`, or exactly one H1. It
  now also holds the pages that are deliberately *out* of the sitemap to their own contract. The gate was
  mutation-checked on 2026-08-25 rather than assumed — see SEO-005 in Section 11.


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
| SEO-002 | P0 | Implement indexation matrix | Engineering + Security | SEO-001 | Done (repository) | Rendered tests prove the canonical-host public allow path, the off-host `noindex`/empty-sitemap default, `noindex, nofollow, nocache` with no canonical and no social card on all three private surfaces (`/signin`, `/history`, `/checkout/success`), and a genuine 404 that declares no canonical. No private URL appears in the sitemap. `tests/metadata-contract.test.mjs` re-checks every class each build. The 404 gap that held this at *Partial* is closed by `app/not-found.tsx`. Account and admin surfaces do not exist yet; robots.txt already disallows their paths. Live verification is owner action O-1. |
| SEO-003 | P0 | Implement canonical and redirect policy | Engineering | SEO-001 | Done (repository) / owner-verified live | Verified against the built Worker: `/`, `/privacy`, `/terms` self-canonicalize on the canonical host only; private surfaces and the 404 carry no canonical; off-host output fails closed; trailing slashes normalize in one hop (`/privacy/` -> 308 -> `/privacy`); and `www.ownword.pro` now 308s to the apex in one hop with path, query and method preserved, so `www` consolidates instead of leaking. 308 rather than 301 so a `POST` to `/api/*` cannot be silently downgraded to `GET`. **Not verifiable here:** that the deploy carrying the redirect is live, and that HTTP -> HTTPS is enforced at the Cloudflare edge. Both are owner action O-6. |
| SEO-004 | P0 | Generate XML sitemap and robots.txt | Engineering | SEO-002 | Done (repository) / owner-verified live | Canonical-host output lists exactly `/`, `/privacy`, `/terms`, each an existing 200 route drawn from `src/lib/public-pages.ts`; robots.txt references the sitemap; off-host output fails closed. `lastmod` is emitted only for `/privacy` and `/terms`, from the same constant those pages display, and a test fails if a sitemap date is not visible on its page; `/` tracks no material modification date and correctly omits `lastmod`. `/signin`, `/history` and `/checkout/success` are private and are proven absent. Since this pass both files read the shared host rule rather than a private copy, and their output is pinned on and off the canonical host. Live fetch of the two files is owner action O-1. |
| SEO-005 | P0 | Build reusable metadata API | Engineering + Copy | SEO-001 | Partial | `src/lib/public-pages.ts` is the shared registry and holds both builders. Adopted by `app/layout.tsx`, `/privacy`, `/terms`, `app/sitemap.xml/route.ts`, `app/robots.txt/route.ts` (H-2, done this pass), `app/not-found.tsx`, and the `/signin`, `/history`, `/checkout/success` layouts. **The gate is proven, not asserted:** on 2026-08-25 five deliberate mutations were each caught by `tests/metadata-contract.test.mjs` with a message naming the defect — removing `og:image` from the builder (*is missing og:image*), duplicating a description across two pages (*duplicates another page's meta description*), adding a second H1 (*must have exactly one H1, found 2*), registering a sitemap URL with no route (*does not return 200*), and dropping the canonical (*does not self-canonicalize*). One adoption remains and cannot be done as specified: `app/page.tsx` is a `"use client"` component, so it cannot export `generateMetadata` — see H-1 for what was measured and what it would cost. |
| SEO-006 | P0 | Add truthful structured data | Engineering + SEO | SEO-001, pricing config | Partial | `Organization` + `WebSite` JSON-LD ship from `src/lib/site-structured-data.ts` **on the canonical host only**, and parse valid. Every property is verifiable from `src/config/product.ts`: brand name, `legalName` Bosphorus Elevate LLC, origin, support `ContactPoint`, `inLanguage`. `logo`, `sameAs`, `aggregateRating`, `foundingDate`, `address` and `SearchAction` are deliberately absent and a test fails if any appears. **Correction to the previous status:** the homepage's `SoftwareApplication` block is *not* host-gated — it is emitted from the client component `app/page.tsx`, which cannot read the request `Host`, so a rendered pass finds it on `staging.ownword.pro` too (finding F4, Section 11.2). Those pages are `noindex` there, so nothing is indexed, but the gating claim was overstated. Remaining: host-gate `SoftwareApplication` (blocked behind H-1) and live Rich Results validation (owner action O-4). |
| SEO-007 | P0 | Protect customer text from discovery/analytics | Security + Engineering | SEO-002 | Partial | Test confirms text never appears in a URL, in metadata, in analytics, in the sitemap, in a public cache, or in an unauthorized response; private result access control passes. Re-checked this pass against the routes that now exist: `/history` and `/signin` render no customer text into any title, canonical, social tag or sitemap entry, carry no canonical at all, and are `noindex, nofollow, nocache`. Not yet covered: `/history` renders a signed-in customer's own writing and is `Disallow`ed only below `/history/`, which is deliberate (a `noindex` a crawler may not fetch is a `noindex` it never reads) but means the page itself must stay authenticated on the server, not merely `noindex`. |
| SEO-008 | P0 | Establish performance budgets | Engineering + Design | Core UI | Open | Not verified in either QA pass, and not verifiable from this repository: Core Web Vitals need field data or a Lighthouse run against a live host this session cannot reach. Owner action O-8. The budgets themselves are stated in Section 6; what is missing is a measurement, not a target. |
| SEO-009 | P0 | Verify search-engine consoles | SEO + Hosting (owner action) | Live deployment | Partial (owner-reported; steps 1-4 and 7 done, 5-6 and 8 open) | **Owner-reported, not verified by any agent:** Google Search Console is connected for `ownword.pro`, the sitemap is submitted, and Bing Webmaster Tools verification is complete. **Verified from the repository:** the `msvalidate.01` token is present and ungated in `app/layout.tsx` (it renders on every host, including off-canonical, which is deliberate so a Bing fetch through any hostname still finds it), and the canonical-host sitemap serves exactly the three apex URLs with `lastmod` on `/privacy` and `/terms`. **No agent in this project can reach GSC, Bing, or the live host** — outbound to `ownword.pro` is blocked from the sandbox — so nothing below the repository line is evidence. Still open and owner-only: live URL Inspection on `/`, `/privacy`, `/terms` for *Indexing allowed = Yes* and the expected canonical (step 5); re-check `www` now that the 308 has shipped (step 6); record the console-reported URL counts and the Rich Results result here (step 8). |
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
| SEO-020 | P1 | Run crawl/render QA | QA + SEO | SEO-002..008 | Partial | Second render pass completed 2026-08-25 over **every** route that now exists — `/`, `/privacy`, `/terms`, `/signin`, `/history`, `/checkout/success`, `/robots.txt`, `/sitemap.xml`, three unknown paths, and trailing-slash variants — on the canonical host, on `www`, and on an off-canonical host. Recorded in Section 11.2. Five findings: three fixed in this pass (404 inheriting the homepage canonical; private surfaces inheriting the homepage description and social card; `www` serving the app unredirected), two open (F3, no H1 on the three private surfaces, DESIGN-owned; F4, un-host-gated `SoftwareApplication`, blocked behind H-1). Zero orphan indexable pages, zero broken internal links, valid JSON-LD everywhere it is emitted, no customer text in any crawlable surface. Held at *Partial* because the two open findings are real and because performance (SEO-008) still needs a live host this session cannot reach. |
| SEO-021 | P1 | Create weekly SEO scorecard | SEO + Analytics | SEO-009, SEO-010 | Open | Report includes business, funnel, demand, quality, technical, link, and risk KPIs with 7/28-day comparisons and written decisions |
| SEO-022 | P2 | Publish category comparison | SEO + Legal | Firsthand test corpus | Open | Dated methodology, real testing, balanced findings, relationship disclosures, correction route, and update owner are visible |
| SEO-023 | P2 | Build content pruning cadence | SEO | 60 days of data | Open | Monthly review labels each page keep/improve/merge/retire; changes preserve redirects and are tied to traffic/conversion/citation evidence |
| SEO-024 | P2 | Evaluate localization | SEO + Product | Demand evidence | Open | Decision memo documents demand, product support, translation/review ownership, hreflang design, and why each proposed locale is genuinely useful |
| SEO-025 | P2 | Agent-friendly product audit | Engineering + SEO | Stable public UI | Open | Public product flow has semantic controls, labels, understandable errors, and stable product/pricing facts; no new protocol adopted without consumer evidence |
| SEO-026 | P0 | Publish Privacy and Terms pages | SEO + Legal | SEO-001 | Blocked (Legal signoff) | `/privacy` and `/terms` exist, return 200, carry unique host-gated metadata, use the configured Ownword/operator identity, and contain substantive retention, billing, refund, governing-law, liability, eligibility, and termination language without `PENDING` placeholders. The Terms page explicitly records that counsel has not reviewed it; M4-03 therefore remains blocked until LEGAL approves the disclosures. |

### 11.1 Owner actions: search-console verification (SEO-009)

No agent can do any of this. It needs a Google account, a Bing account, and access to the `ownword.pro` DNS
zone or the Cloudflare dashboard. Do them in this order; each step's check is the entry condition for the next.

**Progress (owner-reported 2026-08-25, second pass).** Steps 1-4 and step 7 are reported done: Google Search
Console is connected for `ownword.pro`, `sitemap.xml` is submitted, and Bing Webmaster Tools verification has
completed. None of that is verifiable by any agent here — outbound to `ownword.pro` is blocked from this
sandbox — so it is recorded as the owner's report, not as evidence.

**Continue from step 5.** Two cautions:

- The `www` -> apex 308 (H-3) and the 404 fix (H-4) are in the repository but have not necessarily been
  deployed. Step 6 below now checks for the redirect; if `www.ownword.pro` still serves the application, the
  deploy has not run and the rest of this list is being checked against stale output.
- Before requesting indexing for anything, re-run step 1's two checks against the live host. Requesting
  indexing for a page the deploy has not published yet just records errors in Search Console.

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
6. **Check the `www` behavior.** Open `https://www.ownword.pro/privacy?x=1` with redirects visible
   (`curl -sSI` shows the status and `Location` without following). Expect **exactly one** hop: `308` with
   `Location: https://ownword.pro/privacy?x=1`. That is the behavior in the repository as of this pass. If
   you instead get a `200` with page content, the deploy carrying it has not run — do not link to, advertise,
   or build links to any `www` URL until it has. While here, confirm `http://ownword.pro/` also reaches
   `https://ownword.pro/` in one hop; that redirect is Cloudflare's *Always Use HTTPS*, not application code,
   and nothing in this repository can assert it.
7. **Bing Webmaster Tools.** Go to <https://www.bing.com/webmasters>, add `https://ownword.pro`, and use
   *Import from Google Search Console* (fastest, and it carries the verification across). If importing is
   declined, verify with the same DNS TXT method, then submit `https://ownword.pro/sitemap.xml`.
8. **Record the outcome here.** Write the verification date, property type, and the URL counts each console
   reports into this section, and only then move SEO-009 to *Done*. Also open Google's Rich Results Test
   (<https://search.google.com/test/rich-results>) against `https://ownword.pro/` and record that it reports
   zero errors for `Organization`, `WebSite`, and `SoftwareApplication` — that closes the live half of SEO-006.

   Write what the console actually said, including the numbers. "Submitted" is not "Success, 3 URLs
   discovered", and only the second one tells you a route did not regress.

Do not request indexing for `/signin`, `/checkout/success`, `/history`, or any `/api/` URL. They are private
by design, and all of them are `noindex, nofollow, nocache` with no canonical.

### 11.2 Crawl and render QA pass (SEO-020, second pass 2026-08-25)

**Method.** Every route that exists was rendered from the built Worker (`dist/server/index.js`) and the
returned HTML parsed for status, title, description, canonical, robots, OG/Twitter tags, H1 count, JSON-LD
validity, and internal links. Three host profiles were used: the canonical host (`ownword.pro`),
`www.ownword.pro`, and an off-canonical host (`staging.ownword.pro`, plus `localhost`). Routes covered:
`/`, `/privacy`, `/terms`, `/signin`, `/history`, `/checkout/success?job=...`, `/robots.txt`, `/sitemap.xml`,
the trailing-slash variants `/privacy/`, `/terms/`, `/history/`, and three unknown paths
(`/this-page-does-not-exist`, `/result/abc`, `/guides/not-written-yet`).

**This is a rendered-HTML pass, not a live-site pass.** Outbound to `ownword.pro` is blocked from this
sandbox. Nothing here is an observation of production; every statement is about the code in this repository
as built. The live equivalents are owner actions O-1 and O-6.

#### Findings

| # | Finding | Severity | State |
|---|---|---|---|
| F1 | A genuine 404 emitted `<link rel="canonical" href="https://ownword.pro">` along with the homepage title, description and social card. A canonical asserts that two URLs are the same page; a missing URL is not the homepage, and repeated across every stale link that is how a 404 gets folded into `/`. | High | **Fixed** — `app/not-found.tsx` |
| F2 | `/signin`, `/history` and `/checkout/success` inherited the homepage's meta description and its whole Open Graph and Twitter card from the root layout, including `og:url` pointing at `https://ownword.pro`. A private URL pasted into a chat unfurled as the homepage. `/checkout/success` also wore the homepage `<title>` verbatim. | Medium | **Fixed** — `buildPrivateSurfaceMetadata()` |
| F3 | `/signin`, `/history` and `/checkout/success` render **zero** `<h1>` elements; each opens its content with an `<h2>` inside `<main>`. Not an indexing problem (all three are `noindex`), but Section 6 requires one clear H1 per page for the document outline, and screen-reader users navigating by heading level find no top-level heading. | Low | **Open** — handoff H-7, DESIGN/COPY-owned |
| F4 | The homepage's `SoftwareApplication` JSON-LD, `Offer` block included, is emitted on **every** host — it renders from `app/page.tsx`, a client component that cannot read the request `Host`. `Organization` and `WebSite` are correctly gated to the canonical host. Nothing is indexed off-host (those pages are `noindex`), but SEO-006's gating claim did not hold for this block and has been corrected. | Low | **Open** — blocked behind H-1 |
| F5 | `www.ownword.pro` was a bound custom domain serving the entire application with no redirect. Fail-closed (`Disallow: /`, `noindex`), so nothing duplicate was ever indexed, but nothing consolidated either: a link or share on a `www` URL earned the apex nothing. | Medium | **Fixed in code** — 308 in `worker/index.ts`; live state unverified (O-6) |

Findings fixed in the first pass and re-confirmed still fixed: the malformed `nonocache` robots directive;
the `/history` and `/checkout/success` canonical conflict; sitemap/registry drift; the three dead
`/signin-with-chatgpt` links (now `/signin`, which exists, returns 200, and is robots-disallowed).

#### Verified clean

- **Status codes.** Every sitemap URL returns 200. Every unknown path returns a genuine 404, never a soft
  200 — including one under a route prefix that exists (`/result/abc`).
- **Redirects.** Trailing slashes normalize in one hop (`/privacy/`, `/terms/`, `/history/` -> 308 -> the
  unslashed path). `www` -> apex is one hop, preserves path and query, and uses 308 so a `POST` body is not
  dropped. Neighbouring hostnames (`staging.ownword.pro`, `wwwownword.pro`, `www.ownword.pro.example.com`)
  are not redirected. A spoofed `x-forwarded-host: www.ownword.pro` on the apex does not start a loop.
- **Host gate.** On `staging.ownword.pro` and `localhost` every page is `noindex, nofollow, nocache` with no
  canonical, no `og:url` and no social image; robots.txt is `Disallow: /` with no `Sitemap:` line; the
  sitemap is an empty `<urlset>`. This is the SEO-002 design, not a defect.
- **Structured data.** Every JSON-LD block on every route parses. The site graph carries no `logo`,
  `sameAs`, `aggregateRating`, `foundingDate`, `address` or `SearchAction`, and a test fails if one appears.
- **Links and orphans.** Zero orphan indexable pages: `/privacy` and `/terms` are reachable from the
  homepage footer, from each other, and now from the 404. Zero broken internal links between public pages —
  every internal `href` on every rendered route resolves to a route that returns 200 or an intentional
  redirect.
- **Privacy.** No customer text in any URL, title, canonical, description, sitemap entry, social tag or
  JSON-LD payload on any route, on any host.

#### Known and accepted

- **A 404 carries two `robots` meta tags.** The framework emits its own `<meta name="robots"
  content="noindex">` and `app/not-found.tsx` adds `noindex, nofollow, nocache`. Crawlers combine multiple
  robots tags and apply the most restrictive; both say `noindex`, so the combined directive is correct. The
  framework's tag cannot be suppressed from application code. A test asserts every robots tag on a 404 says
  `noindex`, so a future framework change that emitted `index` would fail the build.
- **`/checkout/success` is both `Disallow`ed and `noindex`.** A crawler forbidden to fetch a page cannot read
  its `noindex`, so the URL could in principle be indexed URL-only from an external link. It is reached only
  through a Stripe redirect and carries no title or content claim, so `Disallow` is the stronger posture
  here. `/history` takes the opposite trade deliberately: it stays crawlable so its `noindex` is readable,
  and only `/history/` below it is disallowed.
- **A 404 still emits the site-level `Organization`/`WebSite` graph** from the root layout. That graph
  describes the site, not the page, and is valid on any URL of the site.

#### Not covered by this pass

Core Web Vitals and the performance budgets (SEO-008). They need field data or a Lighthouse run against the
live host, not a rendered-HTML parse, and this session cannot reach it.

### 11.3 Handoffs — work SEO deliberately did not do

Statuses below are as of 2026-08-25 (second pass). H-2, H-3 and H-4 are **done**; they are kept here with
what was actually built, because the acceptance criteria in Sections 11 and 6 point at them.

- **H-1 — Adopt the shared metadata helper in `app/page.tsx`. Not done, and not doable as written.**
  `app/page.tsx` opens with `"use client"`. A client component cannot own route metadata. This was measured,
  not assumed: adding `export async function generateMetadata()` to the file and building did **not** fail —
  it silently emptied the homepage's entire head. Title, description, canonical, robots, Open Graph and
  Twitter tags all disappeared from the rendered HTML. That is a worse failure mode than a build error,
  because it ships.

  Doing it properly means splitting the route: `app/page.tsx` becomes a small server component exporting
  `generateMetadata()` and rendering a client component that holds the current 660 lines. Nothing about the
  homepage's rendered metadata would change — it is already exactly
  `buildPublicPageMetadata(publicPage("/"), host)`, supplied through the root layout — so the payoff is not
  the homepage. The payoff is two other things: the root layout stops broadcasting the homepage's identity as
  the site-wide default (this pass neutralized the symptom on every private surface, but the cause remains),
  and the `SoftwareApplication` JSON-LD becomes host-gateable, closing finding F4.

  **Why it was left.** Five tests read `app/page.tsx` *as source*, not as rendered output, and treat it as
  the landing-copy surface: `tests/rendered-html.test.mjs` (centralized brand/pricing copy, and the em-dash
  ban that scans the whole file), `tests/landing-activation.test.mts` (ACT-12/ACT-16), and
  `tests/activation-blockers.test.mts` (ACT-09, ACT-10, twice). Moving the copy out of `app/page.tsx`
  without moving every one of those guards to the new path would quietly disarm them. That is a coordinated
  change across COPY's and ENG's files, and a design agent was live in the copy surfaces during this pass.
  Do it as one commit that relocates the component **and** repoints all five tests, or not at all.

- **H-2 — Adopt the shared host rule in `app/robots.txt/route.ts`. Done.** The route's private
  `configuredSiteUrl()` and its own host normalization are gone; it now uses `canonicalOrigin()`,
  `isCanonicalHost()` and `normalizeHost()` from `src/lib/public-pages.ts`. Output is unchanged on and off
  the canonical host, and `tests/rendered-html.test.mjs` now pins both: the full `Allow`/`Disallow`/`Sitemap`
  set on `ownword.pro`, and a bare `Disallow: /` with no `Sitemap:` line on three off-canonical hosts.
  `/signin` was already in the `Disallow` list. `Disallow: /history/` still does not cover `/history` itself,
  which remains intentional and is now asserted as such — a `noindex` a crawler may not fetch is a `noindex`
  it never reads.

- **H-3 — Redirect `www.ownword.pro` to the apex in one hop. Done in the Worker.** `worker/index.ts`
  answers a request whose real `Host` is `www.` + `productConfig.domain` with a **308** to the apex,
  preserving path, query and method, before anything else in the handler runs. 308 rather than 301 because a
  301 permits a client to rewrite the method to `GET`, which would silently drop the body of a `POST` to
  `/api/*` or to the Stripe webhook path. The decision reads the real `Host` and ignores `x-forwarded-host`,
  so an inbound header claiming to be `www` cannot redirect the apex to itself forever.

  **A Cloudflare Redirect Rule would also have been a defensible answer** — it is cheaper (no Worker
  invocation) and it survives an application outage. It was not chosen because it is a dashboard change no
  agent can make, review, or test, and because the Worker version can be asserted in CI, which it now is.
  If the owner would rather move it to the edge later, delete `redirectWwwToApex()` and its two tests in the
  same change as adding the rule — never run both.

- **H-4 — Add `app/not-found.tsx`. Done.** A real 404 now returns HTTP 404 with one H1, links back to `/`,
  `/privacy` and `/terms`, declares no canonical, and inherits none of the homepage's description or social
  card. See the *Known and accepted* note in Section 11.2 about the duplicate framework `robots` tag. **The
  words are placeholders owned by COPY**, not by SEO: they state only that the URL does not exist and offer
  the routes that do.

- **H-5 — Re-check the funnel copy once purchases can complete.** Still open. Section 9's
  preview-to-checkout and checkout-to-paid KPIs are unmeasurable until a purchase has been observed end to
  end on the production host. Sign-in shipping does not close this; a completed purchase does.

- **H-6 — No new content page was published in this pass either, on purpose, and for the same reason.**
  Re-examined and re-declined. The Professional mode page (SEO-018) would have to describe a distinct
  professional workflow, but `src/lib/humanization/deterministic-provider.ts` still distinguishes
  Professional from the other modes by exactly three regular-expression substitutions layered on a shared
  table. A page claiming mode-specific quality would state something the engine cannot do, which Section 1
  forbids outright. `/how-it-works` and `/pricing` remain near-duplicates of existing homepage sections and
  fail Section 3's 60%-different rule. **This is not a backlog item waiting for writing time; it is waiting
  for evidence.** The first new page worth building is one carrying evidence the product can actually back:
  the pattern diagnostic (SEO-014) or the benchmark results (SEO-016).

  A related copy constraint, recorded so nobody trips on it: sentence regeneration shipped server-side with
  **no customer-facing UI**. Do not write page copy, metadata, or structured data implying a customer can
  edit or regenerate an individual sentence today.

- **H-7 — Give the three private surfaces a top-level heading. New, DESIGN/COPY-owned.** `/signin`,
  `/history` and `/checkout/success` render zero `<h1>`; each opens with an `<h2>` inside `<main>` (finding
  F3). Section 6 requires one clear H1 per page, and a screen-reader user navigating by heading level finds
  no top-level heading on any of them. The fix is a one-element change per page, but the heading is visible
  copy and those files are DESIGN's, so SEO did not make it. Note that the metadata gate in
  `tests/metadata-contract.test.mjs` enforces exactly-one-H1 only for **sitemap** URLs; if these pages get
  an H1, consider extending the private-surface test to hold them to it too.

### 11.4 Owner actions index

`O-*` IDs are referenced throughout Section 11. None of them can be closed by an agent: each needs a browser
against the live host, a console login, or a Cloudflare dashboard. They are listed here so the references
resolve, and so nobody mistakes one for engineering work that is merely unstarted.

| ID | Owner action | Closes | Check that closes it |
|---|---|---|---|
| O-1 | Fetch `https://ownword.pro/robots.txt` and `https://ownword.pro/sitemap.xml` from a browser | Live half of SEO-002, SEO-004 | robots.txt shows `Allow: /` and the `Sitemap:` line; the sitemap lists exactly the three apex URLs, with `<lastmod>` on `/privacy` and `/terms` |
| O-2 | Create and DNS-verify the Google Search Console **Domain** property, submit `sitemap.xml` | SEO-009 steps 2-4 | **Owner-reported done 2026-08-25.** Record the console's own words: *Success*, and the discovered-URL count |
| O-3 | Live URL Inspection on `/`, `/privacy`, `/terms` | SEO-009 step 5 | *Indexing allowed = Yes*, user-declared canonical `https://ownword.pro`, JSON-LD present in the rendered HTML |
| O-4 | Google Rich Results Test against `https://ownword.pro/` | Live half of SEO-006 | Zero errors for `Organization`, `WebSite`, `SoftwareApplication` |
| O-5 | Bing Webmaster Tools property + sitemap submission | SEO-009 step 7 | **Owner-reported done 2026-08-25.** Record the property type and the discovered-URL count |
| O-6 | Confirm host and protocol redirects on the live host | Live half of SEO-003 | `https://www.ownword.pro/privacy?x=1` returns **one** hop, `308`, `Location: https://ownword.pro/privacy?x=1`; `http://ownword.pro/` reaches `https://ownword.pro/` in one hop |
| O-7 | Confirm one purchase completes end to end on production | H-5, and every conversion KPI in Section 9 | Sign-in against the real mailer, Checkout, paid rewrite, and the funnel events observed for all three |
| O-8 | Lighthouse or field data against the live host | SEO-008 | p75 mobile LCP <= 2.5 s, INP <= 200 ms, CLS <= 0.1, or a dated exception with an owner |

Record outcomes in Section 11.1 step 8 with the numbers the tool reported. "Submitted" is not "Success, 3
URLs discovered", and only the second tells you a route did not regress.

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
| No purchase has been evidenced end to end (updated 2026-08-25) | Magic-link sign-in shipped, `/signin` renders correctly, the dead `/signin-with-chatgpt` links are gone, and the owner reports the flow works in production. What no agent can evidence from this repository is a completed purchase: sign-in against a real mailer, then Checkout, then a paid rewrite | Treat organic conversion targets as unmeasurable until the owner confirms one real purchase completed end to end. Do not publish page copy, ads, or measurement claims that assume a measured conversion rate exists (handoff H-5) |
| The `www` -> apex 308 is in the repository but its live state is unverified | `www.ownword.pro` is a bound custom domain. Until the deploy carrying `redirectWwwToApex()` runs, `www` still serves the whole application under `Disallow: /` and `noindex`: not indexable (good), but consolidating nothing (bad), so any link earned on a `www` URL stays wasted | Owner action O-6: confirm one 308 hop to the apex on the live host (Section 11.1, step 6). Until that is confirmed, still never link to, advertise, or build links to a `www` URL |
| Competitive query space is spam-heavy | Pressure toward bypass claims and manufactured backlinks | Differentiate with meaning protection, original benchmark evidence, and strict claim/link rules |
| “Academic humanizer” can imply misconduct | Legal, trust, institution, and reputation exposure | Frame as revision support; visible integrity language; exclude evasion keywords |
| Benchmark may not yet support public claims | Weak evidence can damage trust and invite misleading marketing | Publish methods/limitations first; no performance superlatives until data is reproducible |
| Product and SEO homepage may compete for attention | Long copy can reduce paste rate | Keep input dominant; test supporting modules by qualified starts and paid conversion |
| Indexable user results can leak sensitive writing | Severe privacy and security harm | Private-by-default result architecture, noindex, access controls, and automated crawl tests |
| Mass content is tempting for this category | Doorway/scaled-content penalties and brand dilution | Enforce query-to-page rule, velocity caps, and pruning cadence |
| AI referral reporting is incomplete across platforms | GEO performance can be overclaimed | Use Search Console's available reporting, referrer data, third-party citation logs, and clearly label inference |
| `billingEnabled` is `true` and a priced `Offer` is emitted before any purchase has been evidenced | The markup truthfully reflects the configured catalog and the visible price, but a crawler-visible `Offer` implies a purchase path nobody has yet watched a customer walk to the end. The `SoftwareApplication` block carrying it is also emitted on non-canonical hosts (finding F4), where those pages are `noindex` | Keep checkout readiness fail-closed; re-validate the live catalog, Stripe binding, and visible price before any acquisition spend; host-gate the block when H-1 unblocks it |
| `/privacy` and `/terms` contain substantive terms but are explicitly not counsel-approved | Complete-looking draft language can be mistaken for legal release approval | Treat M4-03 as a release blocker; LEGAL must approve processor, retention/deletion, subscription, cancellation/refund, and prohibited-claim disclosures before real customer charges |

## 14. Reference policy baseline

- [Google: Optimizing for generative AI features](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [Google: Spam policies, including link spam and scaled content abuse](https://developers.google.com/search/docs/essentials/spam-policies)
- [Google: Guidance on AI-generated content](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content)
- [Google: SoftwareApplication structured data](https://developers.google.com/search/docs/appearance/structured-data/software-app)
- [FTC: Disclosures 101 for social media influencers](https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers)

Review this baseline quarterly and whenever Search Console, Google Search Central, Bing Webmaster, or applicable advertising/endorsement rules materially change.
