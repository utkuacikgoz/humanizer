import type { Metadata } from "next";

// Private post-checkout surface. `canonical: null` drops the root layout's
// self-canonical, which would otherwise point this page at the homepage —
// the canonical conflict SEO-020 flagged. No title is set here: the visible
// heading depends on the verified checkout status, and metadata must not
// claim an outcome the page has not confirmed.
export const metadata: Metadata = {
  alternates: { canonical: null },
  robots: { index: false, follow: false, nocache: true },
};

export default function CheckoutSuccessLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
