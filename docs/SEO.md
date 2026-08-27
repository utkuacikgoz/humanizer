# Ownword SEO/GEO Strategy (V1)

**Owner:** SEO/GEO Agent
**Status:** V1 acquisition architecture
**Updated:** 2026-08-26 (SEO finishing pass: H-1, SEO-005, SEO-006, SEO-007, SEO-013, SEO-020 third crawl)
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
the current build confirms `/signin` exists, returns 200, is `noindex, nofollow, nocache` and carries no
canonical. It is no longer `Disallow`ed — see finding F7 — precisely so that `noindex` is readable by the
crawler the homepage sends there. The owner reports the flow works in production. **This finding is
closed.**

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
  `/checkout/`, `/history/`, `/result/` disallowed) and references the sitemap. The sitemap lists
  exactly `/`, `/privacy`, and `/terms`. Both routes now read the one host rule from
  `src/lib/public-pages.ts` rather than a private copy of it, and the `Disallow` list itself is the exported
  `CRAWLER_DISALLOWED_PREFIXES` there, so the quality gate can hold the invariant that ties the two files
  together: an indexable page must not link to a path robots.txt refuses. `/signin` left that list in the
  2026-08-26 pass — see finding F7 in Section 11.2 for why a disallowed page that `/` links to is the worst
  of both postures.
- `www.ownword.pro` no longer serves the application. `worker/index.ts` answers it with a **308** to the
  apex before anything else runs, preserving path, query, and method. Verified in `tests/rendered-html.test.mjs`
  for one hop, for query preservation, for a `POST`, for a mixed-case `Host`, and for the neighbouring
  hostnames (`staging.ownword.pro`, `wwwownword.pro`, `www.ownword.pro.example.com`) that must *not* be swept
  up. The decision reads the real `Host` and ignores `x-forwarded-host`, so a spoofed header cannot redirect
  the apex to itself. **Live behavior is unverified from this repository** — see owner action O-6.
- `src/lib/public-pages.ts` is the single registry of publicly indexable pages and holds both metadata
  builders (SEO-005): `buildPublicPageMetadata()` for indexable pages and `buildPrivateSurfaceMetadata()` for
  everything that must claim nothing. `app/layout.tsx`, `app/privacy/page.tsx`, `app/terms/page.tsx`,
  `app/robots.txt/route.ts`, `app/sitemap.xml/route.ts`, `app/not-found.tsx`, `app/page.tsx` and the three
  private layouts all read from it, so the sitemap cannot list a URL whose page does not exist and a private
  page cannot quietly inherit the homepage's identity. **Every public page now reads it, `app/page.tsx`
  included** (H-1, done 2026-08-26). The registry also carries the page-template fields SEO-013 enforces:
  `intent`, `contentOwner` and `primaryCta`.
- `src/lib/site-structured-data.ts` emits `Organization` + `WebSite` JSON-LD on the canonical host only
  (SEO-006), and now also the homepage's `SoftwareApplication`, whose `Offer` block is conditional on
  `productConfig.billingEnabled` (currently `true`). **Both blocks are host-gated by the same rule** as of
  2026-08-26: finding F4 is closed. The `SoftwareApplication` block used to render from the client component
  that was `app/page.tsx`, which cannot read the request `Host`, so the product's prices shipped on staging
  and localhost too. A rendered test now requires the entity on `ownword.pro` and its absence on three
  off-canonical hosts. Commercial launch still requires the legal, security, and pricing release gates.
- `/privacy` and `/terms` return 200 with unique Ownword metadata, the configured operator and support
  address, substantive policy text, and host-gated canonical/index directives. They contain no `PENDING`
  placeholders, but final counsel review remains part of M4-03.
- `/signin`, `/history` and `/checkout/success` are private: all three emit `noindex, nofollow, nocache` and,
  since this pass, no canonical, no meta description, and no Open Graph or Twitter card at all. Rendered tests
  prove none of them appears in the sitemap.
- A genuine 404 is a genuine 404. `app/not-found.tsx` returns HTTP 404 with one H1, a link back to `/`, no
  canonical, and no inherited homepage card. Trailing slashes normalize in one hop (`/privacy/` -> 308 ->
  `/privacy`).
- **The root layout no longer lends its pages the homepage's identity.** `app/layout.tsx` used to supply the
  homepage's title, description, canonical, Open Graph and Twitter card as the site-wide default, which is
  why the 404 and the three private surfaces each had to remember to null all of it out, and why the ones
  that forgot unfurled as `/`. Its default is now fail-closed: a name for the tab, the icon, the Bing token,
  and `noindex` with no canonical. A route that forgets to declare metadata is invisible to search rather
  than claiming to be the homepage.
- **The homepage route is a server shell.** `app/page.tsx` exports `generateMetadata()` and renders
  `app/landing-page.tsx`, which is the client landing surface it always was. This is the file the landing
  copy guards read; six tests were repointed at it in the same commit. `app/page.tsx` must stay a server
  component and a test says so: adding `"use client"` back does not fail the build, it drops
  `generateMetadata` and ships an empty head.
