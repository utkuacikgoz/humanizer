export const productConfig = {
  codename: "humanizer",
  productName: "Ownword",
  productTagline: "Writing that still sounds like you.",
  domain: "ownword.pro",
  supportEmail: "support@ownword.pro",
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
