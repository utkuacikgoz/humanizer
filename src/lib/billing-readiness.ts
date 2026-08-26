export type BillingReadiness =
  | {
      available: true;
      signInRequired: true;
      message: string;
    }
  | {
      available: false;
      signInRequired: true;
      message: string;
    };

/**
 * Converts a server-side readiness probe into the only public states the
 * landing page needs. Configuration details stay private and every failure
 * closes checkout instead of leaving a button that cannot complete.
 */
export async function resolveBillingReadiness(probe: () => Promise<void>): Promise<BillingReadiness> {
  try {
    await probe();
    return {
      available: true,
      signInRequired: true,
      message: "You will sign in with your email before checkout.",
    };
  } catch (error) {
    // The customer-facing message stays deliberately generic — which check
    // failed is configuration detail and must not be published. But an
    // operator staring at a disabled button needs to know WHY, so the reason
    // goes to the Worker log where `wrangler tail` can see it and the browser
    // cannot. Only the error name and message: never the secret values, and
    // never the full error, whose cause chain can carry request details.
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error("[billing-readiness] checkout is closed:", reason);
    return {
      available: false,
      signInRequired: true,
      message: "Checkout is temporarily unavailable. Your preview is still yours to review.",
    };
  }
}

// ---------------------------------------------------------------------------
// SEC-18 — the readiness probe was an unauthenticated Stripe amplifier
// ---------------------------------------------------------------------------
//
// `GET /api/billing/readiness` has no authentication, no rate limit and no
// caching, and `app/page.tsx` fetches it on every landing-page load. Each
// call ran `stripe.prices.retrieve()` for every configured plan, so a
// one-line loop converted unauthenticated requests into Stripe API calls at
// 1:1. Exhausting Stripe's read limit makes the probe throw, readiness
// returns `available: false`, and the landing page tells genuine customers
// checkout is unavailable — a revenue outage driven from an anonymous
// endpoint.
//
// `/api/checkout` already memoizes exactly this verification per isolate
// (`verifiedPriceIds`); the probe deliberately did not. This is the same
// idea with a clock, because unlike checkout's set this has to be able to
// recover: an operator who fixes a bad price ID must not have to wait for
// isolates to recycle before the button comes back.

/** A good verdict is stable, so it is held long enough to flatten a flood. */
export const BILLING_READINESS_TTL_MS = 5 * 60 * 1000;
/**
 * A bad verdict is held far more briefly. It is the state an operator is
 * actively fixing, and a stale "closed" is a revenue outage of our own making
 * — which is the failure this whole finding is about.
 */
export const BILLING_READINESS_FAILURE_TTL_MS = 30 * 1000;

type CacheEntry = { verdict: BillingReadiness; expiresAt: number };

let cached: CacheEntry | null = null;
/** Collapses a burst onto one probe: without it, N concurrent misses are N Stripe reads. */
let inFlight: Promise<BillingReadiness> | null = null;

/**
 * `resolveBillingReadiness` with a per-isolate memo.
 *
 * The probe is still the real one and every failure still closes checkout;
 * what changes is how often an anonymous request can cause it to run. The
 * clock is injectable so the expiry is testable without waiting.
 */
export async function resolveCachedBillingReadiness(
  probe: () => Promise<void>,
  now: () => number = Date.now,
): Promise<BillingReadiness> {
  const at = now();
  if (cached && cached.expiresAt > at) return cached.verdict;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const verdict = await resolveBillingReadiness(probe);
    cached = {
      verdict,
      expiresAt: now() + (verdict.available ? BILLING_READINESS_TTL_MS : BILLING_READINESS_FAILURE_TTL_MS),
    };
    return verdict;
  })().finally(() => { inFlight = null; });

  return inFlight;
}

/** Test seam. Never called from application code. */
export function resetBillingReadinessCacheForTests(): void {
  cached = null;
  inFlight = null;
}
