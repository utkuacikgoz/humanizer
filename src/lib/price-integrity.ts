// Guards against the displayed price and the actually-charged Stripe Price
// drifting apart (MON finding). pricingConfig is display-only; Stripe's
// Price object is charge-authoritative. If STRIPE_PRICE_STARTER points at a
// stale/wrong Price, the landing page would advertise one amount while
// Stripe charges another — a bait-and-switch that docs/MONETIZATION.md's
// dark-pattern rules forbid, with no existing check to catch it.
//
// Pure module: no `cloudflare:workers`, no Stripe import — takes the
// already-fetched price shape so it stays testable under plain Node.
import { pricingConfig } from "@/src/config/pricing";
import type { PlanId } from "@/src/config/stripe";

export class PriceMismatchError extends Error {
  constructor(planId: string, reason: string) {
    super(`Stripe Price for plan "${planId}" does not match the published catalog: ${reason}.`);
    this.name = "PriceMismatchError";
  }
}

export interface StripePriceShape {
  unit_amount: number | null;
  currency: string;
  active?: boolean;
  recurring?: { interval?: string } | null;
}

export function expectedMinorUnits(planId: PlanId): number {
  // Float cents (9.99 * 100 = 998.9999...) must be rounded, not truncated.
  return Math.round(pricingConfig.plans[planId].monthlyPrice * 100);
}

// Throws PriceMismatchError when the live Stripe Price disagrees with the
// published catalog on amount, currency, interval, or active state.
export function assertPriceMatchesCatalog(planId: PlanId, price: StripePriceShape): void {
  const expectedAmount = expectedMinorUnits(planId);
  if (price.unit_amount !== expectedAmount) {
    throw new PriceMismatchError(planId, `expected ${expectedAmount} minor units, Stripe has ${price.unit_amount}`);
  }

  const expectedCurrency = pricingConfig.currency;
  if (price.currency?.toLowerCase() !== expectedCurrency) {
    throw new PriceMismatchError(planId, `expected currency ${expectedCurrency}, Stripe has ${price.currency}`);
  }

  const expectedInterval = pricingConfig.plans[planId].interval;
  if (price.recurring?.interval !== expectedInterval) {
    throw new PriceMismatchError(planId, `expected a recurring ${expectedInterval} price, Stripe has ${price.recurring?.interval ?? "no recurring interval"}`);
  }

  if (price.active === false) {
    throw new PriceMismatchError(planId, "the Stripe Price is archived/inactive");
  }
}
