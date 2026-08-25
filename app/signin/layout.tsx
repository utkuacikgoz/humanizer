import type { Metadata } from "next";
import { productConfig } from "@/src/config/product";

// The sign-in surface is functional, not editorial: there is nothing here for
// a search engine, and an indexed sign-in page is a classic thin-content and
// phishing-lookalike liability. `canonical: null` drops the root layout's
// self-canonical, which would otherwise point this page at the homepage.
export const metadata: Metadata = {
  title: `Sign in | ${productConfig.productName}`,
  alternates: { canonical: null },
  robots: { index: false, follow: false, nocache: true },
};

export default function SignInLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
