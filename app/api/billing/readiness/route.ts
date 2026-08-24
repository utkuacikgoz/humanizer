import { STRIPE_PRICE_ENV_KEYS, type PlanId } from "@/src/config/stripe";
import { resolveBillingReadiness } from "@/src/lib/billing-readiness";

export async function GET() {
  const readiness = await resolveBillingReadiness(async () => {
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
    headers: { "cache-control": "no-store" },
  });
}
