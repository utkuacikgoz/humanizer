# Ownword Brand Authority

Last updated: 2026-08-24

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
consumed by `app/page.tsx`, `app/layout.tsx`, `app/checkout/success/page.tsx`,
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

`tests/e2e/accessibility.e2e.test.mts` covers these. Note that the E2E suite
skips silently when its Chromium build is missing and still reports `ok` —
check `# skipped` before trusting a green run.
