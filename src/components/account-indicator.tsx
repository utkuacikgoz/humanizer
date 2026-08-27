"use client";

// SEC-17's aggravating factor, and the reason it was rated as high as it was.
//
// The audit found no surface outside /signin that says which account is
// signed in: `app/page.tsx`, `app/history/page.tsx` and
// `app/checkout/success/page.tsx` had no indicator and no sign-out. A victim
// pushed into someone else's session had no signal anywhere they actually
// work, and `return_to` let the attacker choose the landing page, so the one
// page that would have told them was trivially avoided.
//
// This is that signal. It shows the ADDRESS, not the word "Account", which is
// a deliberate deviation from docs/SIGNED-IN.md's open decision O-1 and its
// recommendation. O-1 weighed "Account" against the address as a matter of
// header aesthetics and shoulder-surfing, on the assumption that the question
// "which account am I in?" is one a person asks once. Under SEC-17 it is not
// an aesthetic question: an identity swap that the interface does not name is
// a silent compromise, and a pill reading "Account" is true in the attacker's
// session as well as the customer's. Security wins, so the address is on
// screen. The rest of O-1's reasoning still stands and is honoured — no
// avatar, no monogram, no plan badge, no dropdown.
//
// Sign-out is here rather than only on a future /account page for the same
// reason. docs/SIGNED-IN.md puts it on /account and argues a header sign-out
// is awkward in a flex nav; that is true, and it is also true that a person
// who has just read someone else's address in their own header needs the way
// out in the same glance, not one navigation away. Second deviation, same
// justification.
//
// Lives outside `app/` so it is a plain module that imports nothing from
// `next/headers` or `next/navigation`, matching src/components/manage-billing.tsx.
import { useEffect, useState } from "react";

/** Unknown until /api/auth/session answers; the cookie is HttpOnly, so the page has to ask. */
export type SessionState = { kind: "unknown" } | { kind: "signed-out" } | { kind: "signed-in"; email: string };

/**
 * One read of "who is signed in", shared by the hook below and by the
 * paywall's sign-in dialog, which polls it while it waits for a link to be
 * opened in another tab. A second copy of this fetch is how two answers to
 * the same question start disagreeing.
 *
 * A failed lookup answers `unknown` rather than `signed-out`: telling a
 * signed-in customer they are signed out is the one wrong answer here.
 */
export async function readSessionState(): Promise<SessionState> {
  try {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    if (!response.ok) return { kind: "unknown" };
    const body = (await response.json().catch(() => ({}))) as { signedIn?: boolean; email?: string };
    return body.signedIn && body.email ? { kind: "signed-in", email: body.email } : { kind: "signed-out" };
  } catch {
    return { kind: "unknown" };
  }
}

/**
 * Reads the caller's own session state.
 *
 * The client fetch is docs/SIGNED-IN.md's Option A. Option B — a server
 * component calling `getSessionUser()` — is that document's recommendation
 * and would avoid a round trip, but it also notes that `getSessionUser` has
 * never run in this deployment and asks for a spike before committing to it.
 * A security fix is not the place to take that risk, and `/signin` already
 * proves this pattern works here. If the spike later succeeds, this hook is
 * the only thing that has to change.
 */
export function useSessionState(): SessionState {
  const [session, setSession] = useState<SessionState>({ kind: "unknown" });

  useEffect(() => {
    let cancelled = false;
    void readSessionState().then((next) => {
      // A failed lookup leaves the state unknown rather than claiming
      // signed-out, which would tell a signed-in customer nothing is wrong.
      if (!cancelled && next.kind !== "unknown") setSession(next);
    });
    return () => { cancelled = true; };
  }, []);

  return session;
}

/**
 * The header account indicator, or `signedOut` while the answer is not yet a
 * live session.
 *
 * The unknown state renders `signedOut` deliberately: it never claims an
 * identity it has not confirmed, and it never claims to be signed in and then
 * silently swaps the label under a focused control.
 *
 * It is a `<div>`, not a `nav a`, and that is load-bearing rather than
 * incidental. `app/globals.css` hides `nav a:not(.sign-in)` at 760px, so an
 * indicator built as a nav link would disappear on exactly the screens where
 * a person is most likely to open a link from their mail app — which is the
 * device the attack arrives on. See `.account-indicator` in globals.css for
 * the matching mobile layout.
 */
export function AccountIndicator({ signedOut = null }: { signedOut?: React.ReactNode }) {
  const session = useSessionState();
  if (session.kind !== "signed-in") return <>{signedOut}</>;

  return (
    <div className="account-indicator">
      <span className="account-address">
        Signed in as <b>{session.email}</b>
      </span>
      {/*
        A real form POST, not a link: signing out changes state, a GET
        sign-out would be fetched by every prefetcher, and the route refuses a
        cross-site Origin. No JS, so no re-entrancy guard is needed and no
        control is ever given the native `disabled` attribute.
      */}
      <form className="account-signout" action="/api/auth/signout" method="post">
        <button className="account-signout-button" type="submit">Sign out</button>
      </form>
    </div>
  );
}
