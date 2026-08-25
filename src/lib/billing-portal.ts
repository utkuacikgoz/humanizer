// ACT-09. Pure mapping from `/api/billing/portal` responses to honest,
// actionable customer-facing states.
//
// The route implements the Stripe Billing Portal correctly and can answer
// 401 (not signed in), 404 (no billing account mapped), 503 (Stripe not
// configured) or 502 (Stripe call failed). docs/MONETIZATION.md lists
// obstructed cancellation as a dark-pattern blocker, so none of those may
// surface as a silent no-op: each one has to tell the customer what
// happened and what to do next.
//
// No `next/*` or `cloudflare:workers` imports, so this is testable under
// plain Node and importable from a client component.
import { signInPath } from "@/src/lib/identity";
import { productConfig } from "@/src/config/product";

export type PortalFailureAction =
  | { kind: "none" }
  | { kind: "sign-in"; href: string; label: string }
  | { kind: "email"; href: string; label: string };

export interface PortalFailure {
  message: string;
  action: PortalFailureAction;
}

function supportAction(): PortalFailureAction {
  const supportEmail: string | null = productConfig.supportEmail;
  return supportEmail
    ? { kind: "email", href: `mailto:${supportEmail}`, label: supportEmail }
    : { kind: "none" };
}

/**
 * @param status HTTP status from the portal route.
 * @param error  The route's own `error` string, when it sent one.
 * @param returnTo Path to come back to after signing in.
 */
export function describePortalFailure(status: number, error?: string, returnTo = "/"): PortalFailure {
  switch (status) {
    case 401:
      return {
        message: "Sign in to manage or cancel your subscription.",
        action: { kind: "sign-in", href: signInPath(returnTo), label: "Sign in" },
      };
    case 404:
      return {
        message: "This account has no subscription yet, so there is nothing to cancel. Nothing is being charged.",
        action: { kind: "none" },
      };
    case 503:
      return {
        message: "Billing management is not available right now. Please try again later.",
        action: supportAction(),
      };
    default:
      return {
        message: error?.trim() || "Billing management could not be opened. Please try again.",
        action: supportAction(),
      };
  }
}
