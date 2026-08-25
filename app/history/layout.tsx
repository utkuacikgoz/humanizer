import type { Metadata } from "next";
import { productConfig } from "@/src/config/product";
import { buildPrivateSurfaceMetadata } from "@/src/lib/public-pages";

// Private, per-account surface. It must never be indexed, and it must never
// be crawled into a cache: a history page renders one customer's own writing.
//
// The shared private-surface builder drops the root layout's self-canonical
// (the conflict SEO-020 first flagged: a private URL claiming `/` as its
// canonical) and, since the second pass, the inherited homepage description
// and social card as well.
export const metadata: Metadata = buildPrivateSurfaceMetadata(`Your rewrites | ${productConfig.productName}`);

export default function HistoryLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
