import { STRIPE_PRICE_ENV_KEYS, type PlanId } from "@/src/config/stripe";
import { resolveBillingReadiness } from "@/src/lib/billing-readiness";
import { expectedMinorUnits } from "@/src/lib/price-integrity";
import { pricingConfig } from "@/src/config/pricing";

// TEMPORARY-STRIPE-DIAGNOSTIC — remove once checkout is confirmed working.
// Every line below is grep-able by that tag: `grep -rn TEMPORARY-STRIPE-DIAGNOSTIC`
// finds the whole thing, and deleting the tagged block plus this comment
// restores the original probe.
//
// Nothing secret is logged. Keys are reported only as the mode their prefix
// declares (test/live) and their length; never the value. Price IDs are
// logged in full because they are references, not credentials — a price ID
// alone cannot charge anyone (D-003).
function diag(stage: string, detail?: unknown) {
  console.log(`[stripe-diagnostic] ${stage}`, detail === undefined ? "" : JSON.stringify(detail));
}

function describeKey(value: string | undefined) {
  if (!value) return { present: false };
  const mode = /^sk_live_|^rk_live_/.test(value) ? "live" : /^sk_test_|^rk_test_/.test(value) ? "test" : "unrecognized-prefix";
  return { present: true, mode, length: value.length };
}

export async function GET() {
  const readiness = await resolveBillingReadiness(async () => {
    // Keep Workers-only modules behind the request boundary so plain Node
    // tests can import this route. A usable D1 binding and a verified Stripe
    // catalog are both required before the page may offer checkout.
    const [{ getDb }, stripeClient, { assertPriceMatchesCatalog }] = await Promise.all([
      import("../../../../db/index"),
      import("../../../../db/stripe-client"),
      import("@/src/lib/price-integrity"),
    ]);
    const { getStripeClient, resolveStripeConfig } = stripeClient;

    diag("1/5 modules loaded");

    getDb();
    diag("2/5 D1 binding resolved");

    // Resolved separately from getStripeClient so a configuration problem is
    // reported before the SDK is constructed around it.
    const resolved = resolveStripeConfig();
    diag("3/5 stripe config resolved", {
      secretKey: describeKey(resolved.secretKey),
      webhookSecretPrefixOk: resolved.webhookSecret.startsWith("whsec_"),
      priceIds: resolved.priceIds,
    });

    const { stripe, config } = getStripeClient();

    await Promise.all(
      (Object.keys(STRIPE_PRICE_ENV_KEYS) as PlanId[]).map(async (planId) => {
        const priceId = config.priceIds[planId];
        const price = await stripe.prices.retrieve(priceId);
        diag("4/5 price retrieved", {
          planId,
          priceId,
          livemode: price.livemode,
          active: price.active,
          unitAmount: price.unit_amount,
          currency: price.currency,
          recurringInterval: price.recurring?.interval ?? null,
          expected: {
            unitAmount: expectedMinorUnits(planId),
            currency: pricingConfig.currency,
            recurringInterval: pricingConfig.plans[planId].interval,
          },
        });
        assertPriceMatchesCatalog(planId, price);
        diag("5/5 price matches catalog", { planId });
      }),
    );
  });

  return Response.json(readiness, {
    status: readiness.available ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
