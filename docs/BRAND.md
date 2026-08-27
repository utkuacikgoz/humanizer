# Ownword Brand Authority

Last updated: 2026-08-27

## Confirmed identity

- Product name: Ownword
- Canonical domain: `ownword.pro`
- Legal operator: Bosphorus Elevate LLC
- Support address: `support@ownword.pro`
- Internal codename and repository name: `humanizer`
- Product role: a writing tool that makes generic AI assisted drafts sound natural while preserving meaning

`src/config/product.ts` is the application source of truth. Customer-facing UI, metadata, structured data, legal pages, tests, and documentation must use Ownword consistently. The internal codename may remain in package names, analytics event namespaces, database comments, benchmark identifiers, and generic search terms where it is not presented as the brand.

## Unconfirmed identity

The following are not confirmed and must stay absent from public claims until the founder or Legal supplies them:

- Social handles
- Official logo, symbol, favicon, or wordmark artwork
- Approved trademark treatment

The repository therefore uses a plain text Ownword wordmark. It does not present a generated monogram or a third party asset as an official logo. Completed legal pages use the centralized operator and support values and are indexable only on the canonical host.

## Public copy rules

- Lead with meaning preservation and natural writing.
- Describe detector limitations honestly. Never promise bypass, undetectability, or a guaranteed detector result.
- Do not invent customer counts, testimonials, scientific precision, provider claims, or available features.
- Use short, direct sentences. Avoid em dashes and en dashes in landing page copy.
- Avoid hyphenated marketing phrases on landing pages when plain wording is clearer, such as `AI assisted`, `meaning preserving`, and `privacy safe`.
- Use `humanizer` only as a generic product category or search phrase when needed for discoverability, not as Ownword's display name.

## Asset audit

The prior custom favicon used an H symbol and was retired because it represented the former display identity. The existing social image contains product copy and an abstract before and after composition, but no competing name or logo, so it remains usable. It must be replaced if approved Ownword visual assets establish a conflicting system.

On 2026-08-24, `https://ownword.pro/` resolved to Hostinger's parked domain page. It contained Hostinger copy and assets only, not an Ownword product identity. Nothing from that page is an authoritative Ownword logo or copy source.

## Design system

Owner: DES. Implemented in `app/globals.css` (116 custom properties) and
consumed by `app/landing-page.tsx`, `app/layout.tsx`, `app/checkout/success/page.tsx`,
`app/privacy`, `app/terms`, and `src/components/**`.

### Tokens

Colour is grouped by role, not by hue, so a surface and the ink on it are
always chosen from the same set:

| Group | Tokens | Use |
|---|---|---|
| Ground | `--paper`, `--paper-sunken`, `--surface`, `--surface-veil` | page, recessed panels, raised cards, glass |
| Ink | `--ink`, `--ink-2`, `--ink-3` | primary, secondary, meta |
| Brand | `--green`, `--green-dark`, `--green-bright`, `--green-lift`, `--mint` | brand ink, hover, soft fill |
| Inverse band | `--band`, `--band-2`, `--band-ink`, `--band-ink-2`, `--band-accent`, `--band-cta` | pricing section, deep in **both** themes |
| Accent | `--clay`, `--clay-bright`, `--clay-soft` | accent ink; `--clay-bright` is fill only, never small text |
| Diff marks | `--mark-cut-*`, `--mark-add-*`, `--mark-fact-*` | the comparison surface |

Never write a colour literal in a component. The inverse band is the one place
where ground does not flip with the theme — text there always comes from the
`--band-*` set.

### Contrast

WCAG AA for all text, verified against every gradient colour stop across `/`,
`/privacy`, `/terms`, `/checkout/success` in both themes at 360/390/768/1440,
in the driven result state.

A caution for anyone re-auditing: a naive checker that resolves an element's
background by walking up to the nearest non-transparent ancestor **will report
false failures** on this design. Elements over gradients and over the inverse
pricing band inherit a ground that is not what is actually painted. One such
audit reported the dark-theme pricing card at 1.12:1; a screenshot shows white
on deep green, comfortably passing. Verify a suspected failure visually before
treating it as one.

### Motion

