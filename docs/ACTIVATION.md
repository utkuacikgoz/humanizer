# Activation and the AHA Moment

Last updated: 2026-08-23
Owner: Product Orchestrator
Authority: `PRODUCT.md` for scope, `MONETIZATION.md` for paywall and dark-pattern rules, `DECISIONS.md` for accepted decisions

This document names the product's activation moment, records the funnel as it
actually behaves today, and lists an atomic backlog to close the gap. Every
observation below was taken from the running dev server and the current
working tree on 2026-08-23, not from the specification. Where an observation
contradicts a specification, the observation is recorded as the current
behavior and the specification is treated as the target.

## 1. The AHA moment

**The AHA moment is the instant a first-time visitor sees their own sentence
rewritten beside the original, with the exact facts they care about visibly
untouched.**

Three things have to land together, in one glance, for it to fire:

1. **It is my text.** Not a canned marketing example — the visitor's own
   paragraph, or a sample they chose to load one click earlier.
2. **Something actually changed, and I can see what.** The changed spans are
   marked. The visitor should never have to read two paragraphs and diff them
   by eye.
3. **Nothing I would have panicked about changed.** The names, numbers, dates,
   percentages, citations and URLs are still there, and the product points at
   them and says so.

Item 3 is the differentiator. Any paraphraser can do item 2. `PRODUCT.md`'s
promise — "turns generic AI-assisted writing into natural writing while
preserving the author's meaning" — is only credible if preservation is
*demonstrated on the visitor's own facts*, not asserted in a feature bullet.

### Does the product deliver it today?

**No. On the default path it delivers none of the three, and on the worst path
it inverts into an active trust liability.**

Observed, reproducible:

- **The one-click sample demonstrates the differentiator not at all.** Posting
  `SAMPLE_TEXT` (`app/page.tsx:21`) to `/api/humanize` returns
  `"protectedItems": []`. `app/page.tsx:275` renders the "Protected:" line only
  when `result.protectedItems.length` is truthy, so the visitor who takes the
  fastest path into the product — "Try an example" — sees **no protection
  evidence at all**. The single highest-traffic demo path skips item 3
  entirely.
- **Nothing is highlighted.** `app/page.tsx:250` and `:254` render the original
  and the preview as two plain `<p>` elements. There is no diff, no mark, no
  change count per span, and the API returns no diff data to render one.
  `PRODUCT.md`'s "comparison with meaningful changes highlighted" and
  `ARCHITECTURE.md`'s preview-boundary bullet "Diff hunks safe to expose" are
  both unimplemented. Item 2 does not land; the visitor must diff by eye.
- **On mobile the comparison does not exist.** `app/globals.css:457`, inside
  the `@media (max-width: 760px)` block at `:438`, sets
  `.comparison > article:first-child { display: none; }`. Below 760px the
  Original panel is removed from the page. A phone visitor sees a single block
  of text with a lock on it and no baseline to compare it against. Item 1 and
  item 2 are structurally impossible on mobile. This is the largest single
  leak in the funnel.
- **The preview cuts mid-clause.** `partialPreview()`
  (`app/api/humanize/route.ts:109`) slices on whitespace at
  `Math.floor(words.length * 0.46)`. With a fact-rich input the preview
  observed in session ended `"...the study (Chen et al., 2024) leveraged"` —
  mid-sentence, mid-thought, and still containing the corporate-filler word the
  product advertises removing. `MONETIZATION.md` requires the preview to be
  "enough coherent text and evidence to judge quality". A dangling clause is
  not coherent text.
- **The protection proof, when it does render, is noisy enough to undercut
  itself.** The same fact-rich input returned `protectedItems` containing
  overlapping and fragmentary spans: `"March 14, 2024"`, `"14"`, `"2024"`,
  `"87%"`, `"87"`, `"(Chen et al., 2024)"`, `"2024"` again, `"$2.3 million"`,
  `"2.3"`, `"https://example.org/data"`, `"https"`. `app/page.tsx:276` shows
  `.slice(0, 5)`, so the visitor reads:
  `Dr. Sarah Chen · March 14, 2024 · 14 · 2024 · 87%`. Two of the five items
  are orphan digits and one is a duplicate. The evidence panel for a
  precision claim should not itself look imprecise.
