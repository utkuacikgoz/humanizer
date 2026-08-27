"use client";

// The magic-link request form, in one copy.
//
// It was written inside app/signin/page.tsx and it is lifted out here for a
// reason the codebase already states in src/components/account-indicator.tsx:
// two copies of the same fetch is how two states drift. The paywall now needs
// this same form in a dialog (see signin-modal.tsx), and a second hand-written
// email field would be a second set of ids, a second re-entrancy guard, and a
// second chance to forget that the submit control must never take the native
// `disabled` attribute.
//
// It lives outside `app/` so it is a plain module importing nothing from
// `next/headers` or `next/navigation`, matching account-indicator.tsx and
// manage-billing.tsx.
//
// What it deliberately does NOT own:
//
//   - Where `returnTo` came from. The page reads it from its query string,
//     the dialog takes it from the location it is overlaying. Both hand this
//     component a value already through safeRelativeReturnPath.
//   - The link-expired and service-unavailable messages. Those come from the
//     query string of the page the failed link landed on, so the page owns
//     them and passes them in as `externalError`.
import { useRef, useState } from "react";

export type SignInFormStatus = "idle" | "working" | "sent" | "error";

export function SignInForm({
  returnTo,
  labelledBy,
  fieldId,
  externalError = "",
  showSwitchNote = false,
  onStatusChange,
}: {
  /** Already narrowed by safeRelativeReturnPath by the caller. */
  returnTo: string;
  /** The id of the heading that names this form. */
  labelledBy: string;
  /** Unique per mount, so a page and a dialog can never collide on one id. */
  fieldId: string;
  /** A failure the caller knows about that this form did not cause. */
  externalError?: string;
  /** True when the browser already holds a session and this is a switch. */
  showSwitchNote?: boolean;
  onStatusChange?: (status: SignInFormStatus) => void;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<SignInFormStatus>("idle");
  const [message, setMessage] = useState("");
  // The caller may want to hide `externalError` once this form has been used;
  // an expired-link notice is stale the moment a new link is on its way.
  const [dismissedExternalError, setDismissedExternalError] = useState(false);
  // Re-entrancy guard. The submit control stays focusable and uses
  // aria-disabled, so this ref is the only thing stopping a second submit; a
  // button that disables itself on click strands keyboard users mid-flow.
  const busy = useRef(false);

  function advance(next: SignInFormStatus) {
    setStatus(next);
    onStatusChange?.(next);
  }

  async function requestLink(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    const address = email.trim();
    if (!address) {
      advance("error");
      setMessage("Enter the email address you want to sign in with.");
      return;
    }

    busy.current = true;
    advance("working");
    setDismissedExternalError(true);
    try {
      const response = await fetch("/api/auth/request-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: address, returnTo }),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (response.ok) {
        advance("sent");
        setMessage(body.message ?? "Check your inbox for the sign-in link.");
      } else {
        advance("error");
        setMessage(body.error ?? "The sign-in link could not be sent. Please try again.");
      }
    } catch {
      advance("error");
      setMessage("The connection was interrupted. Please check your connection and try again.");
    } finally {
      busy.current = false;
    }
  }

  // One string per outcome, read by one region. The error region is separate
  // and assertive because a failure has to interrupt; both exist from first
  // paint and are empty until there is something true to say.
  const liveStatus = status === "working" ? "Sending your sign-in link." : status === "sent" ? message : "";
  const liveError = status === "error" ? message : dismissedExternalError ? "" : externalError;

  return (
    <form className="auth-form" onSubmit={requestLink} aria-labelledby={labelledBy}>
      {showSwitchNote ? <p className="auth-switch">Or send a link to a different address.</p> : null}

      <div className="auth-field">
        <label htmlFor={fieldId}>Email address</label>
        <input
          className="signin-input"
          id={fieldId}
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
      </div>

      <button className="auth-submit" type="submit" aria-disabled={status === "working"}>
        {status === "working" ? (
          <>
            <span className="dot-loader" aria-hidden="true"><span /><span /><span /></span>
            Sending
          </>
        ) : (
          "Email me a link"
        )}
      </button>

      {/* Both regions are present before there is anything to announce.
          They paint nothing while empty. */}
      <p className="auth-status" role="status" aria-live="polite">{liveStatus}</p>
      <p className="auth-alert" role="alert">{liveError}</p>

      <p className="auth-note">
        {status === "sent"
          ? "Nothing arrived? Check the spam folder, then request another link."
          : "We only use your address to sign you in and to send receipts."}
      </p>
    </form>
  );
}
