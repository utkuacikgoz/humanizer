# The meaning-preservation checklist

**Backlog item:** SEO-019 (`docs/SEO.md` Section 11)
**Status:** the checklist is complete; it is **not published**. See "What is missing" below.
**Owner:** SEO/GEO Agent (content), Product (the decision to publish a page)
**Drafted:** 2026-08-27
**Sync guard:** `tests/meaning-preservation.test.mjs`

## What this is

A list of the things a rewrite can quietly destroy, what this product does about each one, and what a
person still has to check themselves. It is written for someone about to hand a rewritten draft to a
supervisor, a client, a journal, or a court, and it assumes they will not read the source code.

Everything in it is drawn from code in this repository. The thirteen protected classes are the
`ProtectedContentKind` union in `src/lib/humanization/types.ts`, implemented in
`src/lib/humanization/protected-content.ts`. The method note in Section 3 describes
`src/lib/humanization/verification.ts` as it is actually written.

## What is missing, precisely

SEO-019's acceptance has three clauses. Two are met here and one is not:

| Clause | State |
|---|---|
| Covers all protected claim classes | **Met.** All thirteen, below, each with what the product catches and what it does not. `tests/meaning-preservation.test.mjs` fails the build if a class is added to the code and not to this file. |
| Cites methodology | **Met.** Section 3 names the provider, its inputs, its thresholds, its issue vocabulary, and its failure mode. |
| Contains no customer text | **Met.** Every example below is written for this document. |
| **Web and accessible downloadable versions** | **Not met.** This file is not a page and not a download. |

**The one missing input:** a decision to publish a new public route. Publishing is not a writing task — it
is a page, and `docs/SEO.md` Section 7's publication-velocity caps and Section 3's query-to-page decision
rule gate every new page. **Owner: Product**, with SEO. When that decision is made, this file is the
content; the route, the download format, and the registry entry in `src/lib/public-pages.ts` are the
remaining work, and both `tests/page-quality-gate.test.mjs` and `tests/metadata-contract.test.mjs` will
hold the new page to the template automatically.

Nothing here waits on the humanization engine. That distinguishes SEO-019 from SEO-012 and SEO-017/018,
which wait on evidence that does not exist yet: this checklist makes **no claim about how well the product
rewrites**. It describes what is protected and how the check works, both of which are true of the
deterministic baseline that is deployed today and will stay true of any provider selected later.

## 1. Before you paste

- [ ] Are you allowed to put this text into a third-party tool at all? Contracts, embargoes, client
      confidentiality, unpublished research, and personal data belonging to other people are your call, not
      the tool's.
- [ ] Do you have the original? Keep it. Every check below is a comparison, and a comparison needs both
      sides.
- [ ] Is the draft final in substance? A rewrite is a revision pass, not a drafting pass. Rewriting text
      whose facts you have not yet checked just makes the unchecked facts read better.

## 2. The thirteen protected classes

For each: what the product does, and what you still have to do. The second column is the honest half — an
extractor is a set of patterns, and patterns have recall, not certainty.

<!-- protected-classes:start -->

### `person`

Named people, and titled names (Dr., Prof., Mr., Ms., Mrs.), plus a two-word capitalised name immediately
before a reporting verb such as *said*, *wrote*, *argued*, *found*, *announced*.

**You still check:** an unusual name form, a name with no title and no reporting verb next to it, a name
that appears only as an initial, and every role or affiliation attached to a name. The extractor protects
the string; it has no idea whether the person is being described correctly.

### `company`

Organisations carrying a legal suffix (Inc., Corp., Corporation, LLC, Ltd., Limited, PLC), plus a small
fixed list of well-known names.

**You still check:** any organisation with no legal suffix and not on that list — most universities, most
agencies, most non-profits, and most small firms. Also check that a company has not been silently swapped
for a shorter synonym.

### `product`

Names followed by a version number, e.g. a two- or three-word capitalised name plus `v1.2.3`.

**You still check:** an unversioned product name, a codename, and any product whose name reads as an
ordinary noun. Also check that a version number attached to the right product stayed attached to it.

### `date`

ISO dates (`2026-08-27`), and long or abbreviated month-day-year forms.

**You still check:** relative dates (*last Tuesday*, *three years ago*, *the following quarter*), bare
years, seasons, quarters, fiscal periods, and date ranges. Relative dates are the dangerous ones: a
rewrite that changes *before the merger* to *after the merger* passes every automated check here.

### `number`

Digits, including grouped and decimal forms and scientific notation.

**You still check:** every number written as a word (*twelve*, *a third*, *half*), every unit attached to a
number, and every number's *role* in the sentence. The check confirms the digits survived; it cannot
confirm they still describe the same thing.

### `percentage`

A number immediately followed by `%`.

**You still check:** percentages written out (*forty percent*), percentage *points* versus percent — the
difference that turns a modest change into a dramatic one — and the base the percentage is of. "Rose by
5%" and "rose to 5%" are different claims and both survive extraction.

### `currency`

Amounts with a `$`, `€`, `£`, or `¥` sign or a `USD`/`EUR`/`GBP`/`JPY` code, including *million*,
*billion*, *trillion* suffixes.

**You still check:** other currency codes and symbols, amounts written as words, and whether a figure is
gross or net, annual or monthly, per-unit or total. Currency is the class where a preserved number in a
re-phrased sentence does the most damage.

### `quotation`

Text inside paired curly or straight double quotes, and single-quoted spans whose delimiters are not
adjacent to a letter or digit.

**You still check:** every block quotation set off by indentation rather than quote marks, every quotation
running across a line break, and every attribution. **This is the class to check hardest.** A quotation is
the one kind of text a rewrite must never touch, and the extractor's job here is to keep the tool's hands
off it — not to verify that the quotation was accurate when you pasted it.

