# Signed-in surfaces: header, account page, usage, and sentence controls

Last updated: 2026-08-25
Owner: DES. Status: **plan only. Nothing here is implemented.**
Authority: `docs/BRAND.md` for tokens, motion and the accessibility
invariants; `docs/AGENTS.md` for ownership and gates; `docs/PRODUCT.md` for
scope.

This is a design plan the owner asked for ahead of the work, not a
specification and not a claim that anything shipped. Where a decision is the
owner's, both options are stated and a recommendation is given; the
recommendation is not the decision.

**Why its own document.** `docs/BRAND.md` is a reference: what the brand is,
what the tokens are, what must never regress. It is read to answer "is this
allowed?". This is a forward-looking plan with open questions and a build
order, read to answer "what are we doing next?". Folding several pages of
proposals into the brand authority would make it hard to tell settled fact
from proposal, which is exactly the failure mode BRAND.md's "Unconfirmed
identity" section exists to prevent. BRAND.md gets one cross-reference line
and nothing else.

---

## 0. What is actually true today

Verified in the workspace on 2026-08-25. Everything in this plan is built on
these facts, and several proposals below are shaped by them.

| Fact | Where |
|---|---|
| Magic-link sign-in works. Session cookie `__Host-ownword_session`, 30 days. | `src/lib/identity.ts` |
| `GET /api/auth/session` answers `{ signedIn, email }` for the caller's own cookie. The cookie is HttpOnly, so client code must ask. | `app/api/auth/session/route.ts` |
| Sign-out is `POST /api/auth/signout`. Never a link, by design. | `src/lib/identity.ts` |
| `getSessionUser()` / `requireSessionUser()` exist for server components and **are called by nothing**. No page in this repository has ever server-rendered a signed-in state. | `app/auth.ts` |
| The landing surface is `"use client"` in its entirety, header included — but the **route** is not. SEO handoff H-1 split it: `app/page.tsx` is a server shell that exports `generateMetadata()` and renders `app/landing-page.tsx`. Option B below is therefore cheaper than this document assumed. | `app/page.tsx`, `app/landing-page.tsx:1` |
| Four pages each hand-roll their own `.site-header` with a different nav: `/`, `/signin`, `/history`, `/checkout/success`. `/terms` and `/privacy` have no header at all. | grep `site-header` |
| At ≤760px, `nav a:not(.sign-in) { display: none }`. On mobile the header is the wordmark and **one pill**. | `app/globals.css:1138` |
| A paid rewrite returns `usage: { consumed, allowance, remaining, periodEnd, paidUseCount }`. `/` already prints "N of M words remain this billing period" under a paid result. | `app/landing-page.tsx`, `src/lib/paid-usage.ts` |
| **No endpoint returns usage or entitlement without performing a rewrite.** `describePaidUsage` exists and is called only from the sentence route. | `src/lib/paid-usage.ts` |
| `/api/billing/readiness` reports whether *checkout is configured*, not whether *this caller is subscribed*. It is not an entitlement signal. | `src/lib/billing-readiness.ts` |
| **The entitled rewrite response carries no `jobId`.** `recordOwnedJob` computes one and `completeEntitledRewrite` discards it. | `src/lib/entitled-rewrite.ts:187` |
| History persistence for a paid rewrite is best-effort and can be skipped (`already-recorded`, `write-failed`) without failing the request. | `src/lib/entitled-rewrite.ts` |
| `POST /api/history/{jobId}/sentence` works, is idempotent, caps 3/sentence and 20/job counted on **attempts**, and has no interface. | `src/lib/sentence-operations.ts` |
| Sentence indices are stable across operations: one sentence in, one sentence out, enforced. | `src/lib/humanization/sentence-regeneration.ts` |
| `segmentSentences` lives in a module that statically imports the whole humanization engine. | same file |
| Account deletion is manual by email. PO decision, 2026-08-25. | `docs/AGENTS.md` |

