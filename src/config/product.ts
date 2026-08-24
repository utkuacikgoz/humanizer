type ProductConfig = {
  codename: string;
  productName: string;
  productTagline: string;
  domain: string;
  supportEmail: string;
  legalCompanyName: string;
  socialHandles: Record<string, string>;
  billingEnabled: boolean;
};

export const productConfig: ProductConfig = {
  codename: "humanizer",
  productName: "Ownword",
  productTagline: "Writing that still sounds like you.",
  domain: "ownword.pro",
  supportEmail: "support@ownword.pro",
  legalCompanyName: "Bosphorus Elevate LLC",
  socialHandles: {},
  // Emits the Offer block in the landing page's SoftwareApplication
  // JSON-LD. On for the paid launch: the advertised price is real, backed
  // by a live Stripe Price that src/lib/price-integrity.ts verifies before
  // any Checkout Session is created. This flag does not gate checkout.
  billingEnabled: true,
};

export const MODES = [
  { id: "natural", label: "Natural" },
  { id: "professional", label: "Professional" },
  { id: "academic", label: "Academic" },
  { id: "casual", label: "Casual" },
] as const;
