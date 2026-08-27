"use client";

// The paywall's sign-in dialog.
//
// WHY THIS EXISTS. /api/checkout refuses a signed-out caller with 401 and a
// `signInPath`, and the landing page used to follow it with
// `window.location.href = signInPath`. That was correct in the sense that it
// took the customer somewhere they could sign in, and wrong in the sense that
// it threw away the only thing that had earned their attention: the rewrite
// they were reading. The preview lives in React state on that page. Navigate
// away and it is gone, and coming back means pasting the draft and paying for
// the round trip again — at the exact moment the customer was ready to pay.
//
// So the sign-in comes to the page instead of the page going to the sign-in.
//
// THE HONEST CONSTRAINT. A magic link has to be opened, and opening it is a
// navigation this dialog cannot perform: the customer leaves for their mail
// app. What this dialog can do — and does — is survive that. The link opens
// in another tab (or another device), the session cookie lands on this
// origin, and this tab notices, closes the dialog, and resumes the checkout
// it was interrupted mid-way through, with the same capability still in
// memory and the same rewrite still on screen behind it.
//
// That is the whole point of the poll below. Without it the dialog is a
// prettier dead end than the redirect was.
//
// WHAT IT IS NOT. It is not a replacement for /signin. That page is still the
// canonical sign-in surface, still linked from the header, and still where a
// customer without JavaScript, or one who would rather have a real page,
// ends up: this dialog carries a link to it. A modal that is the only way in
// is a modal that locks people out.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { readSessionState } from "@/src/components/account-indicator";
import { SignInForm } from "@/src/components/signin-form";

/** How often this tab asks whether a link has been opened elsewhere. */
const POLL_INTERVAL_MS = 3_000;
/**
 * How long it keeps asking. A sign-in link is good for 15 minutes
 * (src/lib/magic-link.ts), so a poller still running at 20 is waiting for
 * something that can no longer happen; it stops rather than burning a request
 * every three seconds in a forgotten tab forever.
 */
const POLL_CEILING_MS = 20 * 60 * 1_000;

export function SignInModal({
  returnTo,
  reason,
  onClose,
  onSignedIn,
}: {
  /** Already narrowed by safeRelativeReturnPath by the caller. */
  returnTo: string;
  /** Why the customer was stopped, in their terms, not the API's. */
  reason: string;
  onClose: () => void;
  /** Called once, when a session appears while this dialog is open. */
  onSignedIn: () => void;
}) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [sent, setSent] = useState(false);
  // The resume fires once. Without this guard a poll that overlaps the close
  // animation could start checkout twice, which is two Stripe Sessions and
  // one confused customer.
  const resumed = useRef(false);
  // Both callbacks are re-created by the parent on every render — `onSignedIn`
  // closes over the plan id it has to hand back. Held in refs, the two effects
  // below can depend on nothing and run once. Depended on directly they would
  // re-run each render, and the first effect's cleanup calls `close()`: the
  // dialog would shut itself the moment anything above it re-rendered.
  const callbacks = useRef({ onClose, onSignedIn });
  // No dependency array: this runs after every commit, so the ref always
  // holds the latest pair by the time anything below can call it. Nothing
  // fires synchronously during the first render, and the poll's first tick is
  // three seconds out.
  useEffect(() => { callbacks.current = { onClose, onSignedIn }; });

  // Native <dialog> rather than a hand-rolled overlay: the focus trap, the
  // Escape key, the inert background and the top-layer stacking are the
  // browser's, and every one of them is a thing a hand-rolled modal gets
  // subtly wrong. `close` covers Escape as well as the close button, so
  // there is one exit path rather than two.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    const handleClose = () => callbacks.current.onClose();
    element.addEventListener("close", handleClose);
    return () => {
      element.removeEventListener("close", handleClose);
      if (element.open) element.close();
    };
  }, []);

  async function check() {
    if (resumed.current) return;
    const session = await readSessionState();
    if (session.kind !== "signed-in" || resumed.current) return;
    resumed.current = true;
    callbacks.current.onSignedIn();
  }

  // Waiting for the link to be opened somewhere else. Two triggers, because
  // they cover different customers: the interval catches the one who opened
  // the link on their phone and left this tab alone, and the visibility
  // handler catches the far commoner one who opened it in another tab of this
  // browser and came straight back — for them the answer arrives on the
  // switch back, not up to three seconds later.
  useEffect(() => {
    if (!sent) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started > POLL_CEILING_MS) {
        window.clearInterval(timer);
        return;
      }
      void check();
    }, POLL_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // `check` is a plain function reading through the callback ref, so it is
    // deliberately not a dependency: this poll starts once, when a link is
    // actually on its way.
  }, [sent]);

  const signInHref = `/signin?return_to=${encodeURIComponent(returnTo)}`;

  return (
    <dialog className="auth-dialog" ref={dialog} aria-labelledby="signin-dialog-title">
      <div className="auth-dialog-body">
        <div className="auth-dialog-head">
          <div className="auth-intro">
            <h2 id="signin-dialog-title">Sign in to continue</h2>
            <p>{reason}</p>
          </div>
          {/*
            A form with method="dialog" rather than an onClick: closing is the
            browser's own verb here, it fires the same `close` event Escape
            does, and it needs no JavaScript of its own.
          */}
          <form method="dialog">
            <button className="auth-dialog-close" type="submit" aria-label="Close sign-in">
              <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" width="15" height="15">
                <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </form>
        </div>

        <SignInForm
          returnTo={returnTo}
          labelledBy="signin-dialog-title"
          fieldId="signin-dialog-email"
          onStatusChange={(status) => { if (status === "sent") setSent(true); }}
        />

        {/* Said only once a link is actually on its way, because before that
            it is a promise about a thing that has not happened. It is also
            the one place the customer is told their rewrite is safe, which is
            the entire reason this is a dialog and not a page. */}
        {sent ? (
          <p className="auth-dialog-wait" role="status">
            Open the link and this page will pick it up on its own. Your rewrite is still here, and
            checkout carries on from where you left it.
          </p>
        ) : null}

        <p className="auth-legal">
          By signing in you agree to the <Link href="/terms">terms</Link> and the{" "}
          <Link href="/privacy">privacy notice</Link>. Prefer a full page?{" "}
          <Link href={signInHref}>Sign in here</Link>.
        </p>
      </div>
    </dialog>
  );
}
