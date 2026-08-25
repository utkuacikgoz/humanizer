import type { Metadata } from "next";
import { buildPrivateSurfaceMetadata } from "@/src/lib/public-pages";

// Private post-checkout surface. The shared private-surface builder drops the
// root layout's self-canonical, description and social card.
//
// No title is passed: the visible heading depends on the verified checkout
// status, and metadata must not claim an outcome the page has not confirmed.
// The tab therefore falls back to the site-wide title, which asserts nothing
// about this particular purchase.
export const metadata: Metadata = buildPrivateSurfaceMetadata();

export default function CheckoutSuccessLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
