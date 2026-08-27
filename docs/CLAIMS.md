# Ownword responsible claims standard

**Status: APPROVED 2026-08-27, on the product owner's attestation that counsel reviewed this document and
approved it unchanged.** The reviewing counsel is not named in this record, so the strength of this approval
rests on that attestation rather than on a signature held here. If a named record is ever needed, capture it
in Section 7 rather than restating this line.

**Drafted by:** SEO/GEO Agent, 2026-08-27
**Approval owner:** Legal (Bosphorus Elevate LLC)
**Backlog item:** SEO-011 (`docs/SEO.md` Section 11)
**Enforcement floor:** `tests/page-quality-gate.test.mjs`
**Sync guard:** `tests/claims-standard.test.mjs`

## 0. What this document is, and what it is not

SEO-011 asks for a single allowed/forbidden claims list. Until 2026-08-27 the guardrails existed, but
scattered: `docs/SEO.md` Section 1, `docs/ACTIVATION.md`'s rejected tactics, `docs/MONETIZATION.md`'s
dark-pattern list, `docs/PRODUCT.md`, `README.md`, and nine regular expressions in a test file. Six places
is not a standard. Anyone writing a sentence for a customer had to know all six existed.

This is the one list, assembled from those six sources plus what the code in this repository can actually
be shown to do. **Nothing in it is new policy.** Every rule below is traceable to a source already in the
repository, and each is cited.

**It is a draft.** SEO-011's acceptance is a Legal-approved list; a document an agent wrote is not an
approval, and no amount of care turns it into one. What this draft removes is the excuse that there was
nothing to approve. What it does not remove is the approval. SEO-011 stays short of Done until Legal has
reviewed this file and said so in Section 7.

Use it in the meantime. A floor that has not been signed is still a floor.

## 1. The claim test

Before a sentence about the product ships anywhere a customer can read it — a page, a `<meta>`
description, a JSON-LD property, an email, a pricing card, an error message, a social post — it must pass
all four:

1. **Point at it.** Name the file, config value, dated measurement, or policy document that makes the
   sentence true. "It is obviously true" is not a citation. If the answer is a person's confidence, the
   sentence does not ship.
2. **Would it survive the opposite reading?** Ask what a customer who believed the sentence literally would
   expect, then check the product delivers exactly that. "Protects your citations" survives. "Protects your
   meaning" does not, unqualified — see 2.2.
3. **Is it still true off the happy path?** A claim that holds only when the engine succeeds is a claim
   about a subset. Either bound it or drop it.
4. **Does it survive a provider swap?** `HUMANIZATION_PROVIDER` selects the rewrite engine at runtime and
   is currently unset, which fails closed to the deterministic substitution baseline
   (`src/lib/humanization/provider-config.ts`). A sentence that is only true of one provider must not be
   written as a property of the product.

Test 4 is the one this repository fails most often, and it is why the mode pages (SEO-017, SEO-018) and
the trust modules (SEO-012) have been declined four times.

## 2. Allowed claim shapes

Each shape below is permitted **only** with the evidence named beside it. The shape being on this list is
not permission to use it about something else.

### 2.1 Capability statements about behavior the code performs

Allowed when the behavior is implemented and reachable in the deployed path, stated without a quality
adjective.

- **Licensed by:** the module that implements it. Protected-content classes are enumerated in
  `src/lib/humanization/protected-content.ts` and typed in `src/lib/humanization/types.ts`; the pipeline
  extracts them on every request (`src/lib/humanization/pipeline.ts`).
- **Allowed:** "Citations, quotations, numbers, percentages, currency amounts, dates, URLs, DOIs, code
  spans, named people and companies, and technical terms are extracted before the rewrite and checked
  again afterwards."
- **Forbidden by the same rule:** "never loses a citation." The extractor is a set of patterns; patterns
  miss. See 3.2.
