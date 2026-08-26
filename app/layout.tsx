import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { productConfig } from "@/src/config/product";
import { buildPrivateSurfaceMetadata, readRequestHost } from "@/src/lib/public-pages";
import { serializeJsonLd, siteStructuredData } from "@/src/lib/site-structured-data";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// SEO-005 / SEO-020 handoff H-1. The root layout's default is fail-closed:
// a name for the tab, and nothing a crawler can act on. It deliberately does
// NOT supply the homepage's title, description, canonical, Open Graph or
// Twitter card any more.
//
// It used to. Every route in the app sits under this layout, so the homepage's
// identity was the site-wide default, and any page that did not override it
// shipped `<link rel="canonical" href="https://ownword.pro">` and the
// homepage's social card. SEO-020 measured exactly that on a genuine 404 and
// on all three private surfaces; both were patched at the page, but the cause
// was here. Now the homepage declares its own metadata in `app/page.tsx` like
// every other page, and a route that forgets to declare any is `noindex` with
// no canonical instead of claiming to be the homepage.
//
// Static rather than `generateMetadata()`: none of what is left depends on
// the request host.
export const metadata: Metadata = {
  ...buildPrivateSurfaceMetadata(productConfig.productName),
  // One SVG serves the tab, the bookmark, and the home-screen tile. It is
  // built to survive 16px: a solid tile, one counter-form, no hairlines.
  icons: { icon: "/icon.svg", shortcut: "/icon.svg", apple: "/icon.svg" },
  // SEO-009. Bing Webmaster Tools proves ownership by finding this token in
  // the homepage head. It is a public token by design, not a credential: it
  // is served to every visitor and grants nothing beyond letting Bing match
  // the site to the account that claimed it. Ungated on purpose, unlike the
  // canonical and JSON-LD, because Bing may fetch through a host this
  // application does not treat as canonical and a missing tag reads as a
  // failed verification. Remove only if the Bing property is abandoned.
  verification: { other: { "msvalidate.01": "35512891FA02F1073134A440502FDF47" } },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // SEO-006. Site-level Organization/WebSite entity, emitted only on the
  // canonical host. Off it, every page is noindex and claims nothing.
  const structuredData = siteStructuredData(readRequestHost(await headers()));

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {structuredData ? (
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
        ) : null}
        {children}
      </body>
    </html>
  );
}
