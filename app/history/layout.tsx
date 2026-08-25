import type { Metadata } from "next";
import { productConfig } from "@/src/config/product";

// Private, per-account surface. It must never be indexed, and it must never
// be crawled into a cache: a history page renders one customer's own writing.
//
// `canonical: null` drops the root layout's self-canonical, which would
// otherwise point this page at the homepage — a canonical conflict SEO-020
// flagged: a private URL claiming `/` as its canonical, carrying `/`'s title
// and OG card.
export const metadata: Metadata = {
  title: `Your rewrites | ${productConfig.productName}`,
  alternates: { canonical: null },
  robots: { index: false, follow: false, nocache: true },
};

export default function HistoryLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