- `tests/metadata-contract.test.mjs` is the CI gate for SEO-005: it crawls the canonical-host sitemap and
  fails the build if any listed URL is not 200, or is missing a title, meta description, self-canonical,
  `og:title/description/type/url/site_name/image`, `twitter:card/title/description`, or exactly one H1. It
  now also holds the pages that are deliberately *out* of the sitemap to their own contract. The gate was
  mutation-checked on 2026-08-25 rather than assumed — see SEO-005 in Section 11. Since 2026-08-26 it
  genuinely covers the homepage: deleting `generateMetadata()` from `app/page.tsx` and rebuilding fails it
  with *https://ownword.pro/ is missing a usable `<title>`*. Before the split the same deletion changed
  nothing, because the root layout supplied the same values.
- `tests/page-quality-gate.test.mjs` is the CI gate for SEO-013, and `tests/discovery-privacy.test.mjs` is
  the discovery half of SEO-007. `scripts/seo-crawl.mts` (`npm run seo:crawl`) is the SEO-020 crawl pass
  itself, rerunnable against any build. All three are described in Sections 11.2 and 11.5.


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
| SEO-002 | P0 | Implement indexation matrix | Engineering + Security | SEO-001 | Done (repository) | Rendered tests prove the canonical-host public allow path, the off-host `noindex`/empty-sitemap default, `noindex, nofollow, nocache` with no canonical and no social card on all three private surfaces (`/signin`, `/history`, `/checkout/success`), and a genuine 404 that declares no canonical. No private URL appears in the sitemap. `tests/metadata-contract.test.mjs` re-checks every class each build. The 404 gap that held this at *Partial* is closed by `app/not-found.tsx`. Account and admin surfaces do not exist yet; robots.txt already disallows their paths. Since 2026-08-26 the root layout's metadata default is fail-closed rather than the homepage's identity, so a route that declares no metadata is `noindex` with no canonical instead of claiming to be `/`; and `/signin` is `Allow`ed so the `noindex` it carries can actually be read (finding F7). Live verification is owner action O-1. |
| SEO-003 | P0 | Implement canonical and redirect policy | Engineering | SEO-001 | Done (repository) / owner-verified live | Verified against the built Worker: `/`, `/privacy`, `/terms` self-canonicalize on the canonical host only; private surfaces and the 404 carry no canonical; off-host output fails closed; trailing slashes normalize in one hop (`/privacy/` -> 308 -> `/privacy`); and `www.ownword.pro` now 308s to the apex in one hop with path, query and method preserved, so `www` consolidates instead of leaking. 308 rather than 301 so a `POST` to `/api/*` cannot be silently downgraded to `GET`. **Not verifiable here:** that the deploy carrying the redirect is live, and that HTTP -> HTTPS is enforced at the Cloudflare edge. Both are owner action O-6. |
| SEO-004 | P0 | Generate XML sitemap and robots.txt | Engineering | SEO-002 | Done (repository) / owner-verified live | Canonical-host output lists exactly `/`, `/privacy`, `/terms`, each an existing 200 route drawn from `src/lib/public-pages.ts`; robots.txt references the sitemap; off-host output fails closed. `lastmod` is emitted only for `/privacy` and `/terms`, from the same constant those pages display, and a test fails if a sitemap date is not visible on its page; `/` tracks no material modification date and correctly omits `lastmod`. `/signin`, `/history` and `/checkout/success` are private and are proven absent. Both files read the shared host rule rather than a private copy, and their output is pinned on and off the canonical host. The `Disallow` list is now the exported `CRAWLER_DISALLOWED_PREFIXES` in `src/lib/public-pages.ts`, which lets `tests/page-quality-gate.test.mjs` fail the build if an indexable page ever links into a disallowed path. Live fetch of the two files is owner action O-1. |
| SEO-005 | P0 | Build reusable metadata API | Engineering + Copy | SEO-001 | Done (repository) | `src/lib/public-pages.ts` is the shared registry and holds both builders. **Adopted by every route that renders HTML**, `app/page.tsx` included since handoff H-1 closed on 2026-08-26: `app/layout.tsx`, `/`, `/privacy`, `/terms`, `app/sitemap.xml/route.ts`, `app/robots.txt/route.ts`, `app/not-found.tsx`, and the `/signin`, `/history`, `/checkout/success` layouts. The root layout's default is now `buildPrivateSurfaceMetadata()` rather than the homepage's own metadata, so a route that declares nothing is `noindex` with no canonical instead of inheriting `/`. **The gate is proven, not asserted:** on 2026-08-25 five deliberate mutations were each caught by `tests/metadata-contract.test.mjs` with a message naming the defect — removing `og:image` (*is missing og:image*), duplicating a description (*duplicates another page's meta description*), adding a second H1 (*must have exactly one H1, found 2*), registering a sitemap URL with no route (*does not return 200*), and dropping the canonical (*does not self-canonicalize*). On 2026-08-26 a sixth proved the gate now reaches the homepage: deleting `generateMetadata()` from `app/page.tsx` fails it with *https://ownword.pro/ is missing a usable `<title>`*, where before the split it changed nothing. Two structural regressions the field gate cannot see are held by source guards in the same file: the layout must not reach for `buildPublicPageMetadata` again, and `app/page.tsx` must not become a client component. |
| SEO-006 | P0 | Add truthful structured data | Engineering + SEO | SEO-001, pricing config | Done (repository) / owner-verified live | `Organization` + `WebSite` ship from `src/lib/site-structured-data.ts` **on the canonical host only**, and parse valid. Every property is verifiable from `src/config/product.ts`: brand name, `legalName` Bosphorus Elevate LLC, origin, support `ContactPoint`, `inLanguage`. `logo`, `sameAs`, `aggregateRating`, `foundingDate`, `address` and `SearchAction` are deliberately absent and a test fails if any appears. **The correction recorded on 2026-08-25 is now resolved rather than restated.** The homepage's `SoftwareApplication` block was *not* host-gated, because it rendered from the client component `app/page.tsx`; it moved into `site-structured-data.ts` with H-1 and is gated by the same host rule. A rendered test requires the entity and its `Offer` prices on `ownword.pro` and asserts their absence on `staging.ownword.pro`, `localhost` and `www.ownword.pro.example.com`. Finding F4 is closed. Remaining: live Rich Results validation, owner action O-4. |
| SEO-007 | P0 | Protect customer text from discovery/analytics | Security + Engineering | SEO-002 | Done (repository) | Closed against its own acceptance criteria, each with a named test. **URL:** `tests/discovery-privacy.test.mjs` walks every internal `href` on every route and fails if a query value exceeds 64 characters or contains whitespace; the only identifiers this application puts in a URL are a job UUID and a `return_to` path. **Metadata, sitemap, structured data:** `tests/metadata-contract.test.mjs` and `tests/rendered-html.test.mjs` — private surfaces carry no title claim, no description, no canonical, no social card, and no page-level entity. **Analytics:** `/api/events` allowlists property *names* and caps string values at 64 bytes server-side (`tests/events-api.test.mts`), and the new client-side guard fails the build if any `track()` call site sends a name the endpoint does not allow — so a call passing a draft cannot ship as a silent production 400. **Public cache:** every personalizable HTML route answers `no-store, must-revalidate`, asserted per route. **Unauthorized response:** `tests/history-access.test.mts`, `tests/result-access.test.mts` and `tests/sentence-operations.test.mts` hold every read, write and delete to the owner who made it, including the sentence endpoint that has no UI. The concern the previous pass left open — that `/history` renders a customer's own writing and must be authenticated on the server rather than merely `noindex` — is resolved by measurement: `/history` is a client component that fetches over an authenticated request, so its server HTML contains no customer text at all, on any host, which the crawl sweeps for directly. **Not in these criteria, and not claimed here:** server-side logging and retention, which are `docs/SECURITY.md`'s. |
| SEO-008 | P0 | Establish performance budgets | Engineering + Design | Core UI | Open | Not verified in any of the three QA passes, and not verifiable from this repository: Core Web Vitals need field data or a Lighthouse run against a live host this session cannot reach. Owner action O-8. The budgets themselves are stated in Section 6; what is missing is a measurement, not a target. Not attemptable by an agent here — a rendered-HTML parse cannot produce an LCP. |
| SEO-009 | P0 | Verify search-engine consoles | SEO + Hosting (owner action) | Live deployment | Partial (owner-reported; steps 1-4 and 7 done, 5-6 and 8 open) | **Owner-reported, not verified by any agent:** Google Search Console is connected for `ownword.pro`, the sitemap is submitted, and Bing Webmaster Tools verification is complete. **Verified from the repository:** the `msvalidate.01` token is present and ungated in `app/layout.tsx` (it renders on every host, including off-canonical, which is deliberate so a Bing fetch through any hostname still finds it), and the canonical-host sitemap serves exactly the three apex URLs with `lastmod` on `/privacy` and `/terms`. **No agent in this project can reach GSC, Bing, or the live host** — outbound to `ownword.pro` is blocked from the sandbox — so nothing below the repository line is evidence. Still open and owner-only: live URL Inspection on `/`, `/privacy`, `/terms` for *Indexing allowed = Yes* and the expected canonical (step 5); re-check `www` now that the 308 has shipped (step 6); record the console-reported URL counts and the Rich Results result here (step 8). |
| SEO-010 | P0 | Connect organic funnel attribution | Analytics + Engineering | Existing events | Open | Not attemptable from this repository, and re-confirmed 2026-08-26. Funnel events exist and are well shaped: twelve `track()` call sites, an allowlisted event vocabulary, and content-free properties (now guarded on both sides, see SEO-007). But `app/api/events/route.ts` validates each event and **returns 204 without forwarding or storing it** — provider forwarding is deliberately deferred until a privacy-reviewed destination is configured — so there is nothing to join. Closing this needs a chosen analytics destination *and* a Search Console export, neither of which an agent here can reach. |
| SEO-011 | P0 | Write responsible claims standard | Legal + Copy + SEO | Product brief | Open | Guardrails are stated in this document, `PRODUCT.md`, and `README.md`, but there is no single Legal-approved allowed/forbidden claims list. **Not an agent's to close: the missing artefact is an approval, not a document.** SEO-013's claims check is a mechanical floor under it — it fails nine claim *shapes* on every build — and Section 11.5 says what that floor does not reach. The floor is worth having while the standard is drafted; it is not the standard. |
| SEO-012 | P0 | Publish trust proof modules | Humanization + Copy | Benchmark evidence | Open | No `/trust/*` pages exist; the homepage carries inline trust copy only. **Evidence-blocked, not writing-blocked, and re-confirmed 2026-08-26:** a trust module has to present a measured result, and the deployed engine is the deterministic substitution baseline (`HUMANIZATION_PROVIDER` unset, `resolveHumanizationProvider()` fails closed). Benchmarks run against it measure a substitution table, not a product claim. Same reasoning as H-6 and SEO-017/018. |
| SEO-013 | P1 | Create page-template quality gate | SEO + Engineering | SEO-005 | Done (repository) | `tests/page-quality-gate.test.mjs` runs the template against every page in `PUBLIC_PAGES` on every build, and the registry now carries the fields it checks, so a page cannot be registered without declaring them. Enforced mechanically: one distinct declared `intent` per page (>= 40 characters, unique — two pages that cannot state different intents are one page); an accountable `contentOwner` role; a `primaryCta` that is actually rendered as a link or button with that label and href; a `lastModified` the page shows a reader, and no displayed date the sitemap does not claim; at least one link to another indexable page; no link into a path robots.txt disallows; nine forbidden claim *shapes* (guaranteed detector or Turnitin outcome, star rating, customer count, unevidenced percentage, ranking claim, superlative market claim, a free trial that does not exist), negation-aware so the required disclaimer on `/terms` is not mistaken for the promise it disclaims; and the static half of accessibility — `lang`, exactly one non-empty H1, no skipped heading level, a `<main>` landmark, `alt` on every image, a name on every link and inline SVG, a label on every form control, and no native `disabled` on a focusable control. Canonical and off-host `noindex` are re-checked from the registry side. Every rule was mutated and confirmed to fail before being kept. **What it cannot check is listed in Section 11.5 rather than implied to be covered:** whether evidence is original, whether a well-shaped claim is true, author identity, analytics coverage, and the dynamic half of accessibility. |
| SEO-014 | P1 | Launch AI Writing Pattern Diagnostic | Humanization + Engineering | Privacy review | Open | Tool analyzes stated patterns, does not infer authorship probability, stores no text by default, has an accessible explanation and useful empty/error states |
| SEO-015 | P1 | Publish field guide | SEO + Copy | SEO-014 | Open | Contains >=12 original annotated examples, counterexamples, source/method notes, stable anchors, and links to the live diagnostic |
| SEO-016 | P1 | Publish benchmark methodology/results | Humanization + SEO | Benchmark V1 | Open | Page documents corpus, metrics, versions/dates, aggregate results, failures, limitations, provenance, changelog, and downloadable data where licensed |
| SEO-017 | P1 | Publish Academic mode page | SEO + Legal + Copy | SEO-011, real examples | Open (evidence-blocked) | Distinct academic workflow/example, citation protection proof, visible integrity notice, and zero evasion claims. Blocked on evidence, not on writing: see the note under SEO-018. |
| SEO-018 | P1 | Publish Professional mode page | SEO + Copy | Real examples | Open (evidence-blocked) | Distinct business workflow/example, factual/terminology proof, and product start CTA; not duplicated from core page. **Deliberately not built in the 2026-08-25 pass.** The deployed engine is a deterministic demo baseline: `src/lib/humanization/deterministic-provider.ts` distinguishes Professional from the other modes by exactly three regular-expression substitutions layered on a shared table. A page claiming a distinct professional workflow, or mode-specific quality, would state something the product cannot do today, which Section 1 forbids outright. Build it when the mode genuinely differs and a real annotated before/after exists. |
| SEO-019 | P1 | Publish meaning-preservation checklist | Humanization + SEO | SEO-012 | Open | Web and accessible downloadable versions cover all protected claim classes, cite methodology, and contain no customer text |
| SEO-020 | P1 | Run crawl/render QA | QA + SEO | SEO-002..008 | Partial | Third pass completed 2026-08-26 and it is now a program, not a paragraph: `scripts/seo-crawl.mts` (`npm run seo:crawl`) renders every route the application serves out of the built Worker on four hosts and reports. Recorded in Section 11.2. Of the five findings from the second pass, F4 (un-host-gated `SoftwareApplication`) is now fixed, and F3 (no H1 on the three private surfaces) was fixed on 2026-08-27 by the auth-surface design pass and is pinned by a test. Two new: F6, a genuine 404 emits no `cache-control` at all — the only HTML response that does — which is ENG-owned and carries no personalization; and F7, `/signin` was `Disallow`ed while `/` linked to it, the one shape that gets indexed URL-only, now fixed by letting the crawler read its `noindex`. Zero orphan indexable pages, zero broken internal links, valid JSON-LD everywhere it is emitted, `og:image` resolves, and no customer text or session identity in any crawlable surface on any host. Held at *Partial* because F6 is real and open, and because performance (SEO-008) still needs a live host this session cannot reach. F3 closed 2026-08-27. |
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
- The 2026-08-26 pass changed two things a console will see: `/signin` left the robots.txt `Disallow` list
  (finding F7), and the homepage's `SoftwareApplication` JSON-LD is now emitted on the canonical host only
  (finding F4). Both are repository state, not deployed state. Step 1 will show whether the deploy carrying
  them has run: on the live host robots.txt should no longer contain a `Disallow: /signin` line.

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

### 11.2 Crawl and render QA pass (SEO-020, third pass 2026-08-26)

**Method, and it is now reproducible.** The pass is `scripts/seo-crawl.mts`, run as `npm run seo:crawl`
after `npm run build`. It renders every route the application serves out of the built Worker
(`dist/server/index.js`), parses status, title, description, canonical, robots, OG/Twitter tags, heading
outline, JSON-LD validity, internal links and cache headers, follows every redirect one hop, resolves every
internal link and the `og:image`, sweeps every route for a rendered session identity or a stray address, and
prints a findings list. Four host profiles: the canonical host (`ownword.pro`), `www.ownword.pro`,
`staging.ownword.pro` and `localhost:5173`. Routes covered: `/`, `/privacy`, `/terms`, `/signin`,
`/history`, `/checkout/success?job=...`, `/robots.txt`, `/sitemap.xml`, the trailing-slash variants
`/privacy/`, `/terms/`, `/history/`, and three unknown paths (`/this-page-does-not-exist`, `/result/abc`,
`/guides/not-written-yet`).

The static-asset binding is backed by the real `dist/client` output rather than a stub that answers 404,
because a stub makes every `<link href="/icon.svg">` and the `og:image` look broken and produces findings
nobody can act on. The second pass's paragraph is superseded by the program; run it rather than trusting
this section's age.

**This is a rendered-HTML pass, not a live-site pass.** Outbound to `ownword.pro` is blocked from this
sandbox. Nothing here is an observation of production; every statement is about the code in this repository
as built. The live equivalents are owner actions O-1 and O-6.

#### Findings

| # | Finding | Severity | State |
|---|---|---|---|
| F1 | A genuine 404 emitted `<link rel="canonical" href="https://ownword.pro">` along with the homepage title, description and social card. A canonical asserts that two URLs are the same page; a missing URL is not the homepage, and repeated across every stale link that is how a 404 gets folded into `/`. | High | **Fixed** — `app/not-found.tsx` |
| F2 | `/signin`, `/history` and `/checkout/success` inherited the homepage's meta description and its whole Open Graph and Twitter card from the root layout, including `og:url` pointing at `https://ownword.pro`. A private URL pasted into a chat unfurled as the homepage. `/checkout/success` also wore the homepage `<title>` verbatim. | Medium | **Fixed** — `buildPrivateSurfaceMetadata()` |
| F3 | `/signin`, `/history` and `/checkout/success` rendered **zero** `<h1>` elements, each opening with an `<h2>` inside `<main>`. Not an indexing problem (all three are `noindex`), but Section 6 requires one H1 per page for the document outline, and screen-reader users navigating by heading level found no top-level heading. | Low | **Fixed 2026-08-27** by the auth-surface design pass. Each page now renders exactly one `<h1>` naming its state, pinned by `tests/private-surface-quality.test.mjs`, which was verified to fail when a second H1 is added. |
| F4 | The homepage's `SoftwareApplication` JSON-LD, `Offer` block included, was emitted on **every** host — it rendered from `app/page.tsx`, a client component that cannot read the request `Host`. `Organization` and `WebSite` were correctly gated. Nothing was indexed off-host (those pages are `noindex`), but SEO-006's gating claim did not hold for this block. | Low | **Fixed** — H-1 split the route; the block now lives in `src/lib/site-structured-data.ts` behind the same host rule, with a test requiring it on `ownword.pro` and asserting its absence on three off-canonical hosts |
| F5 | `www.ownword.pro` was a bound custom domain serving the entire application with no redirect. Fail-closed (`Disallow: /`, `noindex`), so nothing duplicate was ever indexed, but nothing consolidated either: a link or share on a `www` URL earned the apex nothing. | Medium | **Fixed in code** — 308 in `worker/index.ts`; live state unverified (O-6) |
| F6 | A genuine 404 emits **no `cache-control` header at all** — the only HTML response in the application that does not. Every 200 HTML route answers `no-store, must-revalidate`. RFC 9111 lets a shared cache apply heuristic freshness to a 404 with no explicit directive, so a 404 can outlive the URL becoming a real page. It carries no personalization, so this is a staleness risk rather than a disclosure risk. The header comes from the framework's error path, not from application code. | Low | **Open** — ENG-owned. `tests/discovery-privacy.test.mjs` excludes the 404 from its shared-cache assertion and says why, so the exclusion is a record rather than a silence |
| F7 | `/signin` was `Disallow`ed in robots.txt *and* linked from the header of `/`, the site's most indexable page. That combination — invited by a link, refused by robots.txt — is precisely the shape Google indexes URL-only: the crawler is not allowed to fetch the page, so the page's own `noindex` is never read and cannot object. `/history` already took the opposite side of this trade for exactly this reason. Unlike `/checkout/success`, which is reached only through a Stripe redirect and linked from nowhere, `/signin` has an inbound internal link. | Medium | **Fixed** — `/signin` left the `Disallow` list and keeps `noindex, nofollow, nocache`, so the instruction that actually removes it can be read. `tests/page-quality-gate.test.mjs` now fails the build if any indexable page links into a disallowed path |

**F3 is closed as of 2026-08-27.** The auth-surface design pass gave `/signin`, `/history` and
`/checkout/success` one `<h1>` each, naming the page's state, and `tests/private-surface-quality.test.mjs`
now fails if any of them loses it or gains a second. The original finding read: the heading is visible
copy in files SEO does not own, and the fix is a one-element change per page.

Findings fixed in earlier passes and re-confirmed still fixed: the malformed `nonocache` robots directive;
the `/history` and `/checkout/success` canonical conflict; sitemap/registry drift; the three dead
`/signin-with-chatgpt` links (now `/signin`, which exists and returns 200); the 404 inheriting the homepage
canonical; and the private surfaces inheriting the homepage description and social card. The **cause** of
those last two — the root layout broadcasting the homepage's identity as the site-wide default — was fixed
in this pass rather than patched again at the page.

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
  JSON-LD payload on any route, on any host. The crawl also sweeps every route's server HTML for a rendered
  session identity and for any address that is not the published support one, and finds neither. **The
  account indicator that shipped on `/`, `/history` and `/checkout/success` does not change this**, and that
  was checked rather than assumed: `src/components/account-indicator.tsx` resolves the session with a client
  fetch to `/api/auth/session` and renders its `signedOut` fallback until that answers, so nothing an
  unauthenticated crawler receives has ever been through the session lookup. `tests/discovery-privacy.test.mjs`
  pins it.
- **Cache.** Every personalizable HTML route answers `no-store, must-revalidate`, so no shared cache can
  retain a signed-in render. The one exception is the 404 (finding F6), which is not personalizable.
- **Social card.** `og:image` resolves to a 200 on the canonical host, at the declared dimensions.

#### Known and accepted

- **A 404 carries two `robots` meta tags.** The framework emits its own `<meta name="robots"
  content="noindex">` and `app/not-found.tsx` adds `noindex, nofollow, nocache`. Crawlers combine multiple
  robots tags and apply the most restrictive; both say `noindex`, so the combined directive is correct. The
  framework's tag cannot be suppressed from application code. A test asserts every robots tag on a 404 says
  `noindex`, so a future framework change that emitted `index` would fail the build.
- **`/checkout/success` is both `Disallow`ed and `noindex`.** A crawler forbidden to fetch a page cannot read
  its `noindex`, so the URL could in principle be indexed URL-only from an external link. It is reached only
  through a Stripe redirect and is linked from nowhere, so `Disallow` is the stronger posture here.
  `/history` and, since finding F7, `/signin` take the opposite trade deliberately: both stay crawlable so
  their `noindex` is readable, because both are reachable by a link. Only `/history/` below the list is
  disallowed. The rule that decides it: **a path may be `Disallow`ed only if no indexable page links to it**,
  and `tests/page-quality-gate.test.mjs` now enforces exactly that.
- **A 404 still emits the site-level `Organization`/`WebSite` graph** from the root layout. That graph
  describes the site, not the page, and is valid on any URL of the site.

#### Not covered by this pass

Core Web Vitals and the performance budgets (SEO-008). They need field data or a Lighthouse run against the
live host, not a rendered-HTML parse, and this session cannot reach it. Owner action O-8.

Anything that requires the live deploy rather than this build: that the deploy carrying the `www` 308 is
live (O-6), what the consoles report (O-2, O-3, O-5), and Rich Results validation (O-4).

#### One observation outside SEO's scope, recorded so it is not lost

`ANALYTICS_EVENTS` in `src/lib/analytics.ts` declares `subscription_cancelled`, and the allowlist in
`app/api/events/route.ts` does not include it. Nothing calls it today, so nothing is broken; the first
caller would get a silent 400. That is analytics' drift to close (it touches SEO-010's funnel), not SEO's,
and it is noted here rather than fixed because the fix is a judgement about which list is authoritative.

