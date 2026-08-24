"use client";

// ACT-09. The one-click path behind the hero's "Cancel anytime" promise.
//
// `app/api/billing/portal/route.ts` has always implemented the Stripe
// Billing Portal correctly; nothing in the UI called it. A cancellation
// claim with no reachable path is the "obstructed cancellation"
// dark-pattern blocker in docs/MONETIZATION.md, so this component is the
// path: one click, no API route to know, and every failure mode from the
// route surfaced as an honest, actionable state rather than a no-op.
//
// Lives outside `app/` so it is a plain module (never mistaken for a
// route) and imports nothing from `next/headers` or `next/navigation`.
import { useRef, useState } from "react";
import { describePortalFailure, type PortalFailure } from "@/src/lib/billing-portal";

export function ManageBilling({ returnTo = "/", className }: { returnTo?: string; className?: string }) {
  const [status, setStatus] = useState<"idle" | "working" | "failed">("idle");
  const [failure, setFailure] = useState<PortalFailure | null>(null);
  // Re-entrancy guard rather than a native `disabled` attribute: a
  // button that becomes `disabled` drops keyboard focus to <body>.
  const inFlight = useRef(false);

  async function openPortal() {
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus("working");
    setFailure(null);
    try {
      const response = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const payload = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (response.ok && payload.url) {
        window.location.href = payload.url;
        return;
      }
      setFailure(describePortalFailure(response.status, payload.error, returnTo));
      setStatus("failed");
    } catch {
      setFailure(describePortalFailure(0, undefined, returnTo));
      setStatus("failed");
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <div className={className ? `manage-billing ${className}` : "manage-billing"}>
      <button
        type="button"
        className="manage-billing-button"
        onClick={openPortal}
        aria-disabled={status === "working"}
      >
        {status === "working" ? "Opening billing…" : "Manage or cancel subscription"}
      </button>
      <span role="status" aria-live="polite" className="manage-billing-status">
        {failure ? (
          <>
            {failure.message}{" "}
            {failure.action.kind === "none" ? null : (
              <a href={failure.action.href}>{failure.action.label}</a>
            )}
          </>
        ) : null}
      </span>
    </div>
  );
}