- **On ordinary prose the product charges for a rewrite it did not perform.**
  This is the most serious finding. The deterministic provider
  (`src/lib/humanization/deterministic-provider.ts`) is a fixed
  phrase-substitution table; it only edits sentences that `analyzeWriting()`
  flagged *and* that match one of its regexes. Ordinary human-sounding prose
  matches nothing. Posting such a paragraph to the live endpoint in session
  returned a `preview` that is a **verbatim prefix of the original**
  (`original.startsWith(preview)` was `true`), `"protectedItems": []`, and
  `"issuesImproved": 1`. Rendered, that is a "Humanized" panel identical to the
  "Original" panel, a "Changes: 1 improvements" badge, a blurred lock, and a
  `$9.99/mo` button. The visitor is asked to pay to unlock words they wrote
  themselves. See ACT-01.

### What the engine can honestly support today

The backlog below is constrained to what `src/lib/humanization/**` actually
produces. It produces: a full rewritten string, a `protectedContent[]` array
with `kind`, `value`, and character `start`/`end` offsets
(`protected-content.ts:34`), a `WritingAnalysis` with typed issues and spans
(`analysis.ts:20`), a boolean-passing verification result, and evaluation
scores mapped to the qualitative labels `Strong`/`Good` and
`High`/`Review needed` (`app/api/humanize/route.ts:181`).

That is enough to build: span-accurate diff highlighting, span-accurate
protected-term marking, sentence-boundary preview selection, a no-op
detector, and an honest improvement count. Every hook below draws only on
those. **No hook below assumes a model-backed rewrite, a detector score, a
personalization signal, or any other unbuilt capability**, because the
deterministic provider is what is deployed. Hooks that would require them are
listed in section 4 as explicitly out of scope.

## 2. The funnel as it actually behaves

| # | Step | What actually happens | Leak |
|---|---|---|---|
| 1 | Land | Hero, a trust line reading `Checked before you see it / Names, numbers & citations protected / Cancel anytime`, then the paste box. No output of any kind is visible above the fold. | The differentiator is claimed in three chips before it is ever shown. Nothing on the page proves it until the visitor works for it. |
| 2 | Understand | `How it works` is three text cards well below the workspace. | Low. The workspace-first layout is correct and should be kept. |
| 3 | Get text in | Textarea, plus a `Try an example` button (`app/page.tsx:184`) that fills the box but does **not** submit and does **not** fire `text_pasted`. | Time-to-first-value for a visitor with nothing to paste is two clicks plus a round trip, and the sample path is invisible to analytics. **ACT-12.** |
| 4 | Humanize | Client requires 12–300 words (`app/page.tsx:91`, `:95`); the server re-enforces it (`app/api/humanize/route.ts:149`, `:152`). Staged status copy, no fake percentages. Focus is moved to the result heading. | Low. This step is genuinely well built. |
| 5 | **See the preview — the AHA** | Two plain paragraphs, three qualitative check tiles, a blurred bar placeholder, an 11px muted `Protected:` footnote. Nothing highlighted. Original hidden entirely below 760px. Preview may be a verbatim, mid-clause prefix. | **The primary leak.** ACT-01, ACT-03, ACT-04, ACT-05, ACT-06, ACT-07, ACT-08. |
| 6 | Hit the paywall | `There's more to this rewrite / Unlock the complete result.` and a button reading `Unlock full rewrite for $9.99/mo`. | Recurring billing, renewal, and the 50,000-word monthly limit (`src/config/pricing.ts`) are not disclosed at the decision point. **ACT-10.** |
| 7 | Checkout | `/api/checkout` returns 401 with a `signInPath` for anonymous callers (verified in session), so the visitor is sent to sign-in *after* clicking buy. If Stripe is unconfigured the same button then returns 503 `Checkout is not available yet.` | The visitor can be walked through sign-in only to hit a dead end. `productConfig.billingEnabled` exists but gates only JSON-LD (`app/page.tsx:76`). **ACT-11.** |
| 8 | Return | `app/checkout/success/page.tsx` polls `/api/result` up to 10 times at 1.5s and shows honest confirming/delayed/signed-out states. Unlock is server-authoritative. | The mechanics are correct and well built. |
| 9 | **Unlocked result** | Two plain paragraphs. No check tiles, no protected items, no highlighting, no copy button, no next-action CTA, and no analytics events. | The moment of peak paid satisfaction is the plainest screen in the product. **ACT-13, ACT-14, ACT-15.** |
| 10 | Second use | Nothing invites it. `second_humanization` fires on the second *anonymous* preview of a session (`app/page.tsx:119`), which is not the metric `PRODUCT.md` defines. | **ACT-15, ACT-16.** |