### 11.3 Handoffs — work SEO deliberately did not do

Statuses below are as of 2026-08-26 (third pass). H-1, H-2, H-3 and H-4 are **done**; they are kept here
with what was actually built, because the acceptance criteria in Sections 11 and 6 point at them.

- **H-1 — Adopt the shared metadata helper in `app/page.tsx`. Done 2026-08-26.** The route is split.
  `app/page.tsx` is a server component that exports `generateMetadata()` and renders
  `app/landing-page.tsx`, which holds the client landing surface unchanged apart from its name and the
  JSON-LD block that left with it.

  The reason it could not be done as originally written still stands and is now guarded: a `"use client"`
  file cannot own route metadata, and adding `generateMetadata` to one does **not** fail the build — it
  silently empties the head. Title, description, canonical, robots, Open Graph and Twitter all disappear from
  the rendered HTML. `tests/metadata-contract.test.mjs` now fails if `app/page.tsx` ever regains
  `"use client"`, because that regression ships rather than breaking the build.

  **What it bought, since the homepage's rendered metadata is unchanged by design:**

  1. The root layout stopped broadcasting the homepage's identity as the site-wide default. That was the
     *cause* of the 404 canonical (F1) and the private-surface social cards (F2), both of which the previous
     pass could only patch at the page. `app/layout.tsx` is now fail-closed: a name for the tab, the icon,
     the Bing token, `noindex`, no canonical.
  2. The `SoftwareApplication` JSON-LD became host-gateable, and is now gated. Finding F4 is closed.
  3. The CI field gate genuinely covers the homepage. Proven: deleting `generateMetadata()` from
     `app/page.tsx` and rebuilding fails `tests/metadata-contract.test.mjs` with *https://ownword.pro/ is
     missing a usable `<title>`*. Before the split the same deletion changed nothing, because the layout
     supplied the same values — the homepage was passing the gate on the layout's merit, not its own.

  **The six source-reading guards, relocated and each re-proven.** The previous pass named five and declined
  to move them without moving the copy; a sixth turned up in `tests/security-blockers.test.mts`. All six read
  the landing page as *source text*, so pointing them at a route file with nothing in it would have left six
  green tests guarding nothing. Each was repointed at `app/landing-page.tsx` and then broken on purpose to
  confirm it still bites:

  | Guard | Mutation applied to `app/landing-page.tsx` | Message it failed with |
  |---|---|---|
  | Centralized copy (`tests/rendered-html.test.mjs`) | hardcoded `$9.99/month` next to the wordmark | assertion on `/\$9(\.99)?\/month/` |
  | Em-dash ban (same test) | an em dash in a code comment | *landing copy uses sentence punctuation instead of em or en dashes* |
  | ACT-12 / ACT-16 (`tests/landing-activation.test.mts`) | dropped `source: "sample"` from the one-click sample call | *did not match `/humanize\(\{ draft: SAMPLE_TEXT, source: "sample" \}\)/`* |
  | ACT-09 (`tests/activation-blockers.test.mts`) | turned the "Cancel anytime" `Link` into a `span` | *the hero claim must link to the portal, wherever it lives* |
  | ACT-10 (same test) | replaced the per-plan disclosure map with a single plan's terms | *did not match the `purchasablePlans.map(...)` disclosure* |
  | SEC-17 (`tests/security-blockers.test.mts`) | removed `<AccountIndicator`| *../app/landing-page.tsx must show which account is signed in* |

  The em-dash guard now scans `app/page.tsx` as well as `app/landing-page.tsx`, so copy that migrates back up
  into the route file is still covered. `tests/e2e/helpers/harness.mts`, `docs/BRAND.md`, `docs/MEMORY.md`,
  `docs/QA.md` and `docs/SIGNED-IN.md` were corrected where they named the old path.
  **`docs/SECURITY.md` was deliberately not touched** — another agent was live in it — so its references to
  `app/page.tsx` as the landing surface now point at the wrong file and need a one-line correction from
  whoever owns that pass. Its findings are unaffected: the code moved, it did not change.

