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
      features: ["The complete rewrite, unlocked", "All four writing modes", "Meaning protection", "50,000 words / month"],
      plannedFeatures: ["History", "Sentence controls", "Protected terminology"],
    },
    pro: {
      id: "pro",
      name: "Pro",
      monthlyPrice: 19,
      interval: "month",
      availability: "announced",
      wordLimit: 200_000,
      features: ["Everything in Starter", "Voice DNA (coming later)", "Multiple voice profiles (coming later)", "Larger and batch documents (coming later)"],
      plannedFeatures: ["Voice DNA", "Multiple voice profiles", "Larger documents", "Batch processing"],
    },
  },
} as const;
