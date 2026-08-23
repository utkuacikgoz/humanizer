export const productConfig = {
  codename: "humanizer",
  productName: "Humanizer",
  productTagline: "Writing that still sounds like you.",
  domain: "",
  supportEmail: "support@example.com",
  legalCompanyName: "Bosphorus Elevate LLC",
  socialHandles: {} as Record<string, string>,
  billingEnabled: false,
} as const;

export const MODES = [
  { id: "natural", label: "Natural" },
  { id: "professional", label: "Professional" },
  { id: "academic", label: "Academic" },
  { id: "casual", label: "Casual" },
] as const;