- **H-2 — Adopt the shared host rule in `app/robots.txt/route.ts`. Done.** The route's private
  `configuredSiteUrl()` and its own host normalization are gone; it now uses `canonicalOrigin()`,
  `isCanonicalHost()` and `normalizeHost()` from `src/lib/public-pages.ts`. Output is unchanged on and off
  the canonical host, and `tests/rendered-html.test.mjs` now pins both: the full `Allow`/`Disallow`/`Sitemap`
  set on `ownword.pro`, and a bare `Disallow: /` with no `Sitemap:` line on three off-canonical hosts.
  `Disallow: /history/` still does not cover `/history` itself, which remains intentional and is asserted as
  such — a `noindex` a crawler may not fetch is a `noindex` it never reads. `/signin` was in the `Disallow`
  list when H-2 closed; the third crawl pass took it out for the same reason (finding F7), and the list is
  now the exported `CRAWLER_DISALLOWED_PREFIXES` in `src/lib/public-pages.ts` so a single test can hold the
  rule that decides membership: a path may be disallowed only if no indexable page links to it.

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
  Declined a third time, and re-verified rather than carried forward. `src/lib/humanization/deterministic-provider.ts`
  still distinguishes Professional from the other modes by exactly three regular-expression substitutions
  (`a lot of` -> `many`, `kind of` -> `somewhat`, `get the ball rolling` -> `begin`) layered on a shared
  table; Academic and Casual are three each on the same table. A mode page (SEO-017, SEO-018) would have to
  describe a distinct workflow and mode-specific quality, which is something the engine cannot do, and
  Section 1 forbids stating it outright.

  **The Claude provider merging does not change this, and it was checked.** `resolveHumanizationProvider()`
  in `src/lib/humanization/provider-config.ts` fails closed to `deterministic` when
  `HUMANIZATION_PROVIDER` is unset, unknown, or set to `claude` without a key — and it is unset. The
  deployed engine is still the substitution baseline. When a model provider is actually selected *and* a
  real annotated before/after exists per mode, the decision is worth reopening; until then a mode page is
  a claim with nothing behind it.

  `/how-it-works` and `/pricing` remain near-duplicates of existing homepage sections and fail Section 3's
  60%-different rule. **This is not a backlog item waiting for writing time; it is waiting for evidence.**
  The first new page worth building is one carrying evidence the product can actually back: the pattern
  diagnostic (SEO-014) or the benchmark results (SEO-016).

  A related copy constraint, recorded so nobody trips on it: sentence regeneration shipped server-side with
  **no customer-facing UI**. Do not write page copy, metadata, or structured data implying a customer can
  edit or regenerate an individual sentence today.

