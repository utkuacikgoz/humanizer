import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { buildPublicPageMetadata, publicPage, readRequestHost } from "@/src/lib/public-pages";
import { serializeJsonLd, siteStructuredData } from "@/src/lib/site-structured-data";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// SEO-005. Title, description, canonical, robots, OG and Twitter all come
// from the one public-page registry in src/lib/public-pages.ts. The homepage
// entry doubles as the site-wide default: private routes (/checkout/success,
// /history) override `robots` and drop the canonical in their own layouts.
export async function generateMetadata(): Promise<Metadata> {
  const requestHost = readRequestHost(await headers());

  return {
    ...buildPublicPageMetadata(publicPage("/"), requestHost),
    // One SVG serves the tab, the bookmark, and the home-screen tile. It is
    // built to survive 16px: a solid tile, one counter-form, no hairlines.
    icons: { icon: "/icon.svg", shortcut: "/icon.svg", apple: "/icon.svg" },
  };
}

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
