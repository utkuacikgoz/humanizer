import type { Metadata } from "next";
import Link from "next/link";
import { productConfig } from "@/src/config/product";
import { buildPrivateSurfaceMetadata } from "@/src/lib/public-pages";

// SEO-020 handoff H-4. Before this file existed, a genuine 404 rendered the
// framework's built-in fallback underneath the root layout, and so inherited
// the homepage's metadata wholesale: `<link rel="canonical"
// href="https://ownword.pro">`, the homepage title, description and social
// card. A canonical is a claim that this URL and that URL are the same page,
// and a missing URL is not the homepage. Told often enough, that is how a
// soft-404 gets folded into `/`.
//
// The shared private-surface builder drops all of it and adds `nofollow`
// alongside the framework's `noindex`. There is nothing on a 404 worth
// following, and no canonical it can honestly declare.
//
// Copy note: these words are placeholders owned by COPY, not by SEO. They
// state only what is true (the URL does not exist) and offer the one link
// that always resolves.
export const metadata: Metadata = buildPrivateSurfaceMetadata(`Page not found | ${productConfig.productName}`);

export default function NotFound() {
  return (
    <main className="legal-doc">
      <Link className="back-link" href="/">&larr; Back to {productConfig.productName}</Link>
      <h1>Page not found</h1>
      <p>
        There is nothing at this address. The link may be mistyped, or the page may have been removed.
      </p>
      <p>
        <Link href="/">Go to the {productConfig.productName} workspace</Link> to rewrite a draft, or read the{" "}
        <Link href="/privacy">Privacy Policy</Link> or <Link href="/terms">Terms of Service</Link>.
      </p>
    </main>
  );
}