- **H-7 — Give the three private surfaces a top-level heading. Still open, DESIGN/COPY-owned.** `/signin`,
  `/history` and `/checkout/success` render zero `<h1>`; each opens with an `<h2>` inside `<main>` (finding
  F3). Section 6 requires one clear H1 per page, and a screen-reader user navigating by heading level finds
  no top-level heading on any of them. The fix is a one-element change per page, but the heading is visible
  copy and those files are DESIGN's, so SEO did not make it. Note that the metadata gate in
  `tests/metadata-contract.test.mjs` enforces exactly-one-H1 only for **sitemap** URLs, and
  `tests/page-quality-gate.test.mjs` only for **registered public** pages; if these three pages get an H1,
  extend the private-surface test to hold them to it too. Re-measured on 2026-08-26 across all four host
  profiles and unchanged. `npm run seo:crawl` reports it, so it will not go quiet.

- **H-8 — Give a genuine 404 an explicit `cache-control`. New, ENG-owned.** Finding F6. It is the only HTML
  response in the application with no cache directive at all, so a shared cache may apply heuristic
  freshness and keep serving a 404 after the URL becomes a real page. The header on the 200 routes comes
  from the framework's dynamic-render path, and the 404 does not go through it, so the fix belongs wherever
  `worker/index.ts` finishes a response rather than in `app/not-found.tsx`. `no-store` or a short
  `max-age` are both defensible; the choice is ENG's. `tests/discovery-privacy.test.mjs` carries the
  exclusion and the reason, so closing this means deleting one `continue` and watching the test pass.

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

