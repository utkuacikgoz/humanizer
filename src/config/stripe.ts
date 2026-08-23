// Server-owned mapping from internal plan ID to the environment variable
// that holds the real Stripe Price ID (M2-02). This file is intentionally
// pure/static — no secrets, no `cloudflare:workers` import — so it can be
// imported anywhere, including plain-Node tests, without dragging in the
// Workers-runtime dependency that db/stripe-client.ts carries.
//
// D-003: Stripe metadata and client parameters are references, never
// entitlement authority. A price ID lives in env, resolved server-side;
// it is never accepted from the client and never hardcoded here.
import { pricingConfig } from "./pricing";

export const STRIPE_CATALOG_VERSION = 1;

// Only plans with availability "active" need a mapping here — "pro" is
// "announced" (not purchasable yet per src/config/pricing.ts) and
// deliberately has none.
export const STRIPE_PRICE_ENV_KEYS = {
  starter: "STRIPE_PRICE_STARTER",
} as const satisfies Partial<Record<keyof typeof pricingConfig.plans, string>>;

export type PlanId = keyof typeof STRIPE_PRICE_ENV_KEYS;

export function isPurchasablePlan(planId: string): planId is PlanId {
  return planId in STRIPE_PRICE_ENV_KEYS && pricingConfig.plans[planId as PlanId].availability === "active";
}