Two of these are load-bearing enough to restate: **there is no way to learn a
signed-in caller's plan or allowance without charging them for a rewrite**,
and **the landing page's paid result cannot address a job by id**. Several
otherwise obvious designs below are blocked on exactly those two gaps.

---

## 1. The signed-in header

### What it replaces

Today: `<Link className="sign-in" href="/signin?return_to=%2F">Sign in</Link>`.

Proposed, when a session exists: the same pill, same class, same position,
reading **Account**, linking to `/account`. One control, not two. No new
visual vocabulary — it is the existing `.sign-in` pill with different text and
a different destination.

### What it shows

**Recommendation: the word "Account", not the address.**

The counter-argument is real and the owner may prefer it: this is a
magic-link product, people have several addresses, and "which account am I
in?" is a question the header could answer for free. Against that:

- Addresses are long and unbounded. The pill is a fixed-height element in a
  flex header that collapses to one control at 760px. `a.very.long.name@some-university.edu`
  either overflows or gets an ellipsis, and an ellipsised address answers the
  question badly.
- It is on screen on every page, in every screen-share and every
  shoulder-surf, in exchange for a question most people ask once.
- Truncating visually while putting the full address in `aria-label` breaks
  WCAG 2.5.3 (the visible label must be contained in the accessible name).
  So the accessible fix for the layout problem is not available.

The address is instead the first line of `/account`, one click away, and is
also stated inline on `/` (§4). If the owner wants it in the header, the
honest form is the full address at ≥760px with the pill dropping to "Account"
below that — two labels for one control, which is worse than one.

**Open decision O-1 for the owner: "Account" or the email address in the
header pill.** Recommendation: "Account".

### What it must not show

- **Remaining words, or any counter.** §3.
- **A plan badge** ("Starter", "Pro"). It implies a tier switcher that does
  not exist, and `pro` is `availability: "announced"` with no checkout path.
- **An avatar, initial, or monogram.** BRAND.md is explicit that no approved
  identity artwork exists. A letter derived from an email address is invented
  identity, and the retired H favicon is the precedent for not doing this.
- **A dropdown menu.** Three destinations do not justify a new interaction
  pattern with roving focus, Escape handling, outside-click dismissal and a
  focus-return contract. `/account` is that menu, as a page, for free.
- **A notification dot or badge.** There is nothing to notify about.

### Where sign-out lives

Not in the header. `POST /api/auth/signout` is deliberately not a link, so a
header sign-out has to be a `<form method="post">` with a button inside a flex
nav that is already one control wide on mobile. And sign-out is a state change
that deserves a moment of intent, not a control adjacent to the one you press
to get to your history.

**Sign-out lives on `/account`,** as the same plain non-JS form POST
`/signin` already uses (`app/signin/page.tsx`, `.signin-signout`). `/signin`
keeps its copy; it is correct there and costs nothing.

### How the header learns there is a session

This is the one genuinely awkward part, because the landing surface
(`app/landing-page.tsx`) is a client component from its first line and the
cookie is HttpOnly. Since SEO handoff H-1 the *route* above it,
`app/page.tsx`, is a server component, which removes the restructuring cost
Option B was charged for below.

**Option A — client fetch.** The header calls `/api/auth/session` on mount,
exactly as `/signin` already does, with the same three-state
`unknown | signed-out | signed-in` model. Cheap, no restructuring, no new
endpoint, proven pattern in this repository. Cost: a returning customer sees
"Sign in" (or a blank) for one round trip on every page load. That is the
precise complaint this whole plan exists to answer, so shipping it as the
final answer is unsatisfying — though shipping it *first* is defensible.

**Option B — server-rendered.** `app/page.tsx` is already the server component
this option asked for; it would call `getSessionUser()` and render
`<SiteHeader user={…}/>` above `<LandingPage/>`, passing the existing client
body through as a prop (the standard RSC pattern for a server node inside a
client tree). No flash, no round trip, no client-side session
handling at all. `app/layout.tsx` is already an async server component reading
`headers()`, so the route is already dynamic and nothing regresses there.