- **Also forbidden:** any capability statement about a surface that has no UI. Sentence regeneration ships
  server-side with no customer-facing control (`docs/SEO.md` H-6). Copy must not imply a customer can edit
  or regenerate an individual sentence today.

### 2.2 Mechanism statements

Allowed when the mechanism runs on every request and its failure mode is stated.

- **Licensed by:** `src/lib/humanization/pipeline.ts` and
  `src/lib/humanization/verification.ts` — every candidate is verified against the original, and a
  candidate that fails is resampled or refused rather than returned.
- **Allowed:** "Every rewrite is compared against your original before you see it, and a rewrite that
  fails the comparison is not returned."
- **Forbidden:** "guarantees your meaning is preserved." The verifier is a deterministic scorer with
  thresholds, not a proof. It is a check, and a check that passes is not a warranty. Say what the check
  does; do not promote it to an outcome.

### 2.3 Configured product and commercial facts

Allowed when the value is read from the centralized config at render time, never typed into copy.

- **Licensed by:** `src/config/pricing.ts` (prices, intervals, currency, word allowances, plan names,
  delivered vs planned features) and `src/config/product.ts` (product name, domain, operator legal name,
  support address).
- **Allowed:** the price, the billing interval, the monthly word allowance, the plan name, the operating
  company, the support address.
- **Enforced:** `tests/rendered-html.test.mjs` fails the build on a hardcoded dollar amount in the landing
  copy; `tests/price-integrity.test.mts` holds the advertised price to the live Stripe price before a
  Checkout Session is created.
- **Forbidden:** a price, allowance, or plan name written as a literal anywhere a customer can read it.

### 2.4 First-party measurements

Allowed only with all five of: the corpus, the metric definition, the engine version and date, the
aggregate result, and the failures. Publish the limitations in the same view as the number.

- **Licensed by:** a dated benchmark artifact. `docs/BENCHMARKS.md` and `benchmarks/` are the intended
  home.
- **State of play, 2026-08-27:** there is **no publishable measurement**. `HUMANIZATION_PROVIDER` is unset,
  so benchmarks run against the deterministic substitution baseline and measure a substitution table
  rather than the product. Any number produced today describes a demo, and publishing it as a product
  result would be the fabricated-precision failure this standard exists to prevent.
- **Therefore:** every percentage, score, rate, and "x% better" is forbidden today under 3.1, and stays
  forbidden until a measurement against the shipped engine exists.

### 2.5 Limitation and disclaimer statements

Not merely allowed — **required** on any surface that describes rewriting quality, academic use, or
detector behavior.

- **Licensed by:** `docs/SEO.md` Section 1 and Section 5's proof hierarchy.
- **Required shape:** "Ownword does not guarantee that any AI-detection tool will fail to flag rewritten
  text. You remain responsible for your work and for the policies that apply to it."
- **Note for the enforcement floor:** this required sentence and the forbidden promise it disclaims read
  almost identically to a regular expression. The gate is negation-aware for exactly this reason
  (`NEGATED` in `tests/page-quality-gate.test.mjs`). Do not "fix" a disclaimer to get past a false
  positive without checking which side of the negation you are on.

### 2.6 Roadmap statements

Allowed only inside the roadmap treatment, never in the delivered-features list.

- **Licensed by:** `docs/MONETIZATION.md`'s roadmap-honesty rule and `pricingConfig.plannedFeatures`.
- **Required:** the status word comes first as real text ("Planned"), never carried by colour or shape
  alone; no included-marker on a roadmap row; the delivered features are stated once, above both cards.
- **Forbidden:** any status word that implies a date. "Coming soon" is forbidden by name — these
  capabilities are deferred past V1 with no agreed schedule, and someone who bought Pro because a
  capability read as weeks away is a refund conversation.
- **Forbidden:** a `features` entry carrying a "coming later" qualifier. A capability moves into
  `features` only once it ships.
- **Enforced:** `tests/pro-plan.test.mts` on the catalog, `tests/rendered-html.test.mjs` on the rendered
  HTML.

