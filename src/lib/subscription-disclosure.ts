// ACT-10. The material terms of the recurring offer, in one sentence, so
// they can be shown at the decision point rather than only in the pricing
// section further down the page.
//
// docs/MONETIZATION.md's dark-pattern list makes "hidden recurring
// billing, renewal, or material limits" a blocker, and the 50,000-word
// monthly allowance is a material limit. Every value here comes from the
// plan catalog — nothing is hardcoded — and the sentence is deliberately
// flat: no urgency, no scarcity, no "limited time".
import { pricingConfig } from "@/src/config/pricing";

type Plan = (typeof pricingConfig.plans)[keyof typeof pricingConfig.plans];

export function subscriptionDisclosure(plan: Plan): string {
  const allowance = plan.wordLimit.toLocaleString("en-US");
  return (
    `${plan.name}: $${plan.monthlyPrice} per ${plan.interval}, recurring every ${plan.interval} ` +
    `until you cancel. Includes ${allowance} words each ${plan.interval}.`
  );
}
