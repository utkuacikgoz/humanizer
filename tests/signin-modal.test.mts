import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// ---------------------------------------------------------------------
// The paywall's sign-in dialog
// ---------------------------------------------------------------------
//
// A signed-out visitor who clicks Unlock gets a 401 from /api/checkout. The
// landing page used to answer that by navigating to `signInPath`, which threw
// away the preview: it is React state on that page and nothing about it
// survives leaving. The visitor signed in and landed on an empty rewriter,
// having already paid for one round trip and been asked to start again at the
// exact moment they were ready to buy.
//
// These are source invariants rather than DOM tests because that is what can
// be checked here: `app/landing-page.tsx` and the two components pull in
// `next/*`, so they cannot be imported under plain Node (see the lazy-import
// rule the route handlers follow for the same reason). What is guarded is the
// shape of the fix, not its pixels.

test("the paywall's 401 opens the dialog instead of navigating away", async () => {
  const page = await read("app/landing-page.tsx");

  // The regression itself. Any reintroduction of a full navigation on the
  // signed-out branch loses the preview again.
  assert.doesNotMatch(
    page,
    /window\.location\.href\s*=\s*payload\.signInPath/,
    "the signed-out branch navigates away from the preview instead of opening the sign-in dialog",
  );
  assert.match(page, /setSignInPrompt\(\{\s*planId/, "the 401 branch does not open the dialog");

  // Resuming is the whole point. Without it the dialog is a prettier dead end
  // than the redirect was: the customer signs in and is left looking at a
  // paywall they have to click a second time.
  assert.match(page, /onSignedIn=\{\(\) => \{/);
  assert.match(page, /void unlock\(planId\)/, "signing in does not hand the flow back to checkout");

  // The button said "Redirecting to checkout…" while unlockStatus was
  // "working", and unlock() refuses to re-enter in that state. Left set, the
  // resume above would be swallowed and the control would lie.
  assert.match(page, /setUnlockStatus\("idle"\);\s*\n\s*setSignInPrompt/);
});

test("the dialog waits for a link opened somewhere else, and resumes once", async () => {
  const modal = await read("src/components/signin-modal.tsx");

  // A magic link is opened in another tab or on another device. This tab
  // finds out by asking, on an interval and on the switch back into view.
  assert.match(modal, /readSessionState/);
  assert.match(modal, /setInterval/);
  assert.match(modal, /visibilitychange/);

  // Bounded. A poll still running long after the link has expired is a
  // request every few seconds in a tab nobody is looking at.
  assert.match(modal, /POLL_CEILING_MS/);
  assert.match(modal, /Date\.now\(\) - started > POLL_CEILING_MS/);

  // Two Stripe Sessions for one customer is the failure this guards.
  assert.match(modal, /resumed\.current = true/);

  // Native <dialog>: the focus trap, Escape, the inert background and the top
  // layer are the browser's. A hand-rolled overlay gets at least one of them
  // wrong, and this one sits over a paywall.
  assert.match(modal, /showModal\(\)/);
  assert.match(modal, /<dialog/);

  // A modal that is the only way in is a modal that locks people out.
  assert.match(modal, /\/signin\?return_to=/, "the dialog offers no route to the full sign-in page");
});

test("there is one magic-link request form, not two", async () => {
  const [form, modal, page] = await Promise.all([
    read("src/components/signin-form.tsx"),
    read("src/components/signin-modal.tsx"),
    read("app/signin/page.tsx"),
  ]);

  // The form was lifted out of app/signin/page.tsx so the dialog could reuse
  // it. Both surfaces must keep using it: a second hand-written email field is
  // a second re-entrancy guard and a second chance to get the disabled-control
  // rule wrong.
  assert.match(form, /fetch\("\/api\/auth\/request-link"/);
  for (const [name, source] of [["the dialog", modal], ["the sign-in page", page]] as const) {
    assert.match(source, /<SignInForm/, `${name} does not use the shared sign-in form`);
    assert.doesNotMatch(source, /request-link/, `${name} has its own copy of the request-link fetch`);
  }

  // The rule the whole codebase holds: a focusable control never takes the
  // native `disabled` attribute, because a button that disables itself on
  // click strands the keyboard user who is standing on it.
  assert.match(form, /aria-disabled=\{status === "working"\}/);
  assert.doesNotMatch(form, /\sdisabled(=|\s|\/|>)/, "the submit control uses the native disabled attribute");

  // Two mounts of one component cannot be allowed to collide on one id.
  assert.match(form, /fieldId/);
  assert.match(form, /htmlFor=\{fieldId\}/);
});

test("there is one implementation of 'who is signed in'", async () => {
  const indicator = await read("src/components/account-indicator.tsx");
  const modal = await read("src/components/signin-modal.tsx");

  assert.match(indicator, /export async function readSessionState/);
  // One fetch of the session endpoint in the whole client tree. Two answers to
  // this question is how the header and the dialog start disagreeing about
  // whether the customer is signed in.
  const sessionFetch = /fetch\("\/api\/auth\/session"/g;
  assert.equal((indicator.match(sessionFetch) ?? []).length, 1);
  assert.doesNotMatch(modal, sessionFetch);

  // A failed lookup must never be reported as signed-out: telling a signed-in
  // customer they are signed out is the one wrong answer here, and in the
  // dialog it would mean never resuming their checkout.
  assert.match(indicator, /if \(!response\.ok\) return \{ kind: "unknown" \}/);
});
