export const pricingConfig = {
  catalogVersion: 1,
  currency: "usd",
  plans: {
    starter: {
      id: "starter",
      name: "Starter",
      monthlyPrice: 9,
      interval: "month",
      availability: "active",
      wordLimit: 50_000,
      features: ["All four writing modes", "Meaning protection", "Side-by-side comparison", "Partial preview before checkout"],
      plannedFeatures: ["History", "Sentence controls", "Protected terminology"],
    },
    pro: {
      id: "pro",
      name: "Pro",
      monthlyPrice: 19,
      interval: "month",
      availability: "announced",
      wordLimit: 200_000,
      features: ["Everything in Starter", "Voice DNA (coming later)", "Multiple voice profiles", "Larger and batch documents"],
      plannedFeatures: ["Voice DNA", "Multiple voice profiles", "Larger documents", "Batch processing"],
    },
  },
} as const;