### 11.5 What the page quality gate does not check (SEO-013)

`tests/page-quality-gate.test.mjs` is real and enforced, and it is not the whole template. Section 6's
release gate lists ten things; a build can check some of them and cannot check the rest. Recording which is
which is the point — a gate that quietly implies coverage it does not have is worse than no gate, because
it retires the human review that was actually doing the work.

**Enforced on every build**, and each rule was mutated and confirmed to fail before it was kept: one
distinct declared intent per page; an accountable owner role; a rendered primary conversion action matching
what the registry declares; a modification date the page shows a reader; at least one link to another
indexable page; no link into a path robots.txt disallows; nine forbidden claim *shapes*; the static half of
accessibility; canonical and off-host `noindex` from the registry side. Sitemap membership, status codes,
titles, descriptions and social cards are enforced separately by `tests/metadata-contract.test.mjs`.

**Not enforced, and not claimable from a test run:**

- **Whether the evidence is original.** Section 7 requires at least one original contribution per guide —
  a benchmark result, an annotated example, a dataset, a first-party observation. A test can see that a
  page has a `<table>`; it cannot see whether the numbers in it were measured. This stays a human review.
- **Whether a well-shaped claim is true.** The claims check tests *shape*: it fails a star rating, a
  customer count, an unevidenced percentage, a guaranteed detector outcome. A sentence that is false but
  phrased plainly passes it. It is a floor, not a review, and SEO-011's Legal-approved allowed/forbidden
  list is still the thing that would raise the ceiling.
