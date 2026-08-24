# Working Memory

Owner: MEM. Authority for how agents spend context and how concurrent agents
share this repository.

Every rule below is here because it cost something. None of it is general
advice — each one is a mistake this project actually made, written down so it
is made once.

## 1. Token and context discipline

D-014 is the decision; this is how to honour it.

**Terse output.** Bullets over prose. Do not restate the request back, do not
narrate what you are about to do, do not summarise what the user just read.
A reply that repeats the task before answering it wastes the most expensive
tokens in the exchange.

**Comments earn their place.** One line, and only for a non-obvious *why*.
The code says what it does; a comment that repeats it is noise the next reader
pays for. Comments explaining a subtle invariant or a past bug are the
exception and are worth keeping — several in `db/usage-ledger.ts` and
`src/lib/chatgpt-identity.ts` exist to stop someone reintroducing a race or an
auth bypass.

**Do not re-read what you already have.** Re-opening a file you read this
session, re-deriving a fact already established, or re-listing a directory you
just listed are all pure cost. The harness tracks file state; an Edit that
would fail tells you so.

**Delegate mechanical work to cheaper models.** Grepping, inventorying,
gathering call sites, and running lookups do not need the strongest model.
Judgement-heavy work — design, security reasoning, concurrency, copy — does.

**Scope subagent prompts precisely.** A cold agent re-derives everything you
already know. Give it the verified state (test counts, known gotchas, file
ownership) so it does not spend a third of its budget rediscovering that
`cloudflare:workers` will not resolve under plain Node.

**Prefer targeted reads.** `sed -n '120,160p'` over reading a 400-line file,
`grep -n` over opening to look. Read whole files when you genuinely need the
whole file — reviewing a diff for correctness is not the place to economise.

**Never read a subagent transcript file.** It is the full JSONL and will
overflow the context it was meant to save.

## 2. Two agents, one repository

Claude and Codex both commit here. Every rule in this section exists because
we collided.

### Pull before you merge

Always `git fetch origin main` and merge it into your branch **before**
opening a PR. Main moves while you work.

A merge conflict in `app/api/humanize/route.ts` came from both sides changing
the same region — main replaced the in-memory request guard with the D1-backed
one while this branch added the quota gate ahead of it. It resolved cleanly by
keeping both, but only because it was found before merging rather than after.

### Commit the lockfile with the dependency

CI was red for three consecutive runs, on main included, every one dying in
about twenty seconds:

```
npm error Missing: webpack@5.109.2 from lock file
```

`package.json` and `package-lock.json` had drifted. `npm install` silently
reconciles them, so it passed locally for everyone; `npm ci` refuses to,
because reproducible installs are the whole point of it. A drifted lockfile is
invisible on every developer machine and visible only in CI.

**If you change dependencies, run `npm install` and commit the regenerated
`package-lock.json` in the same change.**

### Declare file ownership before running agents in parallel

Six agents ran at once here. It worked only because each was told, explicitly
and by path, which files were its own and which belonged to someone else
*currently editing them*. Without that they overwrite each other silently.

A workable split from this project:

| Agent | Owns |
|---|---|
| ENG | `app/api/**`, `db/**`, `src/lib/**`, `scripts/**`, `vite.config.ts` |
| DES | `app/page.tsx`, `app/globals.css`, `app/layout.tsx`, `src/components/**` |
| COPY | the same page files as DES — so **never run them concurrently** |
| SEO | `app/robots.txt/**`, `app/sitemap.xml/**`, `app/privacy/**`, `app/terms/**`, `docs/SEO.md` |
| MQA | `tests/e2e/**`, `docs/QA.md` |
| SEC | `docs/SECURITY.md` only — a security review is findings, not edits |

Sequence agents that share files. DES had to wait for COPY to release
`page.tsx`; that was correct, and running them together would have lost work.

### Assume the session can die mid-run

Agents were killed by usage limits four times, several with substantial
uncommitted work in the tree. What survived, survived because the tree was
verified and committed at the next opportunity.

When an agent stops unexpectedly: check `git status`, run lint/typecheck/tests,
and commit whatever is green before starting anything new. Label it as
in-progress in the commit message rather than overstating it.