### Top three leaks

1. **Step 5 on mobile** — the comparison, which *is* the AHA, is deleted by a
   CSS rule. (ACT-03)
2. **Step 5 on unremarkable prose** — an unchanged preview is presented as a
   rewrite and paywalled. (ACT-01, ACT-02)
3. **Step 5 everywhere** — no diff highlighting and no prominent, clean
   protection evidence, so even a successful rewrite makes the visitor do the
   work of noticing it. (ACT-04, ACT-07, ACT-08)

## 3. Activation backlog

Ranked by impact per unit of effort. Items marked **Blocker** must ship before
real customers are charged; they are correctness and honesty fixes, not
optimizations. Ranking is a product judgement, not a measurement — there is no
funnel data yet, and none is claimed here.

Effort is `S` (under an hour), `M` (a few hours), `L` (a day or more).

---

### ACT-01 — Never paywall an unchanged rewrite — **Blocker**

**Owner:** ENG
**Impact:** Critical · **Effort:** S

The pipeline can return a candidate byte-identical to the input. Today that is
projected into a preview, labeled with an improvement count, truncated, and
sold.

**Touches:** `app/api/humanize/route.ts` (projection, around `:176`),
`app/page.tsx` (result branch, `:236`).

**Acceptance criteria:**
- The projection carries an explicit signal for "the rewrite is materially
  identical to the input" — derived server-side by comparing the normalized
  full rewrite with the normalized original, not by trusting `improvements`.
- When that signal is set, the response contains **no** `preview` truncation,
  **no** `hiddenWordCount`, and **no** `capability`, and the client renders an
  honest terminal state: the draft already reads naturally, there is nothing to
  unlock, and no charge is offered. Suggested direction for COPY, not final
  wording: "This draft already reads naturally — we found nothing worth
  rewriting."
- The `Unlock full rewrite` CTA cannot render in that state.
- A regression test posts a plain-prose fixture that the deterministic provider
  leaves untouched and asserts no capability and no unlock CTA are produced.
  (Three such fixtures were reproduced in session; any ordinary paragraph
  containing none of the marker phrases in
  `src/lib/humanization/analysis.ts:4` will do.)

---

### ACT-02 — Report the measured improvement count — **Blocker**

**Owner:** ENG
**Impact:** High · **Effort:** S

`app/api/humanize/route.ts:180` reads
`issuesImproved: Math.max(1, result.improvements)`. When the engine measures
zero improvements the UI displays `1 improvements`. That is a fabricated
evidence claim, which `MONETIZATION.md`'s dark-pattern list and the README
guardrails both forbid, and it is the mechanism that makes ACT-01's no-op case
look legitimate.

**Touches:** `app/api/humanize/route.ts:180`, `app/page.tsx:245`.

**Acceptance criteria:**
- The floor is removed; the projected count is exactly `result.improvements`.
- The label pluralizes correctly (`1 improvement`, `4 improvements`).
- With ACT-01 shipped, a zero count is unreachable in the preview state, so no
  "0 improvements" badge is ever rendered next to a paywall.

---

### ACT-03 — Restore the Original panel on mobile — **Blocker**

**Owner:** DES
**Impact:** Critical · **Effort:** S

