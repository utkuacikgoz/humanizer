"use client";

// Email magic-link sign-in.
//
// There is no password field here and there never will be one: no password to
// choose, to reuse, to leak, or for this product to store. The customer types
// the address they already read mail at, and proves it by opening a link.
//
// Everything this page shows is deliberately independent of whether the
// address has an account. The server never tells it, because the server does
// not look: the account is created when a link is redeemed, not when one is
// requested. See src/lib/magic-link.ts.
//
// DESIGN. This is the gate every paying customer passes through, so it is
// built from the landing page's own vocabulary rather than a second one: the
// two-column stage, the argument on the left set in the hero's type, the one
// control on the right. What it deliberately does NOT carry:
//
//   - A step number. `.step-number` encodes position in a real sequence (01
//     paste, 02 read, 03 pay). Signing in is not step 00 of anything, and
//     app/globals.css already refuses to number the four reasons in `.why`
//     for exactly this reason: numbering claims an order that is not real.
//   - A rule between every pair of elements. There is one rule in the card,
//     and only when there is something genuinely different in kind on the
//     other side of it: an existing session above, a fresh sign-in below.
//   - A status line before anything has happened. The live regions are in the
//     DOM from first paint, because a region inserted together with its
//     message is not announced — but they are empty, and an empty region
//     paints nothing.
import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { productConfig } from "@/src/config/product";
import { safeRelativeReturnPath } from "@/src/lib/identity";
import { useSessionState } from "@/src/components/account-indicator";
import { SignInForm } from "@/src/components/signin-form";

// The query string is read through useSyncExternalStore rather than an effect,
// the same way app/checkout/success/page.tsx reads its job id: the server
// snapshot is null, so the server and the first client render agree and
// nothing has to be patched up afterwards.
const subscribeToLocation = () => () => {};
const noServerValue = () => null;
const readQuery = (key: string) => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(key));
const readReturnTo = () => readQuery("return_to");
const readLinkError = () => readQuery("error");

/**
 * SEC-21. This used to be a local `startsWith("/") && !startsWith("//")`
 * re-implementation, described as convenience because the server re-checks
 * the value. The server does — but this result is also rendered directly as
 * `<Link href={returnTo}>Continue</Link>`, which the server never sees, and
 * the local copy was strictly weaker than the real one: `/\evil.test`,
 * `/\t/evil.test`, `/\n/evil.test` and `/\\evil.test` all survived it, and
 * the WHATWG URL parser normalizes every one of them to
 * `https://evil.test` — a one-click phishing hop wearing this site's name.
 *
 * There is exactly one copy of this check now, and it is the server's.
 * `src/lib/identity.ts` is free of `next/*` and `cloudflare:workers` imports
 * specifically so client code can call it, which is what its own doc comment
 * always claimed.
 */
const safeReturnTo = (value: string | null): string => safeRelativeReturnPath(value ?? "/");

export default function SignInPage() {
  const returnTo = safeReturnTo(useSyncExternalStore(subscribeToLocation, readReturnTo, noServerValue));
  const linkError = useSyncExternalStore(subscribeToLocation, readLinkError, noServerValue);
  // One implementation of "who is signed in", shared with the header
  // indicator every other surface now carries. Two copies of this fetch is
  // how the two states drift.
  const session = useSessionState();

  useEffect(() => { document.documentElement.classList.add("motion-ready"); }, []);

  // What the failed link left in the query string. The form owns everything
  // that happens after a submit, including dismissing this the moment a new
  // link is on its way — a "that link expired" notice is stale as soon as a
  // replacement is in flight.
  const failedLinkMessage = linkError === "link"
    ? "That sign-in link has expired or has already been used. Each link works once and lasts 15 minutes. Ask for a new one above."
    : linkError === "unavailable"
      ? "We could not complete your sign-in just now. This is a problem on our side and your link may still be good. Try opening it again in a moment, or ask for a new link above."
      : "";

  return (
    <main>
      <header className="site-header">
        <Link className="brand" href="/" aria-label={`${productConfig.productName} home`}>
          <span>{productConfig.productName}</span>
        </Link>
        <nav aria-label="Primary navigation">
          <Link href="/">Back to the rewriter</Link>
        </nav>
      </header>

      {/* One column, centred and vertically settled. An earlier pass gave this
          page the landing hero's two-column split; with one field and one
          button to place, that left half the viewport empty and made the card
          read as incidental. The card is the centre of gravity, the heading
          sits above it at the width of the thing it introduces, and the legal
          line sits outside the card because it is not part of the task. */}
      <div className="stage stage-auth">
        <div className="auth-column">
          <div className="auth-intro">
            <h1 id="signin-title">Sign in</h1>
            <p>
              Type the address you already read mail at. We send one link, and opening it signs you
              in. The link works once and expires 15 minutes after it is sent.
            </p>
          </div>

          <div className="auth-card">
            {session.kind === "signed-in" ? (
              <div className="auth-session">
                <p>
                  This browser is signed in as <b>{session.email}</b>.
                </p>
                <div className="auth-session-actions">
                  <Link className="next-action" href={returnTo}>Continue</Link>
                  {/*
                    A real form POST, not a link: signing out changes state, and
                    a GET sign-out would be triggered by any prefetcher or
                    third-party page. The route also refuses a cross-site Origin.
                  */}
                  <form action="/api/auth/signout" method="post">
                    <button className="auth-quiet" type="submit">Sign out</button>
                  </form>
                </div>
              </div>
            ) : null}

            <SignInForm
              returnTo={returnTo}
              labelledBy="signin-title"
              fieldId="signin-email"
              externalError={failedLinkMessage}
              showSwitchNote={session.kind === "signed-in"}
            />
          </div>

          <p className="auth-legal">
            By signing in you agree to the <Link href="/terms">terms</Link> and the{" "}
            <Link href="/privacy">privacy notice</Link>.
          </p>
        </div>
      </div>
    </main>
  );
}