**Recommendation: B, with A as the fallback.** With one honest caveat:
`getSessionUser` has never run in this deployment. Before committing to B,
spend an hour proving a server component can resolve a session on the
Cloudflare Worker under vinext. If it cannot, take A and accept the flash.

If A is taken, the header must not claim either state until it knows. Reserve
the pill's width and render nothing claim-y in the `unknown` state — a pill
that says "Sign in" and then silently becomes "Account" while a keyboard user
has it focused is a label changing under the user's hands.

### Prerequisite: one header, not four

`/`, `/signin`, `/history` and `/checkout/success` each hand-roll
`.site-header` with a different nav. Adding a signed-in state to four copies
is how they drift. **Extract `SiteHeader` first** (`src/components/`, DES-owned
per the MEMORY.md ownership table). It is a pure refactor, it is cheap, and it
is the prerequisite for everything else in §1 and §4.

Signed-in nav per page, once extracted:

| Page | Signed out | Signed in |
|---|---|---|
| `/` | How it works · Pricing · **Sign in** | How it works · Pricing · **Account** |
| `/history` | Rewrite another draft | Rewrite another draft · **Account** |
| `/signin` | Back to the rewriter | Back to the rewriter |
| `/checkout/success` | (none) | **Account** |

At ≤760px only the pill survives on all of them, which is already true and is
another argument for `/account` being the hub.

---

## 2. The MVP profile

### Route: `/account`

**Recommendation: `/account`, not `/profile`.** Three reasons, in order of
weight:

1. **"Profile" is a word this product will want for something else.**
   `pricingConfig.plans.pro.plannedFeatures` includes "Voice DNA" and
   "Multiple voice profiles". Spending `/profile` on a billing-and-address
   page now means either renaming it later or living with `/profile` and
   `/profiles` meaning unrelated things.
2. **"Profile" implies authored identity.** A profile is something you fill
   in: a name, a picture, preferences. This page has none of that and will not
   for a while. The route would promise a capability that does not exist,
   which is the same class of mistake as a plan badge with no tier switcher.
3. `/account` is the conventional home for subscription state, and it reads
   correctly as a Stripe portal return URL.

### What v1 contains

The honest minimum, and it is smaller than the candidate list, because two of
the candidates cannot be rendered truthfully yet.

**v1 (buildable today, no server change):**

- The address: "You are signed in as `you@example.com`."
- **Your rewrites** — link to `/history`.
- **Manage or cancel subscription** — the existing `<ManageBilling returnTo="/account" />`.
- **Sign out** — the plain form POST.
- A line pointing at `support@ownword.pro` for account deletion, matching the
  PO decision and the wording already on `/terms`.

**Deliberately NOT in v1: plan, price, and allowance.** Not because they are
unimportant — they are the most useful things on the page — but because
`pricingConfig` is a static catalog and rendering "Starter · $9.99/month" for
a signed-in visitor who never subscribed, or who lapsed, is a false statement
about their account. There is no endpoint that says whether *this* caller is
entitled. So plan and allowance wait for §3's endpoint, and v1 ships without
them.