`app/globals.css:457` hides `.comparison > article:first-child` below 760px,
deleting the side-by-side comparison — the AHA itself — for every phone
visitor.

**Touches:** `app/globals.css:438-459`.

**Acceptance criteria:**
- Below 760px both panels are present and reachable.
- The chosen pattern keeps both readable without horizontal page scroll —
  stacked Original-then-Humanized, or a labeled two-tab switcher, at DES's
  discretion.
- If tabs are used, the Humanized panel is the default tab and switching is
  keyboard operable with visible focus.
- Verified at 390px and 360px viewport widths.

---

### ACT-04 — Highlight what changed

**Owner:** ENG (data) + DES (treatment)
**Impact:** Critical · **Effort:** M

This is the single largest positive activation gain available. The comparison
currently makes the visitor find the changes themselves; on a 40-word preview
whose only edit is a deleted throat-clearing phrase, most will not.

**Touches:** `app/api/humanize/route.ts` (projection), `app/page.tsx:247-274`,
`app/globals.css`.

**Acceptance criteria:**
- The projection gains a `previewDiff` field: an ordered list of
  `{ kind: "unchanged" | "removed" | "added", text }` segments computed
  server-side from the original and the rewrite.
- **The diff is clipped strictly to the exposed preview region.** Per
  `MONETIZATION.md`'s "Diff metadata is clipped to exposed regions so it cannot
  reconstruct hidden text", no segment may contain any rewritten text beyond
  the preview boundary. A test asserts the concatenated `added` segments are a
  subset of the exposed preview.
- The Original panel marks removed spans; the Humanized panel marks added
  spans. Marking is conveyed by more than color alone (underline, strikethrough
  or weight) for contrast and colorblind accessibility.
- Marked spans are announced sensibly to a screen reader rather than fragmenting
  the sentence into unreadable pieces.
- If the diff is empty, ACT-01's state applies instead.

---

### ACT-05 — Cut the preview on a sentence boundary

**Owner:** ENG
**Impact:** High · **Effort:** S

`partialPreview()` (`app/api/humanize/route.ts:109`) slices on word index at
46%, producing dangling clauses. This also resolves the open
`ARCHITECTURE.md` row "Partial preview selection — PO + DES define fixed
transparent policy", which is a PO decision.

**Policy decision (PO, 2026-08-23):** the preview is the **leading whole
sentences** of the rewrite, taking approximately half the sentences, with a
floor of one sentence and a ceiling of `sentenceCount - 1` so at least one
sentence always remains locked. A coherent prefix is chosen over selected hunks
because a prefix cannot cherry-pick the best passage and is trivially
explainable to the customer. Revisit only with evidence.

**Touches:** `app/api/humanize/route.ts:109-113`; reuse `splitSentences` from
`src/lib/humanization/text.ts`.

**Acceptance criteria:**
- The preview always ends at a sentence terminator.
- At least one whole sentence is visible and at least one whole sentence is
  hidden whenever the rewrite has two or more sentences.
- A single-sentence rewrite is handled explicitly and does not produce a
  mid-sentence cut.
- `hiddenWordCount` continues to be computed from the server-side full rewrite
  and remains consistent with the new boundary.

---

### ACT-06 — Make the sample text prove the differentiator

**Owner:** COPY (text) + ENG (verification test)
**Impact:** High · **Effort:** S

`SAMPLE_TEXT` (`app/page.tsx:21`) yields `protectedItems: []`, so the fastest
path into the product demonstrates the one capability competitors do not have
— zero times.

**Touches:** `app/page.tsx:21`.

**Acceptance criteria:**
- The sample is 12–300 words and contains at least one person, one date, one
  number or percentage, one citation or URL, and at least three of the marker
  phrases in `src/lib/humanization/analysis.ts:4` so that a visible rewrite
  actually occurs in the exposed preview region.
- Verified against the running endpoint: `protectedItems` is non-empty, the
  preview differs visibly from the original prefix, and `issuesImproved` is at
  least 3 without any floor applied.
- A test asserts the shipped sample still satisfies the above, so the sample
  cannot silently rot into a no-op when engine rules change.