### 2.7 Comparative statements

Allowed only against a named, dated, reproducible corpus, with the relationship to the compared product
disclosed and a correction route on the page.

- **Licensed by:** `docs/SEO.md` SEO-022's acceptance criteria.
- **State of play, 2026-08-27:** no firsthand test corpus exists, so **no comparison may be published**,
  including implicit ones. "Unlike other tools" is a comparison.

### 2.8 Policy and process statements

Allowed when the policy is implemented and the implementation is tested.

- **Licensed by:** `src/config/retention.ts`, `src/lib/purge-worker.ts`, `/privacy`, `/terms`, and the
  access-control tests (`tests/history-access.test.mts`, `tests/result-access.test.mts`,
  `tests/sentence-operations.test.mts`).
- **Allowed:** the retention window, the deletion path, who can read a rewrite, what analytics carries.
- **Forbidden:** a security or privacy claim whose only support is intent. If nothing enforces it, it is a
  plan, and plans are 2.6.

## 3. Forbidden claim shapes

### 3.1 The machine-enforced floor

These are the shapes `tests/page-quality-gate.test.mjs` fails on every build, across every page in the
public registry. Nine regular expressions, seven distinct shapes. The labels below are the exact strings
the gate reports, and `tests/claims-standard.test.mjs` fails the build if this list and the gate ever
disagree in either direction — a shape added to the gate and not documented here, or documented here and
quietly dropped from the gate.

<!-- enforced-shapes:start -->

| Enforced shape | Why it is forbidden here |
|---|---|
| `a guaranteed detector or Turnitin outcome` | `docs/SEO.md` Section 1's first guardrail, and `docs/ACTIVATION.md`'s first rejected tactic. Ownword cannot observe another vendor's classifier, so the claim is unknowable as well as unwise. |
| `a star rating` | No ratings exist. Marking up a rating absent from the visible page is also a Google structured-data spam violation (`src/lib/site-structured-data.ts`). |
| `a customer count` | No customer count is published or auditable. "Trusted by 10,000 writers" is the fabricated-testimonial failure in numeric form. |
| `an unevidenced percentage` | See 2.4: no measurement against the shipped engine exists, so every percentage about users, drafts, or outcomes is invented precision. |
| `a ranking claim` | Nobody ranked it. "Rated #1" needs a ranker. |
| `a superlative market claim` | "The best AI humanizer" is unfalsifiable and, on this product, unsupported. |
| `a free trial this product does not offer` | There is no free trial. The free surface is a bounded preview of one rewrite; calling it a trial promises a period that does not exist. |

<!-- enforced-shapes:end -->

### 3.2 Forbidden, and no test can see it

The gate checks the **shape** of a claim, never its truth. A sentence that is false but phrased plainly
passes it. These are the shapes a human reviewer has to catch.

- **Detector evasion by implication.** No test catches "reads like a person wrote it, so it sails through"
  said in a fresh way. `docs/SEO.md` Section 1: never promise guaranteed detector or Turnitin bypass, and
  never optimize a detector score at the expense of meaning, facts, citations, or quality.
- **Absolutes about pattern-based behavior.** "Never", "always", "every", "all" attached to extraction,
  verification, or detection. The extractor is a set of regular expressions; it has recall, not
  certainty.
- **Mode-specific quality.** The deployed engine distinguishes Professional from the other modes by three
  regular-expression substitutions on a shared table (`src/lib/humanization/deterministic-provider.ts`).
  Copy claiming a distinct academic or professional workflow, or mode-specific quality, states something
  the product cannot do. This is why SEO-017 and SEO-018 have been declined four times.
- **Academic framing that reads as integrity evasion.** Academic surfaces frame the product as a revision
  and clarity aid, never as a way around academic-integrity controls, and carry a visible integrity notice
  (`docs/SEO.md` Section 1).
