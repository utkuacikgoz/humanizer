// GET /api/billing/readiness — whether checkout is configured well enough to
// offer. Not an entitlement signal and not user-specific: it says nothing
// about the caller.
//
// SEC-18. This route is unauthenticated and `app/page.tsx` fetches it on
// every landing-page load, so before the memo below each anonymous request
// drove one `stripe.prices.retrieve()` per configured plan, 1:1. A one-line
// loop was therefore a way to exhaust Stripe's read rate limit, which makes
// the probe throw, which tells genuine customers checkout is unavailable.
// `resolveCachedBillingReadiness` holds the verdict per isolate — the same
// thing /api/checkout's `verifiedPriceIds` does, plus a clock so a fixed
// misconfiguration recovers without waiting for isolates to recycle.
//
// The former TEMPORARY-STRIPE-DIAGNOSTIC block is gone. It logged a
// `[stripe-diagnostic]` line per stage per call, so the same loop was also a
// log-volume amplifier, and it had served its purpose.
import { STRIPE_PRICE_ENV_KEYS, type PlanId } from "@/src/config/stripe";
import { BILLING_READINESS_TTL_MS, resolveCachedBillingReadiness } from "@/src/lib/billing-readiness";

export async function GET() {
  const readiness = await resolveCachedBillingReadiness(async () => {
    // Keep Workers-only modules behind the request boundary so plain Node
    // tests can import this route. A usable D1 binding and a verified Stripe
    // catalog are both required before the page may offer checkout.
    const [{ getDb }, { getStripeClient }, { assertPriceMatchesCatalog }] = await Promise.all([
      import("../../../../db/index"),
      import("../../../../db/stripe-client"),
      import("@/src/lib/price-integrity"),
    ]);

    getDb();
    const { stripe, config } = getStripeClient();

    await Promise.all(
      (Object.keys(STRIPE_PRICE_ENV_KEYS) as PlanId[]).map(async (planId) => {
        assertPriceMatchesCatalog(planId, await stripe.prices.retrieve(config.priceIds[planId]));
      }),
    );
  });

  return Response.json(readiness, {
    status: readiness.available ? 200 : 503,
    headers: {
      // The verdict is the same for every visitor and carries nothing about
      // the caller, so a shared cache in front of the Worker can absorb the
      // anonymous repeat traffic this finding is about. Never for the closed
      // verdict: that one is being actively fixed.
      "cache-control": readiness.available
        ? `public, max-age=60, s-maxage=${Math.floor(BILLING_READINESS_TTL_MS / 1000)}`
        : "no-store",
    },
  });
}