- The sample reads as a plausible real draft, not as marketing copy about the
  product.

---

### ACT-07 — Clean the protected-items projection

**Owner:** ENG
**Impact:** High · **Effort:** S

`app/api/humanize/route.ts:183` maps every extracted span to a display string,
including nested and duplicate matches, so the evidence for a precision claim
reads `Dr. Sarah Chen · March 14, 2024 · 14 · 2024 · 87%`.

**Touches:** `app/api/humanize/route.ts:183`. **Do not change extraction
semantics** in `src/lib/humanization/protected-content.ts` — masking depends on
the full overlapping set, and narrowing it would weaken protection. Fix the
display projection only.

**Acceptance criteria:**
- The projection applies the same longest-span, non-overlapping selection that
  `maskProtectedContent` already uses (`protected-content.ts:88-92`), then
  deduplicates by `normalizedValue`.
- `"March 14, 2024"` survives; `"14"` and the duplicate `"2024"` do not.
  `"$2.3 million"` survives; `"2.3"` does not.
  `"https://example.org/data"` survives; `"https"` does not.
- Items are ordered by their position in the source text.
- A test asserts no projected item is a substring of another projected item.

---

### ACT-08 — Promote protection from footnote to proof

**Owner:** DES + COPY
**Impact:** High · **Effort:** M
**Depends:** ACT-07

The protection evidence is currently 11px, muted, bottom-of-card
(`app/globals.css:371`), truncated to five items, and absent entirely when the
list is empty. It is the product's core differentiator rendered as the least
prominent element on the screen.

**Touches:** `app/globals.css:371`, `app/page.tsx:275-277`.

**Acceptance criteria:**
- Protected terms are marked **inline within the Humanized panel** at their
  actual positions, so the visitor sees the fact sitting untouched in the
  rewritten sentence rather than reading a detached list.
- The panel carries a short, honest header — evidence, not a superlative. It
  must not use the word "guaranteed" and must not imply detector behavior.
- Inline marking is visually distinct from ACT-04's change marking; the two
  must be legible simultaneously in the same sentence.
- The count is stated honestly and the truncation is explicit when more items
  exist than are shown.
- Empty-state behavior is defined rather than silently omitted.

---

### ACT-09 — Make "Cancel anytime" reachable — **Blocker**

**Owner:** ENG + COPY
**Impact:** High · **Effort:** S

`app/page.tsx:174` promises `Cancel anytime` in the hero trust line.
`app/api/billing/portal/route.ts` implements the Stripe Billing Portal
correctly — and **nothing in any page or component calls it**. A grep across
`app/` finds exactly one match for "Cancel", the marketing claim itself.
`MONETIZATION.md` lists "Hidden recurring billing, renewal, cancellation" and
"obstructed cancellation" as dark-pattern blockers. A promise with no path is
an obstructed cancellation.

**Touches:** `app/page.tsx` (header or footer), `app/checkout/success/page.tsx`.

**Acceptance criteria:**
- A signed-in customer can reach the billing portal from the product surface in
  one click, without knowing an API route.
- The entry point is present on the post-purchase page as well as the main
  page.
- The 401/404/503 responses from the portal route are surfaced as honest,
  actionable states rather than a silent no-op.
- Either this ships, or the `Cancel anytime` claim is removed until it does.
  Keeping the claim without the path is not an acceptable outcome.

---

### ACT-10 — Disclose the recurring charge at the decision point — **Blocker**

**Owner:** COPY
**Impact:** High · **Effort:** S

The unlock card (`app/page.tsx:260-272`) reads `There's more to this rewrite /
Unlock the complete result.` The button carries `/mo`, which is the only
signal that this is a subscription. The 50,000-word monthly allowance
(`src/config/pricing.ts`) — a material limit — is never mentioned at the point
of purchase, only in the pricing section further down the page.

**Touches:** `app/page.tsx:260-272`.

**Acceptance criteria:**
- Adjacent to the unlock button, before the click, the visitor sees: the
  amount, that it recurs monthly, the included monthly word allowance, and
  that cancellation is available (linked, per ACT-09).
