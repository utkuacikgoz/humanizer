import type { Metadata } from "next";
import { headers } from "next/headers";
import { buildPublicPageMetadata, publicPage, readRequestHost } from "@/src/lib/public-pages";
import { homeStructuredData, serializeJsonLd } from "@/src/lib/site-structured-data";
import LandingPage from "./landing-page";

// SEO-005 / SEO-020 handoff H-1. This route is a server shell so that the
// homepage can own its own metadata and its own structured data, the way
// every other page in the app does. The landing surface itself is still a
// client component and still lives in one file: app/landing-page.tsx. That
// file, not this one, is the landing-copy surface the copy guards read.
//
// Splitting was not optional. A `"use client"` file cannot export
// `generateMetadata`, and adding one does not fail the build - it silently
// empties the head, which is a defect that ships.
export async function generateMetadata(): Promise<Metadata> {
  return buildPublicPageMetadata(publicPage("/"), readRequestHost(await headers()));
}

export default async function Home() {
  // SEO-006, finding F4. The SoftwareApplication entity and its Offer prices
  // are published only on the canonical host, exactly like the site-level
  // Organization/WebSite graph in app/layout.tsx.
  const structuredData = homeStructuredData(readRequestHost(await headers()));

  return (
    <>
      {structuredData ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
      ) : null}
      <LandingPage />
    </>
  );
}