### `citation`

Parenthetical author-year citations, including *et al.* and page locators, and bracketed numeric citations
such as `[12]` or `[3, 4]`.

**You still check:** footnote and endnote markers, superscript numerals, in-text narrative citations
(*Marsh (2021) argued...* where the name sits outside the parentheses), and every reference-list entry.
A verification failure that touches this class is reported as `citation-damage` and the candidate is
refused, but only for what the pattern saw.

### `url`

`http` and `https` addresses, with trailing sentence punctuation trimmed.

**You still check:** bare domains with no scheme, links carried by anchor text rather than written out,
shortened links, and whether a link still points where the sentence says it points.

### `technical-term`

A fixed vocabulary (API, SDK, LLM, JSON, TypeScript, OAuth, HTTP, TLS, Kubernetes, *machine learning*,
*large language model*, and others), **plus every term you supply yourself.** Terms passed as protected
terms are matched literally and protected first, before any pattern runs.

**You still check:** everything domain-specific — a clinical term, a statutory reference, a piece of
in-house jargon, a defined term in a contract. Supply these explicitly; the built-in list is a
convenience, not a glossary of your field.

### `code`

Fenced blocks (triple backticks) and inline spans (single backticks).

**You still check:** code indented rather than fenced, code pasted as plain prose, command lines, file
paths, and configuration fragments. Anything that has to be typed exactly and is not marked as code should
be supplied as a protected term.

### `reference`

DOIs — `10.` followed by a registrant and a suffix, with or without the `doi:` prefix.

**You still check:** ISBNs, PMIDs, arXiv identifiers, case citations, statutes, patent numbers, internal
document IDs, and standards numbers. None of these are recognised.

<!-- protected-classes:end -->

## 3. Method note: how the check actually works

The verifier is `DeterministicVerificationProvider` in `src/lib/humanization/verification.ts`, versioned as
`deterministic-semantic-v1`. It runs on **every** candidate rewrite, in
`src/lib/humanization/pipeline.ts`, before anything is returned.

**Inputs.** The original text, the candidate rewrite, and the protected items extracted from the original.

**What it computes.**

1. **Protected-content preservation.** Each extracted item must appear in the candidate at least as many
   times as it has been counted so far in the original. Comparison is by exact string, so a preserved
   figure that has been reformatted counts as lost — deliberately, because "$1,200" and "$1200" are not
   the same token to a reader checking a contract.
2. **Lexical coverage.** The proportion of the original's content words, after stop-word removal and a
   small canonicalisation table, that survive into the candidate. Below **0.72** it raises
   `removed-claim`.
3. **Negation preservation.** Every negation present in the original (*no, not, never, neither, without,
   cannot,* and the common contractions) must still be present. A missing one raises `changed-meaning`.
4. **Unsupported-language ratio.** If the candidate's vocabulary is more than eight terms and more than
   **45%** (`0.45`) of it does not appear in the original, it raises `new-claim`.

**The pass rule.** A candidate passes only if *every* protected item survived, the weighted semantic score
is at least **0.72**, and neither `changed-meaning` nor `new-claim` was raised. The score is
`0.72 × lexical coverage + 0.23 × protected-content preservation + 0.05 if negations survived`.

**The failure mode.** A candidate that fails is resampled. If no candidate passes, the request is
**refused** rather than answered with an unverified rewrite. Refusing is the intended behavior, not a
defect.

**The issue vocabulary**, as it appears in the code: `missing-protected-content`, `altered-quantity`
(numbers, percentages, currency, dates), `citation-damage` (citations and DOIs), `removed-claim`,
`new-claim`, `changed-meaning`.

**What the method is not.** It is a deterministic scorer with thresholds, not a proof and not a model
judging meaning. It can tell you a token disappeared. It cannot tell you a sentence now says something
else using all the same tokens. Sections 2 and 4 are where that gap is your job.

## 4. After the rewrite, before you send it

- [ ] Read the original and the rewrite side by side, once, end to end. Nothing below replaces this.
- [ ] Check every number *and its role in the sentence*, not just that the digits survived.
- [ ] Check every quotation character by character, and check each one is still attributed to the same
      person.
- [ ] Check every citation still sits next to the claim it supports. A citation that survived but moved is
      worse than one that was deleted, because it now cites the wrong sentence.
- [ ] Check every negation and every hedge. *May*, *might*, *appears to*, *is associated with* are claims
      about certainty, and a rewrite that firms them up has changed the finding.
- [ ] Check causal language. *Correlated with* becoming *caused by* is the single most damaging
      substitution in this list, and no check here catches it.
- [ ] Check relative time and sequence: *before*, *after*, *since*, *until*, *following*.
- [ ] Check anything conditional: *if*, *unless*, *provided that*, *subject to*.
- [ ] Check names, titles, and affiliations against the source.
- [ ] Check that nothing was **added**. A fluent sentence you did not write is still a claim you are now
      making.
- [ ] Confirm the rewrite still fits the obligations that apply to it — your institution's policy, your
      client's style rules, the journal's, the court's. That is yours, and no tool can hold it.

## 5. The limits of this document

- The extractor is a set of regular expressions. Every "you still check" line above exists because a
  pattern has a boundary, and the boundaries are stated rather than glossed.
- The verifier is a scorer. Passing is not a warranty that meaning survived.
- Nothing in this document is a claim about rewrite quality. `HUMANIZATION_PROVIDER` currently fails
  closed to the deterministic substitution baseline, so there is no measured quality result to cite, and
  `docs/CLAIMS.md` Section 2.4 forbids inventing one.
- Responsibility for the text does not transfer. It stays with the author.