- Values are read from `pricingConfig`, never hardcoded.
- No countdown, no scarcity, no "limited time", no preselected upsell —
  `MONETIZATION.md`'s artificial-urgency blocker is absolute and this item must
  not be used as an excuse to introduce one.

---

### ACT-11 — Never route a visitor to a checkout that cannot complete

**Owner:** ENG
**Impact:** Medium-High · **Effort:** M

`/api/checkout` returns 401 for anonymous callers (verified in session), so the
sign-in wall arrives *after* the buy click. If Stripe is unconfigured, the
route then returns 503 `Checkout is not available yet.` — meaning a visitor can
be walked through authentication and still dead-end at the moment of intent.
`productConfig.billingEnabled` exists but currently gates only the JSON-LD
offer block (`app/page.tsx:76`).

**Touches:** a server-computed availability projection, `app/page.tsx`
(unlock card and pricing section), `src/config/product.ts`.

**Acceptance criteria:**
- The client learns from the server whether checkout can actually complete,
  before rendering a purchase CTA — never inferred from a client constant
  alone.
- When it cannot, the unlock card shows an honest unavailable state instead of
  a button that leads to a 503.
- When it can, the sign-in requirement is stated on the card before the click,
  not discovered after it.
- The existing fail-closed behavior in `app/api/checkout/route.ts` is
  preserved; this adds a pre-check, it does not replace the server gate.

---

### ACT-12 — One-click demo

**Owner:** ENG
**Impact:** Medium · **Effort:** S
**Depends:** ACT-06

`Try an example` (`app/page.tsx:184`) fills the textarea and stops. The visitor
must then find and click `Humanize`. It also does not fire `text_pasted`,
because that event lives only in the textarea's `onChange` (`:196`), so the
entire sample-driven funnel is invisible in analytics.

**Touches:** `app/page.tsx:184`, `:196`.

**Acceptance criteria:**
- One click loads the sample and starts the rewrite.
- `text_pasted` fires for the sample path with a property distinguishing it
  from a real paste (for example `source: "sample"`), so sample-driven and
  paste-driven activation can be told apart. The event must carry no text
  content, per `PRODUCT.md`'s instrumentation rules.
- The result region receives focus on completion, as the existing manual path
  already does (`app/page.tsx:47-50`).
- Double-clicking the button cannot start two jobs.

---

### ACT-13 — Fire the bottom-funnel events

**Owner:** ENG
**Impact:** Medium · **Effort:** S

`checkout_completed`, `full_result_unlocked`, `result_copied` and
`subscription_cancelled` are declared in `src/lib/analytics.ts` and accepted by
`app/api/events/route.ts`, but a grep shows **none of them is fired anywhere**.
`PRODUCT.md` lists checkout-to-unlock completion and second paid use among the
primary metrics; today neither can be computed. The funnel is instrumented down
to `checkout_started` and blind after it.

**Touches:** `app/checkout/success/page.tsx`.

**Acceptance criteria:**
- `checkout_completed` fires once on arrival at the success route with a job
  reference.
- `full_result_unlocked` fires once when `/api/result` returns an unlocked
  result — on server-confirmed entitlement, never on the redirect alone.
- Each fires at most once per page load, including across the polling loop and
  React strict-mode double-invocation.
- No event carries source text, rewritten text, protected terms, or a
  capability token.

---

### ACT-14 — Copy the result

**Owner:** ENG
**Impact:** Medium · **Effort:** S
**Depends:** ACT-13

`PRODUCT.md`'s MVP definition requires that a customer can "copy it". There is
no copy affordance anywhere in the application — a grep for `clipboard` across
`app/` and `src/` returns nothing.

**Touches:** `app/checkout/success/page.tsx`.

**Acceptance criteria:**
- A visible, keyboard-reachable copy control on the unlocked result copies the
  full rewrite.
- Success and failure are both announced accessibly; clipboard denial does not
  fail silently.
- `result_copied` fires on success.

---

### ACT-15 — Make the unlocked screen the best screen in the product