- **Author and reviewer identity.** The registry declares an accountable *role*, not a person. This
  repository has no author identities to cite, and inventing one is the fabricated expert identity Section 1
  forbids. When a real named author and reviewer exist, add them to the registry and the gate can hold them.
- **Analytics coverage.** `tests/discovery-privacy.test.mjs` proves no analytics call carries writing. It
  does not prove a page's conversion path is *instrumented* — nothing can, until SEO-010 has a destination
  to check against. `/api/events` currently validates and discards every event.
- **The dynamic half of accessibility.** Contrast ratios, focus order, focus visibility, live-region
  announcements, and how any of it behaves under a real screen reader. Static HTML parsing reaches none of
  it. The nearest available evidence is `tests/e2e/**`, and an audit against the live host remains unowned.
- **Performance.** SEO-008 needs field data or a Lighthouse run against a host this repository cannot
  reach. Owner action O-8.

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
| `billingEnabled` is `true` and a priced `Offer` is emitted before any purchase has been evidenced | The markup truthfully reflects the configured catalog and the visible price, but a crawler-visible `Offer` implies a purchase path nobody has yet watched a customer walk to the end. The `SoftwareApplication` block carrying it is now emitted on the canonical host only (finding F4, fixed 2026-08-26), so the exposure is bounded to the one host where the offer is real | Keep checkout readiness fail-closed; re-validate the live catalog, Stripe binding, and visible price before any acquisition spend; owner action O-7 remains the only thing that closes the gap between a published `Offer` and an observed purchase |
| `/privacy` and `/terms` contain substantive terms but are explicitly not counsel-approved | Complete-looking draft language can be mistaken for legal release approval | Treat M4-03 as a release blocker; LEGAL must approve processor, retention/deletion, subscription, cancellation/refund, and prohibited-claim disclosures before real customer charges |

## 14. Reference policy baseline

- [Google: Optimizing for generative AI features](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [Google: Spam policies, including link spam and scaled content abuse](https://developers.google.com/search/docs/essentials/spam-policies)
- [Google: Guidance on AI-generated content](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content)
- [Google: SoftwareApplication structured data](https://developers.google.com/search/docs/appearance/structured-data/software-app)
- [FTC: Disclosures 101 for social media influencers](https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers)

Review this baseline quarterly and whenever Search Console, Google Search Central, Bing Webmaster, or applicable advertising/endorsement rules materially change.