- **Fabricated identity of any kind:** testimonials, logos, expert reviewers, author bylines, case
  studies, or a named person who did not review the page. The public page registry declares an accountable
  *role*, not a person, precisely because this repository has no author identities to cite
  (`docs/SEO.md` Section 11.5).
- **Fake scarcity:** countdowns, seat counts, expiring discounts, or a fabricated free-preview allowance
  (`docs/ACTIVATION.md`).
- **A permanent free tier, or Voice DNA presented as available in V1** (`docs/ACTIVATION.md`,
  `docs/PRODUCT.md`).
- **Generic-paraphraser framing, or concealment framing.** Do not describe the product as a generic
  paraphraser, and do not describe it as a way to conceal that a tool was used (`docs/SEO.md` Section 1).
- **Near-duplicate positioning pages** for keyword, profession, school, location, or model-name variants.
  A page that cannot state an intent 60% different from an existing page is the same page
  (`docs/SEO.md` Section 3).
- **Conversion and funnel numbers.** No purchase has been evidenced end to end on production
  (`docs/SEO.md` O-7), so preview-to-paid, activation, and retention figures are unmeasured. Do not write
  copy, targets, or page promises that assume a measured rate exists.
- **Any claim about the live host** — uptime, speed, Core Web Vitals, index coverage — stated as observed.
  Outbound to `ownword.pro` is blocked from every agent session in this project. Live figures are
  owner-reported and must be labelled as such (`docs/SEO.md` Section 0).

### 3.3 Structured data

Structured data is a claim in machine-readable form and is held to this standard identically. Omitting a
property is correct; inventing one is a spam-policy violation. `logo`, `sameAs`, `aggregateRating`,
`review`, `foundingDate`, `address`, and `SearchAction` are deliberately absent from
`src/lib/site-structured-data.ts` and a test fails if any appears. A price in an `Offer` must equal the
price the page shows a reader.

## 4. Surfaces this standard governs

Public pages, page metadata and social cards, JSON-LD, the pricing card, error and empty states,
transactional email, the sitemap-listed legal pages, release notes, and anything published off-site under
the Ownword name. There is no surface where a weaker rule applies. Error copy is included deliberately: an
error that overstates what went wrong is a claim.

## 5. Review workflow

1. **Author** writes the sentence and records, in the pull request, which clause of Section 2 licenses it
   and what artifact it points at.
2. **Build** runs the floor. `tests/page-quality-gate.test.mjs` fails the nine shapes; other tests hold
   prices, roadmap rows, and structured-data absences.
3. **Reviewer** applies Section 3.2, which no build can. The reviewer's question is test 1 from Section 1:
   *point at it.*
4. **Legal** reviews any new claim class, any comparison, any academic-integrity copy, and any change to
   this document.

A claim that cannot name its artifact is not "unverified". It is a claim that does not ship.

## 6. What happens when a claim turns out to be wrong

Correct it in the same working day it is confirmed wrong; do not wait for a content cycle. Record the
correction and its date on the page itself where the page carried the claim, and in `docs/DECISIONS.md`.
A silent edit to a claim a customer may have relied on is a second failure on top of the first.

## 7. Approval

This section is filled in by Legal, not by an agent, not by SEO, and not by Engineering.

| Field | Value |
|---|---|
| Approved | **Yes**, unchanged. |
| Approver | Counsel engaged by Bosphorus Elevate LLC. Recorded on the product owner's attestation; the individual or firm is not named here. |
| Date | 2026-08-27 |
| Scope of approval | The text of this document, `/terms` and `/privacy` as they stood on 2026-08-27, including the third-party AI provider disclosure added that day. **Not** a review of any claim made anywhere else in the product, and not a compliance certification. |
| Next review | On the next material change to pricing, retention, the provider disclosure, or the claim set — whichever comes first. A new provider is a material change. |

Historic note. Until 2026-08-27 the first row read **No**, `docs/SEO.md` SEO-011 stayed short of Done, and the reason was this
row alone: the list exists, the approval does not.