**Owner:** DES + COPY
**Impact:** Medium-High · **Effort:** M
**Depends:** ACT-04, ACT-07, ACT-14

`app/checkout/success/page.tsx:104-115` renders the paid result as two bare
paragraphs — no check tiles, no protected items, no highlighting, no next
action. The customer has just paid and the product's response is visibly less
than what it showed them for free.

**Touches:** `app/checkout/success/page.tsx`.

**Acceptance criteria:**
- The unlocked view reuses the same check tiles, diff highlighting and
  protected-item evidence as the preview, over the complete text.
- A clear next action returns the customer to the workspace to run another
  draft. Repeat use is a `PRODUCT.md` primary metric and nothing currently
  invites it.
- The billing-portal entry point from ACT-09 is present.
- The honest `confirming` / `delayed` / `signed-out` states are preserved
  exactly as built; this item adds to the unlocked branch only.

---

### ACT-16 — Measure second use as `PRODUCT.md` defines it

**Owner:** ENG
**Impact:** Low-Medium · **Effort:** S
**Depends:** ACT-13

`app/page.tsx:119` fires `second_humanization` on the second *anonymous*
preview within one page session. `PRODUCT.md`'s metric is "Paid users
completing a second successful humanization". These are different populations,
and the counter also resets on reload, so the current number cannot answer the
question it is named after.

**Touches:** `app/page.tsx:119`, `src/lib/analytics.ts` if a property is added.

**Acceptance criteria:**
- The event distinguishes an anonymous repeat preview from a repeat
  humanization by an entitled customer.
- Anonymous repeat previews remain measurable — they are a useful signal — but
  under a name or property that does not claim paid repeat use.
- The definition is written down beside the event so the two are not conflated
  again.

---

## 4. Explicitly rejected hooks

These convert, and they are disqualified. Recording them so they are not
re-proposed later as fresh ideas.

- **A detector score, "AI probability", or "% human" badge.** Rejected by
  D-010 and the README guardrails. `PRODUCT.md` already names
  `99.87% HUMAN` as the anti-pattern. No amount of hedging rehabilitates it.
- **"Passes AI detection" / "undetectable" framing anywhere.** Rejected by
  D-001's exclusion list and the README guardrails. Absolute.
- **A countdown, "3 free previews left today", or any scarcity device on the
  paywall.** `MONETIZATION.md`'s artificial-urgency blocker. Also false: the
  abuse guard is a per-runtime, in-memory limiter
  (`ARCHITECTURE.md`, reliability section), not a metered free allowance, so
  any such counter would be inventing a limit that does not exist.
- **Showing more of the rewrite by sending the full text and masking it in
  CSS.** Rejected in `DECISIONS.md`; `ARCHITECTURE.md` states plainly that
  visual CSS masking is not a lock. The current implementation is correct —
  the browser receives only the preview — and must stay that way.
- **A "free trial" or "first rewrite free" frame.** Contradicts D-001's
  no-permanent-free-tier decision. The anonymous preview is a bounded quality
  preview and should be described as one.
- **Social proof: customer counts, logos, testimonials, "join N writers".**
  There are no customers yet. Fabricating or implying them is disqualified
  outright, and there is no honest version available on launch day.
- **Voice DNA or personalization teasers presented as available.** V1.1 per
  D-001. `pricingConfig` already labels these `(coming later)` on the Pro plan;
  that labeling must survive any future landing-page edit.

## 5. Status of this document

This is a product specification, not a completion record. No milestone or
release gate is closed by anything written here — per `AGENTS.md`'s working
agreement, gate closure is a decision made by the named owners, not
self-granted by an authoring agent.

ACT-01, ACT-02, ACT-03, ACT-09 and ACT-10 are recorded as launch blockers
because each one either presents an unverified or absent rewrite as a product
(ACT-01, ACT-02), removes the core experience for a whole class of visitors
(ACT-03), or trips a dark-pattern blocker already written into
`MONETIZATION.md` (ACT-09, ACT-10). They are stated as blockers by the Product
Orchestrator; whether they in fact block the M4-07 launch authorization is for
that gate's signatories to decide.
