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
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { productConfig } from "@/src/config/product";
import { safeRelativeReturnPath } from "@/src/lib/identity";
import { useSessionState } from "@/src/components/account-indicator";

type Status = "idle" | "working" | "sent" | "error";

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
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const returnTo = safeReturnTo(useSyncExternalStore(subscribeToLocation, readReturnTo, noServerValue));
  const linkError = useSyncExternalStore(subscribeToLocation, readLinkError, noServerValue);
  const linkErrored = linkError === "link";
  const serviceUnavailable = linkError === "unavailable";
  const [dismissedLinkError, setDismissedLinkError] = useState(false);
  const linkFailed = linkErrored && !dismissedLinkError;
  // One implementation of "who is signed in", shared with the header
  // indicator every other surface now carries. Two copies of this fetch is
  // how the two states drift.
  const session = useSessionState();
  // Re-entrancy guard. The submit control stays focusable and uses
  // aria-disabled, so this ref is the only thing stopping a second submit; a
  // button that disables itself on click strands keyboard users mid-flow.
  const busy = useRef(false);

  useEffect(() => { document.documentElement.classList.add("motion-ready"); }, []);

  async function requestLink(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    const address = email.trim();
    if (!address) {
      setStatus("error");
      setMessage("Enter the email address you want to sign in with.");
      return;
    }

    busy.current = true;
    setStatus("working");
    setDismissedLinkError(true);
    try {
      const response = await fetch("/api/auth/request-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: address, returnTo }),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (response.ok) {
        setStatus("sent");
        setMessage(body.message ?? "Check your inbox for the sign-in link.");
      } else {
        setStatus("error");
        setMessage(body.error ?? "The sign-in link could not be sent. Please try again.");
      }
    } catch {
      setStatus("error");
      setMessage("The connection was interrupted. Please check your connection and try again.");
    } finally {
      busy.current = false;
    }
  }

  return (
    <main>
      <header className="site-header">
        <Link className="brand" href="/" aria-label={`${productConfig.productName} home`}>
          <span>{productConfig.productName}</span>
        </Link>
        <nav aria-label="Primary navigation">
          <Link className="sign-in" href="/">Back to the rewriter</Link>
        </nav>
      </header>

      <div className="stage stage-single">
        <section className="workspace" aria-labelledby="signin-title">
          <div className="workspace-topline">
            <div>
              <span className="step-number">00</span>
              <h2 id="signin-title">Sign in</h2>
            </div>
          </div>

          {session.kind === "signed-in" ? (
            <p className="status-line" role="status" style={{ borderTop: "none" }}>
              You are signed in as {session.email}.{" "}
              <Link href={returnTo}>Continue</Link>, or sign out below.
            </p>
          ) : null}

          {linkFailed ? (
            <p className="error" role="alert" style={{ borderTop: "none" }}>
              That sign-in link has expired or has already been used. Each link works once and lasts
              15 minutes. Request a new one below.
            </p>
          ) : null}

          {serviceUnavailable && !dismissedLinkError ? (
            <p className="error" role="alert" style={{ borderTop: "none" }}>
              We could not complete your sign-in just now. This is a problem on our side and your link
              may still be good. Try opening it again in a moment, or request a new one below.
            </p>
          ) : null}

          <form onSubmit={requestLink}>
            <p className="signin-copy">
              Enter your email and we will send you a link that signs you in. No password to remember.
            </p>
            <label className="signin-label" htmlFor="signin-email">Email address</label>
            <input
              className="signin-input"
              id="signin-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />

            <div className="editor-footer">
              <p className="signin-note">
                {status === "sent"
                  ? "The link expires in 15 minutes and works once."
                  : "We only use your address to sign you in and to send receipts."}
              </p>
              <button className="humanize-button" type="submit" aria-disabled={status === "working"}>
                {status === "working" ? "Sending" : "Email me a link"}
              </button>
            </div>
          </form>

          {status === "working" ? (
            <p className="status-line" role="status">
              <span className="dot-loader" aria-hidden="true"><span /><span /><span /></span>
              {" "}Sending your sign-in link.
            </p>
          ) : null}

          {status === "sent" ? (
            <p className="status-line" role="status">{message}</p>
          ) : null}

          {status === "error" ? (
            <p className="error" role="alert">{message}</p>
          ) : null}

          {session.kind === "signed-in" ? (
            // A real form POST, not a link: signing out changes state, and a
            // GET sign-out would be triggered by any prefetcher or third-party
            // page. The route also refuses a cross-site Origin.
            <form className="signin-signout" action="/api/auth/signout" method="post">
              <button className="history-cancel" type="submit">Sign out</button>
            </form>
          ) : null}

          <p className="signin-legal">
            By signing in you agree to the <Link href="/terms">terms</Link> and the{" "}
            <Link href="/privacy">privacy notice</Link>.
          </p>
        </section>
      </div>
    </main>
  );
}
