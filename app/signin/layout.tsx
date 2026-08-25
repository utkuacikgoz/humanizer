import type { Metadata } from "next";
import { productConfig } from "@/src/config/product";
import { buildPrivateSurfaceMetadata } from "@/src/lib/public-pages";

// The sign-in surface is functional, not editorial: there is nothing here for
// a search engine, and an indexed sign-in page is a classic thin-content and
// phishing-lookalike liability.
//
// The shared private-surface builder drops everything this page would
// otherwise inherit from the root layout's homepage metadata: the
// self-canonical, the homepage description, and the social card whose
// `og:url` pointed at `/`.
export const metadata: Metadata = buildPrivateSurfaceMetadata(`Sign in | ${productConfig.productName}`);

export default function SignInLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