Motion is causal only — it exists to explain a change, never to decorate.
Eight keyframe animations: hero entrance, result-card arrival, comparison
panels entering from their own sides, and change-marks lighting in reading
order.

`prefers-reduced-motion: reduce` zeroes duration, delay, and iteration count,
and disables smooth scrolling. Anything added later must survive that block
leaving the element fully visible.

**Deliberately removed, do not reintroduce:** a scroll-reveal system
(`[data-reveal]` + IntersectionObserver) and an infinite pulse on the lock
badge. The reveal was both a generic-template tell and a correctness bug — any
render where the observer did not fire left whole sections blank, which is how
a screenshot of the live page came back with an empty comparison panel.

### Accessibility invariants

These are load-bearing. Do not "simplify" them away:

- **`aria-disabled` plus a JS re-entrancy guard, never the native `disabled`
  attribute.** A natively disabled element that currently holds focus sends
  focus to `<body>`, stranding keyboard users mid-flow.
- **Explicit focus management** (`tabIndex={-1}` plus `.focus()`) when async
  content replaces the element that had focus.
- **`aria-live` regions that already exist in the DOM** before the content
  arrives; a region inserted together with its message is not announced.
- Every interactive control keeps a visible focus indicator.

`tests/e2e/accessibility.e2e.test.mts` covers these. Playwright and Chromium are
installed in the project, and the release gate requires zero skipped browser
tests; a run reporting any skip is not accepted as green.

### Private surfaces

`/signin`, `/history`, `/checkout/success` and the cross-device confirmation
page (`src/lib/magic-link.ts`) were reworked on 2026-08-27. No new token, type
family or spacing step was introduced; everything below is the existing system
applied where it had not been.

- **No step number outside the rewrite sequence.** `.step-number` encodes
  position (01 paste, 02 read, 03 pay). All three surfaces carried one anyway
  — 00, 03, 04 — which is the same mistake `.why` already refuses to make.
  `tests/private-surface-quality.test.mjs` now fails if one returns.
- **The primary control on a private surface takes the `--band-*` set**:
  `--band` ground with `--band-ink` on paper, `--band-cta` with `--band` on
  the dark theme. The action is always the inverse of the ground it sits on,
  which is one decision rather than two, and it keeps a saturated mint slab
  off the muted deep-green ground. The ledge stays unique to
  `.humanize-button`, as that rule already claimed.
- **`--font-read` is for prose the customer wrote or that we rewrote.** The
  email field was set in it, at display size, while its own label was mono.
  Credentials and controls belong to `--font-ui`.
- **Rules separate things that differ in kind.** `/signin` has one, between an
  existing session and a fresh sign-in. It had four.
- **`.surface-note` / `.surface-gate` / `.surface-alert`** are the shared
  state vocabulary for `/history` and `/checkout/success`. A routine gate
  ("sign in to see this") is not painted in the colour of a failure.
- The confirmation page cannot link `app/globals.css` — no external asset, and
  it answers at the URL the mail client opened — so it mirrors the tokens it
  needs as custom properties, named as they are here. `--font-display` is a
  system serif stack and needs no webfont, so it is the one face that carries
  across unchanged.

### Pricing band

Reworked 2026-08-27, in the same pass. The band is still the inverse band and
still uses only `--band-*` ink.

- The three features both plans deliver are stated once, above the cards. They
  used to be three of four bullets in each card, identical, which asked the
  reader to diff two lists to find the one line that differs.
- That line, the monthly allowance, is now the largest thing on each card,
  set in `--font-display` at `--t-3xl` with `tabular-nums`. It was the fourth
  bullet.
- Roadmap rows sit in the card with a `Planned` status pill leading each row.
  See docs/MONETIZATION.md for what makes that safe and what is tested.
- Urgency is only ever a fact read out of the running application: the
  visitor's own unread word count, which is absent when there is no result,
  and `PREVIEW_LINK_TTL_MS` from `src/config/retention.ts`, which is the same
  constant `db/repository.ts` stamps on the capability token. Nothing is
  invented, and a second copy of either number fails the build.

### Planned signed-in surfaces

`docs/SIGNED-IN.md` is the DES plan for the signed-in header, the `/account`
page, where allowance is shown, and the sentence-control surface. It is a plan
and not a record of implementation; nothing in it has been built.