This is not a hollow page even so. It gives sign-out a home for the first
time, it gives billing a home that is not buried in `/terms`, and it is where
the header pill has to land. `ManageBilling` already answers the
non-subscriber case honestly on its own ("This account has no subscription
yet, so there is nothing to cancel. Nothing is being charged."), so the page
tells the truth in every state without knowing entitlement.

**v2 (after `GET /api/account`):** plan name and price, and one sentence of
allowance — see §3.

### What is left out, and why

- **Delete account.** PO decision: manual by email. Not a design gap.
- **Change email address.** There is no re-verification flow, no way to move
  a Stripe customer between addresses, and no repository code for either.
  Building the button first would be designing a capability that does not
  exist.
- **Display name, avatar, timezone, notification preferences.** No user
  settings store exists. Each would be a schema change plus an endpoint plus a
  privacy statement, in exchange for nothing the product does with the value.
- **A default writing mode.** Genuinely reasonable and genuinely wanted later
  — but it is the same missing settings store, and a preference that silently
  fails to persist is worse than no preference.
- **Invoices and payment method.** The Stripe Billing Portal owns these and
  does them better. Duplicating them means reconciling two truths.
- **Anything resembling a dashboard.** No charts, no "words rewritten to
  date", no streaks. Those numbers exist only as engagement decoration, and
  BRAND.md's copy rules forbid invented metrics.

---

## 3. Where usage belongs

The tension is stated correctly in the brief: a permanently visible quota is
anxiety, a hidden quota is a surprise 429 mid-task. The resolution proposed
here is that usage appears **where it just changed** and **where you went to
ask**, and nowhere else.

**Result surface — keep it. Already built.** `/` prints "N of M words remain
this billing period" under a paid result. This is the right place and the
right moment: the number is on screen because it just moved, which is the same
causal principle BRAND.md applies to motion. No change proposed.

**`/account` — add it, in v2.** One sentence, not a gauge: "You have used
`consumed` of `allowance` words this period. Your allowance resets on
`periodEnd`." This is the canonical place, available on demand, costing
nothing to anyone who does not go looking.

Not a meter, not a progress bar, not a ring. A bar makes 6% and 96% look like
the same kind of fact, needs a text equivalent for screen readers anyway, and
is new visual vocabulary for one number.

**Header — no.** Reasons, cumulatively:

- It is the anxiety pattern by construction: a number that can only go down,
  visible at all times.
- It would need entitlement + usage fetched on every page load for every
  visitor, including strangers who have neither.
- At ≤760px the header is one pill wide. There is no room.
- 50,000 words/month is roughly 165 rewrites at the 300-word cap. For most
  customers the number is irrelevant almost always.

**The honest cost of that choice**, stated plainly: with no header counter and
no proactive warning, the first time a customer learns they are near the limit
is the 429. Today that 429 is at least well-worded — `/` appends remaining
words and the renewal date to the error. It is still a surprise.

**The mitigation is a threshold, not a counter.** When `remaining` falls below
a threshold, say so once, in the surfaces that already exist: under the paid
result where usage is already printed, and on `/` above the Humanize control
on a later visit. Copy stays factual — "About `remaining` words left this
period. Your allowance resets on `periodEnd`." — with no upgrade CTA, because
`pro` cannot be bought (`availability: "announced"`, no checkout path).
Offering an upgrade at the limit would be selling something that does not
exist, and it is the exact moment where doing so would be most tempting.

**Open decision O-2 for the owner: is there a low-allowance notice, and at
what threshold?** Recommendation: yes, at `remaining < 10%` of allowance
(5,000 words ≈ 16 rewrites of headroom), shown as a status line and never as a
modal or a banner that must be dismissed. Note that the notice on page load is
*not* free — it needs the endpoint below.

**Dependency for all of the above (v2 and the threshold): `GET /api/account`.**
ENG-owned (`app/api/**`). Returns, for the caller's own session only:

```
{ email, entitled, plan: { id, name, monthlyPrice, wordLimit } | null,
  usage: { consumed, allowance, remaining, periodEnd } | null }
```

It composes two functions that already exist — `getActiveEntitlement` and
`describePaidUsage` — and adds no engine work. It is the single unlock for
plan display, allowance display, the threshold notice, and the
entitlement-aware line in §4.

---

## 4. Landing on `/` with a live session

**What not to do: turn `/` into a dashboard.** A subscriber arriving at `/` is
there for the same reason a stranger is — they have a draft to paste. Paste →
preview → evidence is the product, and it is identical for both. Replacing the
hero with account widgets would take the workspace off the first screen to
show a customer facts they did not come for.

Note also that the unlock card already does the right thing with no change:
the server returns a `PaidResult` for an entitled caller, the union makes
`shouldOfferUnlock` unreachable on that branch, and no price is ever shown to
someone who already pays. **Nothing to fix there** — worth saying, because
"hide the paywall for subscribers" is the obvious first idea and it is already
handled server-side.

**What to do — three things, in ascending cost:**

1. **The header pill** (§1). This alone is most of the fix. It is the
   difference between a page that does not know you and a page that does.

2. **One status line under the workspace topline.** Reuses `.status-line`,
   which already exists and already carries this kind of message on `/signin`
   and `/history`.

   - Signed in, entitlement unknown (v1, needs nothing new):
     "Signed in as `you@example.com`. <Your rewrites>"
   - Signed in and entitled (v2, needs `GET /api/account`):
     "Signed in as `you@example.com`. Full rewrites are unlocked and count
     toward your monthly allowance. <Your rewrites>"
   - Signed in, not entitled: the v1 line only. It must **not** say rewrites
     are unlocked.
   - Signed out: nothing. No element, no space reserved.

   The three-variant split is the whole point: signed-in and paying are
   different states, and collapsing them would tell a lapsed customer their
   rewrites are unlocked right before the server withholds one.

3. **The low-allowance line**, if O-2 says yes. Same slot, only when the
   threshold is crossed.

**Not proposed:** rewriting the `#pricing` section for subscribers. Its
headline addresses a stranger ("Try the quality. Pay for the full result."),
which is slightly odd for a paying customer scrolling past. Fixing it means a
second copy of a section COPY owns, for a low-traffic scroll position. Left
alone deliberately; revisit if it ever bothers anyone.

---

## 5. Sentence controls (M3-02 / M3-07 surface)

The largest piece. A sketch with explicit states, not a specification.

### Where it can go, and where it cannot

`POST /api/history/{jobId}/sentence` addresses a job by id. **The landing
page's paid result has no `jobId`** — `completeEntitledRewrite` computes one
and returns everything except that. So today the only surface where sentence
controls can exist at all is **`/history`, on an opened rewrite**, whose
detail response is `HistoryEntry & UnlockedResult` and does carry `jobId`.

Build there first. Extending to `/` needs one small ENG change (return the
`jobId`, nullable), plus an honest degradation: history persistence for a paid
rewrite is best-effort and can be skipped, and on an idempotent retry
`recordOwnedJob` returns `null` even though a row exists. So the landing
result must handle "no job id" by rendering exactly today's read-only result.
Controls that appear only sometimes are acceptable; controls that appear and
then 404 are not.

### The rendering problem, and the way around it

The Humanized panel renders a **word-level diff**. Sentence boundaries do not
align with diff segments, and `MarkedText` computes `ins` ordinals and fact
marks across the whole segment list. Wrapping sentences around that means
splitting segments at sentence boundaries and perturbing the ordering that
drives the mark animation. It is possible. It is not cheap and it will produce
bugs in the one surface whose whole job is being trustworthy about what
changed.

**Recommendation: two views, not one merged view.** The opened rewrite gets a
toggle using the existing `.mode-group` pattern (`role="group"`, `aria-pressed`
buttons) — no new visual vocabulary:

- **Compare** (default): today's marked diff, byte-for-byte unchanged. The
  evidence view.
- **Edit sentences**: the rewrite alone, no diff marks, segmented into
  sentences with controls. The workspace view.

One is for judging, one is for changing. Neither is degraded to accommodate
the other.

**The trade-off, stated plainly:** the customer has to switch views to see
whether a regenerated sentence changed the diff, and the editing view breaks
prose into rows so it stops reading as a paragraph. The alternative — inline
controls in continuous prose — keeps the reading experience and clutters every
sentence with a persistent affordance (it cannot be hover-only; hover is not
keyboard reachable).

**Open decision O-3 for the owner: separate "Edit sentences" view, or inline
controls in the prose.** Recommendation: the separate view, first, because it
is the one that does not risk the diff surface.

### The editing view's markup

An ordered list, one row per sentence, reusing the `.history-item` /
`.history-actions` shape that already exists on this page.

- The sentence renders as **plain text, not a button**. A 30-word button is a
  30-word accessible name, and making the text a control makes it awkward to
  select and copy.
- Each row carries its own controls in DOM order: **Regenerate** and **Restore
  original**. Real `<button>`s, always rendered, always focusable, no hover
  dependency.
- A visually hidden "Sentence 3 of 12" prefix per row, so a screen-reader user
  has the index the caps and messages refer to.
- Rows are keyed by **sentence index**, never by sentence text. Indices are
  stable by the one-sentence-in-one-sentence-out invariant; keying by text
  remounts the row on every applied change and drops focus to `<body>`, which
  is the exact failure BRAND.md's `aria-disabled` rule exists to prevent,
  arrived at by a different route.

**Restore in v1: always offered.** Knowing whether a given sentence differs
from the original requires per-index revision provenance the client does not
have on a fresh page load, and diffing `original` against `result` at sentence
granularity is unreliable because their sentence counts can differ. Restore is
free and the server answers `unchanged` for a no-op, so offering it always
costs a wasted click and never a wasted word. Hiding it on a guess would
sometimes hide it wrongly.

### States

One operation at a time across the whole opened rewrite — a single guard, not
one per row. The server's revision chain is linear (`parentRevisionId` = head)
and two concurrent operations race on it.

| State | Trigger | What the customer sees |
|---|---|---|
| **idle** | — | Regenerate · Restore original. If counts are known from a prior response, "2 of 3 left for this sentence". |
| **in-progress** | click | Every control on the surface gets `aria-disabled="true"` and the JS re-entrancy guard. Existing `.dot-loader` in the row. Live region: "Rewriting sentence 3." |
| **applied** | 200, `outcome: "applied"` | Re-render **from the server's `result`**, never patched locally. New sentence gets the existing `--mark-add-*` treatment, fading. Live region: "Sentence 3 rewritten. `chargedWords` words used. `remaining` of `allowance` words remain this billing period." Usage line on the surface updates from `usage`. |
| **unchanged** | 200, `outcome: "unchanged"` | "No different version was found. Nothing was charged, and you have `3 − used` tries left for this sentence." Both halves matter: the caps count **attempts, not successes**, so this attempt did consume a try. Saying only "nothing was charged" would be true and misleading. |
| **rejected** | 422 | "That version did not pass the meaning check, so it was not used. Nothing was charged." Same tries-left sentence. `role="status"`, not `role="alert"` — this is an expected outcome of a deliberate action, not a failed request. |
| **cap: sentence** | 429, `limit: "sentence"` | "You have used all 3 rewrites for this sentence." Regenerate becomes `aria-disabled`, stays in the DOM, reason adjacent. Restore stays available — it is free and uncapped. |
| **cap: job** | 429, `limit: "job"` | "You have used all 20 sentence rewrites for this rewrite." All Regenerate controls `aria-disabled`. |
| **cap: allowance** | 429, `limit: "allowance"` | "You have used this month's word allowance. It resets on `periodEnd`." **No upgrade CTA** — see §3. |
| **pending** | 409, `{ pending: true }` | "That change is still being applied. Try again in a moment." |
| **unavailable** | 503 | "Sentence editing is unavailable right now. No usage was charged." |
| **key reuse** | 409 | Should be unreachable: it means the client reused an idempotency key for a different sentence or action. If it happens it is a bug, and the copy should say so rather than blame the customer. |

**Idempotency.** Every request needs `x-idempotency-key` matching
`/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/`. Mint one `crypto.randomUUID()` per
*attempt*; reuse it verbatim on a retry of that same attempt — that is the
whole point of the header — and never across sentences or actions. The
existing `idempotency` ref in `app/landing-page.tsx` is the precedent.

**Cap counts before the first click.** A response carries
`regenerationsUsedForSentence` and `regenerationsUsedForJob`, so after one
operation the UI knows both without another request. On a freshly loaded page
it knows neither. v1: show the counter only once known, and never guess.
Better: the history detail response grows the per-index revision counts (small
ENG change, §7 item 8).

### Prerequisite: a client-safe sentence segmenter

The client must index sentences **identically to the server** or "regenerate
sentence 4" edits the wrong sentence. `segmentSentences` / `sentenceAt` /
`sentenceCount` live in a module that statically imports `analyzeWriting`,
both deterministic providers, the protected-content extractor and the pipeline
config — importing it client-side pulls the humanization engine into the
browser bundle.

Two ways out:

- **Extract the segmenter into a dependency-free leaf module** that both sides
  import. One source of truth for boundaries, nothing on the wire, and the
  client can re-segment locally from the `result` the server returns after
  each applied change. Behaviour must not change; `docs/AGENTS.md` records that
  a segmentation which can lose text is a correctness hazard here.
- **Have the detail endpoint return the sentence array.** No shared code, more
  bytes, and a second place boundaries are decided.

**Recommendation: extract the leaf module.** HE/ENG-owned, small, and it is a
hard blocker on the whole of §5.

---

## 6. Accessibility

BRAND.md's invariants apply everywhere below and are not restated per item:
`aria-disabled` plus a JS re-entrancy guard and never native `disabled`;
explicit focus management when async content replaces a focused element;
`aria-live` regions present in the DOM *before* the message arrives; a visible
focus indicator on every control; and anything added must survive
`prefers-reduced-motion: reduce` fully visible.

**Header.** The pill is a link with the existing `.sign-in` focus treatment —
inherit it, do not invent a sibling. The accessible name is the visible text
("Account"), with nothing extra bolted on via `aria-label`. If the client-fetch
option is taken, the `unknown` state renders no claim and reserves the pill's
width; a label that changes under a focused control is the thing to avoid.

**`/account`.** One `h1`, sections under `h2`, in order. Sign-out is a plain
non-JS `<form method="post">` — no guard needed because the browser owns the
submission, which is why `/signin` does it that way and why it should stay
that way. `ManageBilling` already carries its own `role="status"` region and
its own guard.

**Usage sentence.** Plain prose. No meter, so no text-equivalent problem. If a
meter is ever added it needs `aria-valuetext` and a visible number anyway,
which is most of the reason not to add one.

**Landing status line (§4).** It arrives after a client fetch, so its
container must be in the DOM from first render with `role="status"` and be
filled later — a region inserted together with its message is not announced.
Do **not** reuse `.result-announcer`; that region owns result text and is
`aria-atomic="false"` for that reason. A separate always-present container by
the workspace topline.

**Sentence controls.**

- Every control reachable and operable by keyboard with no hover dependency.
  This is the reason for the list layout over hover-revealed affordances.
- One always-present `role="status"` region per opened rewrite for outcomes;
  one `role="alert"` only for a request that failed outright (503, network).
- During an operation, controls take `aria-disabled="true"` and keep focus.
  The pressed control is precisely the one a native `disabled` would strand.
- On **applied**, focus stays on the pressed control — it still exists, so do
  not steal focus; the live region does the announcing. Explicit
  `tabIndex={-1}` + `.focus()` is for the case where the focused element is
  removed, which this design deliberately avoids by keying rows on index.
- Cap-reached controls stay in the DOM as `aria-disabled` with the reason
  adjacent. Removing the control removes the explanation.
- The applied-sentence highlight uses the existing `--mark-add-*` tokens. Under
  reduced motion it must remain a legible static mark, not vanish.
- The Compare / Edit toggle is `role="group"` with `aria-pressed` buttons,
  matching `.mode-group`. Switching views must not lose the customer's place;
  announce the switch in the status region.

**Coverage.** `tests/e2e/accessibility.e2e.test.mts` is where these get
enforced; it is MQA-owned (`tests/e2e/**`) and nothing here should be
considered done without it. Note that these are new invariants for MQA to
cover, not existing coverage being reused.

---

## 7. Sequencing

Cheap means DES-only, no server change, hours not days.

**Phase 1 — cheap, unblocks the rest**

1. **Extract `SiteHeader`.** Pure refactor of four hand-rolled copies. Cheap.
   Prerequisite for 3 and 4.
2. **`/account` v1** — address, History link, `ManageBilling`, sign out,
   deletion-by-email note. No plan, no allowance. Cheap. Ships real value on
   its own: sign-out and billing finally have a home.
3. **Signed-in header pill → `/account`.** Cheap once 1 lands. Do the
   `getSessionUser`-in-an-RSC spike first (§1); fall back to the client fetch
   if it fails.
4. **Landing status line, v1 wording only** ("Signed in as …"). Cheap.

Phase 1 answers items 1, 2 and 4 of the brief at a v1 level with zero server
changes.

**Phase 2 — small ENG dependencies, each unlocking something specific**

5. **`GET /api/account`** (ENG). Composes `getActiveEntitlement` +
   `describePaidUsage`. Small. Unlocks: plan and allowance on `/account`
   (§2 v2), the entitlement-aware landing line (§4), and the threshold notice
   (§3). This is the highest-leverage server change in the plan.
6. **Return `jobId` from `completeEntitledRewrite`** (ENG). Roughly one line
   plus a type, nullable. Unlocks sentence controls on `/` later. Trivial.
7. **Extract the sentence segmenter into a dependency-free module** (HE/ENG).
   Small in diff, careful in review — it must not change boundaries. **Hard
   blocker on §5.**
8. **History detail returns per-sentence revision counts** (ENG). Small.
   Improves cap honesty; not a blocker, since v1 shows counts only once known.

**Phase 3 — the expensive part**

9. **Sentence controls on `/history`** — the two-view toggle, the row layout,
   nine states, live regions, idempotency, focus discipline. Depends on 7,
   improved by 8. **This is not cheap.** It is the largest single item here,
   larger than everything in Phase 1 combined, and the state table in §5 is a
   sketch, not a spec.
10. **Sentence controls on `/`.** Depends on 6 and 9, plus the honest
    degradation when there is no `jobId`. Moderate once 9 exists.
11. **Low-allowance threshold notice.** Depends on 5 and on decision O-2.
    Cheap once both land.

**Honest read on cost:** Phase 1 is a day or two and delivers the header, the
account page and the "this page knows you" line. Phase 2 is small ENG work
that DES cannot do (`app/api/**`, `src/lib/humanization/**` are ENG/HE-owned
per `docs/MEMORY.md`) and must be requested, not assumed. Phase 3 is the real
project.

---

## 8. Open decisions for the owner

| | Decision | Options | Recommendation |
|---|---|---|---|
| **O-1** | Header pill label | "Account" · the email address | "Account". Address on `/account` and in the landing status line. |
| **O-2** | Low-allowance notice | none · threshold notice · always-visible counter | Threshold notice at `remaining < 10%`. Never a permanent counter. |
| **O-3** | Sentence editing surface | separate "Edit sentences" view · inline controls in prose | Separate view first; it does not put the diff surface at risk. |

Secondary, lower stakes: whether `/account` v1 ships before `GET /api/account`
exists (recommended: yes), and whether `#pricing` gets subscriber-aware copy
(recommended: no, leave it).

---

## 9. What this plan does not propose

Stated explicitly, because a plan that only lists additions is not a plan.

- **No delete-account control.** PO decision, manual by email.
- **No header usage counter**, no meter, no gauge, no ring.
- **No dropdown menu**, no avatar, no initial, no monogram, no badge.
- **No dashboard on `/`.** The rewriter stays the first screen.
- **No upgrade CTA anywhere**, least of all at the allowance limit. `pro` is
  announced and cannot be bought.
- **No change-email, no display name, no stored preferences** — including a
  default writing mode, which is reasonable and still blocked on a settings
  store that does not exist.
- **No invoice or payment-method UI.** The Billing Portal owns it.
- **No merging** of the diff view and the sentence-editing view.
- **No change to `/signin`.** Its sign-out stays.
- **No new colours, shadows, radii, easings or animations.** Everything above
  is composed from tokens and patterns already in `app/globals.css`.
- **No engagement metrics** of any kind.

## 10. Status

Plan only. No milestone is claimed and no gate is closed. M3-02 remains
partial and M3-07 remains open; both are PO's to close, not DES's. Nothing in
this document has been implemented, and no `app/**`, `src/**`, `db/**` or
`tests/**` file was modified to write it.