## 3. Verify before you report

**Do not trust an agent's report.** Several were accurate; several were not.
A DES run reported "0 WCAG failures" and was right. An ENG run reported
"110/110 passing" and was right. Both were checked.

**Check your own tools before blaming the code.** An independent contrast
audit reported 56 failures, including the dark pricing card at 1.12:1. The
audit was wrong: resolving a background by walking to the nearest
non-transparent ancestor misreads elements over gradients and over the inverse
pricing band. Screenshots showed white on deep green. Reporting those 56 as
regressions would have sent someone chasing a design bug that did not exist.

**A green summary is not proof the tests ran.** The E2E suite reported
`31 tests / 31 pass / 0 fail` while executing nothing — Playwright's pinned
Chromium build was missing, so every test skipped, and a skipped test reports
`ok`. Check `# skipped` before believing a green E2E run.

**A concurrency test proves nothing unless it fails against a naive
implementation.** Before trusting `tests/usage-ledger.test.mts`, a deliberately
naive read-then-write reservation was run against the same scenario: it
admitted 20 of 20 against a 10-admission ceiling. That is what makes the
passing result meaningful.

**Verify against the real thing, not from memory.** Stripe's API shape was
checked against the installed SDK's own types rather than assumed —
`current_period_start` lives on the subscription *item*, and an invoice's
subscription id is nested under `parent.subscription_details`. Both differ from
what a confident guess would produce.

## 4. Repository gotchas that will cost you an hour

- **`cloudflare:workers`, `next/headers`, and `next/navigation` do not resolve
  under plain Node.** Any module importing them transitively crashes
  `tests/*.test.mts` at import time. Route handlers must lazy `await import(...)`
  them inside the handler; pure logic goes in a separate importable module.
  Precedent: `app/api/checkout/route.ts` and `src/lib/chatgpt-identity.ts`.
- **D1 rows-affected is `result.meta.changes`.** Decide a guarded write by that
  count, never by re-reading and comparing a value — a re-read cannot
  distinguish "I won" from "someone wrote an identical value". That exact
  mistake was made twice here, once with a timestamp comparison in the claim
  transaction.
- **Do not put multi-statement SQLite trigger bodies in Wrangler D1
  migrations.** Remote migration application split the trigger body and failed
  with `incomplete input` even though local SQLite accepted it. The preview
  guard instead uses a transactional D1 batch: a counter row receives a random
  admission token, and the guarded lease write requires that exact token.
  This preserves shared rate/concurrency authority without parser-sensitive
  triggers.
- **TypeScript wants `.mjs` in the specifier when importing a `.mts` file**
  under `moduleResolution: "bundler"`.
- **Internal links need `Link` from `next/link`.** A bare `<a href="/...">`
  fails the build on `@next/next/no-html-link-for-pages`.
- **Never use the native `disabled` attribute on a control that can hold
  focus.** Disabling a focused element sends focus to `<body>` and strands
  keyboard users. Use `aria-disabled` plus a JS re-entrancy guard, as the rest
  of the app does.
- **`waitUntil: "networkidle"` times out on polling pages.** The checkout
  success page polls `/api/result`; use `"domcontentloaded"`.
- **Playwright's browser build must match its library version.** The project
  pin and the provisioned browser can disagree; `tests/e2e/helpers/harness.mts`
  falls back to a global install whose browser exists.

## 5. Honesty rules that override convenience

These are not style preferences. Breaking them produces work that looks
finished and is not.

- **Never fabricate a test result, a count, or an observation.** If something
  could not be run, say so and say why.
- **Never weaken an assertion to make a suite pass.** A failing test is a
  finding. Updating a fixture that encodes obsolete behaviour is legitimate;
  loosening a security or behaviour assertion is not.
- **Never self-grant a gate.** Milestone and gate closure is a PO decision per
  `AGENTS.md`. An agent reporting "M2 complete" is reporting an opinion.
- **Say what you did not do.** A summary listing only completed work is
  misleading even when every line in it is true.
- **Distinguish containment from a fix.** SEC-01 is host-gated, which removes
  the reachable attack path; the identity assertion is still unsigned. Calling
  that "fixed" would leave the next reader with a false model of the system.
