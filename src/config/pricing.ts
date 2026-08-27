// The one server-owned, versioned catalog every price, allowance, and plan
// claim is read from (docs/MONETIZATION.md, "Centralized catalog"). Nothing
// customer-facing may hardcode a dollar amount or a word limit.
//
// `features` is what the plan delivers TODAY. `plannedFeatures` is what it
// does not deliver yet. The two lists are rendered differently and labelled
// differently, because docs/MONETIZATION.md's dark-pattern list makes
// "claiming unavailable Pro features are present" a blocker. A capability
// only moves from plannedFeatures to features once it is actually shipped.
export const pricingConfig = {
  catalogVersion: 1,
  currency: "usd",
  plans: {
    starter: {
      id: "starter",
      name: "Starter",
      monthlyPrice: 9.99,
      interval: "month",
      availability: "active",
      wordLimit: 50_000,
      summary: "Everything you need to make drafts sound like you meant them.",
      features: ["The complete rewrite, unlocked", "All four writing modes", "Meaning protection", "50,000 words / month"],
      // "History" used to sit here; it ships (app/history), so listing it as
      // planned understated the plan just as badly as overstating it would.
      plannedFeatures: ["Sentence controls", "Protected terminology"],
    },
    pro: {
      id: "pro",
      name: "Pro",
      monthlyPrice: 19,
      interval: "month",
      availability: "active",
      wordLimit: 200_000,
      summary: "For the months when the drafts keep coming.",
      // Pro differs from Starter in exactly one way today: the monthly
      // allowance. It is deliberately described that way rather than with
      // the Voice DNA / batch bullets it used to carry, none of which exist
      // (docs/PRODUCT.md defers them past V1). Those live in
      // plannedFeatures below and are labelled as not included.
      features: ["The complete rewrite, unlocked", "All four writing modes", "Meaning protection", "200,000 words / month"],
      plannedFeatures: ["Voice DNA", "Multiple voice profiles", "Larger documents", "Batch processing"],
    },
  },
} as const;
