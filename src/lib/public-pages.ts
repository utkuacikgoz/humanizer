// SEO-005 / SEO-004. One registry for every publicly indexable page, and one
// builder for the metadata contract each of them owes.
//
// Before this module, `app/layout.tsx`, `app/privacy/page.tsx` and
// `app/terms/page.tsx` each carried a hand-copied `configuredSiteUrl()` +
// `generateMetadata()` pair, and `app/sitemap.xml/route.ts` kept a fourth,
// separate list of the same routes. Four copies meant a new page could ship
// with a missing canonical, a missing OG card, or a sitemap entry for a URL
// no page actually serves.
//
// Deliberately free of `cloudflare:workers`, `next/headers` and
// `next/navigation`: those do not resolve under plain Node, and every module
// they touch crashes `tests/*.test.mts` at import time. The host arrives as a
// plain string, so the route/page layer stays a two-line adapter and the
// rules stay testable directly.
import type { Metadata } from "next";
import { productConfig } from "@/src/config/product";

export type PublicPage = {
  /** Absolute, canonical path. Must be a route that exists under `app/` and returns 200. */
  path: string;
  title: string;
  description: string;
  ogType: "website" | "article";
  changefreq: string;
  priority: string;
  /**
   * ISO `YYYY-MM-DD`, and only when the page genuinely tracks a material
   * modification date that a human maintains (the legal pages display one).
   * Omit otherwise: docs/SEO.md Section 6 prefers no `lastmod` over a
   * fabricated one, and a build-time `new Date()` would be exactly that.
   */
  lastModified?: string;
  /**
   * SEO-013. The one search intent this page exists to answer, in a sentence,
   * describing the reader rather than the keyword.
   *
   * Required, and required to be unique: docs/SEO.md Section 6's release gate
   * says a page has "one primary search intent and one primary conversion
   * action", and Section 3's decision rule refuses near-duplicate pages. Two
   * pages that cannot state different intents are one page.
   */
  intent: string;
  /**
   * SEO-013. The role accountable for the words on this page, so a claim on
   * it has an owner. A role, not a person: this repository has no author
   * identities to cite and inventing one is exactly the fabricated expert
   * identity Section 1 forbids.
   */
  contentOwner: ContentOwner;
  /**
   * SEO-013. The page's one primary conversion action, as it is actually
   * rendered. `href` for a link, omitted when the action is an in-page
   * control. The quality gate finds it in the rendered HTML, so a page cannot
   * declare a next step it does not offer.
   */
  primaryCta: { label: string; href?: string };
};

/** The roles that can be accountable for public copy. See docs/MEMORY.md. */
export type ContentOwner = "Product" | "Copy" | "Legal" | "SEO" | "Engineering";

/**
 * The brand card. Real file in `public/`, real dimensions, no claim in it that
 * the product cannot back.
 */
export const SOCIAL_IMAGE = {
  path: "/og.png",
  width: 1731,
  height: 909,
  alt: "Keep your meaning. Lose the machine tone.",
} as const;

export const LEGAL_PAGES_LAST_UPDATED = "2026-08-25";

/**
 * Only routes that (a) genuinely exist under `app/`, (b) return 200, and (c)
 * are meant to be publicly indexable belong here. Do not add a path because
 * it is planned — see docs/SEO.md Section 11 for what is still open.
 *
 * Private surfaces (`/checkout/success`, `/history`, `/api/*`) are absent by
 * design; they carry `noindex` in their own layouts and must never appear in
 * the sitemap or in structured data.
 */
export const PUBLIC_PAGES: readonly PublicPage[] = [
  {
    path: "/",
    title: `${productConfig.productName} | Natural AI Rewrites That Preserve Meaning`,
    description: `${productConfig.productName} turns generic AI assisted drafts into natural writing while protecting your meaning, facts, terminology, citations, and intended tone.`,
    ogType: "website",
    changefreq: "weekly",
    priority: "1.0",
    intent: "Someone holding an AI assisted draft that reads like a machine wrote it, who wants it to sound like them without the meaning, facts or citations moving.",
    contentOwner: "Copy",
    primaryCta: { label: "Humanize" },
  },
  {
    path: "/privacy",
    title: `Privacy Policy | ${productConfig.productName}`,
    description: `How ${productConfig.productName}, operated by ${productConfig.legalCompanyName}, handles the text you paste and your account data.`,
    ogType: "article",
    changefreq: "yearly",
    priority: "0.2",
    lastModified: LEGAL_PAGES_LAST_UPDATED,
    intent: "Someone deciding whether to paste their own writing into this service, who wants to know what happens to it, how long it is kept, and who can read it.",
    contentOwner: "Legal",
    primaryCta: { label: "Back to Ownword", href: "/" },
  },
  {
    path: "/terms",
    title: `Terms of Service | ${productConfig.productName}`,
    description: `The terms that govern your use of ${productConfig.productName}, operated by ${productConfig.legalCompanyName}.`,
    ogType: "article",
    changefreq: "yearly",
    priority: "0.2",
    lastModified: LEGAL_PAGES_LAST_UPDATED,
    intent: "Someone about to pay, or already paying, who wants to know what they are agreeing to, what it costs, and how to stop it.",
    contentOwner: "Legal",
    primaryCta: { label: "Back to Ownword", href: "/" },
  },
];

/**
 * SEO-013. The paths robots.txt tells crawlers not to fetch, as prefixes.
 *
 * Kept here rather than inside `app/robots.txt/route.ts` so the quality gate
 * can hold the one invariant that ties the two together: an indexable page
 * must not link to a path a crawler is forbidden to fetch. That combination -
 * invited by a link, refused by robots.txt - is the shape Google indexes
 * URL-only, with no snippet and no way for the page's own `noindex` to be
 * read, because the `noindex` sits behind the `Disallow`.
 */
export const CRAWLER_DISALLOWED_PREFIXES: readonly string[] = [
  "/api/",
  "/account/",
  "/admin/",
  "/billing/",
  "/checkout/",
  "/history/",
  "/result/",
];

export function publicPage(path: string): PublicPage {
  const page = PUBLIC_PAGES.find((candidate) => candidate.path === path);
  if (!page) throw new Error(`No public page is registered for ${path}`);
  return page;
}

/** The configured canonical origin, or null when the domain is unset/unparseable. */
export function canonicalOrigin(): URL | null {
  const configuredDomain = productConfig.domain.trim();
  if (!configuredDomain) return null;
  try {
    return new URL(/^https?:\/\//i.test(configuredDomain) ? configuredDomain : `https://${configuredDomain}`);
  } catch {
    return null;
  }
}

/**
 * SEO-002. The one host rule, shared by robots.txt, the sitemap and every
 * page's metadata: output is canonical only when the request actually arrived
 * on the configured domain. A staging, preview or localhost Host never gets a
 * canonical it cannot serve, and never gets indexed.
 */
export function isCanonicalHost(requestHost: string): boolean {
  const canonical = canonicalOrigin();
  if (!canonical) return false;
  return normalizeHost(requestHost) === canonical.host.toLowerCase();
}

export function normalizeHost(host: string | null | undefined): string {
  return (host ?? "").split(",")[0].trim().toLowerCase();
}

/** Reads the request host from a Headers-like object, forwarded host first. */
export function readRequestHost(headers: { get(name: string): string | null }): string {
  return normalizeHost(headers.get("x-forwarded-host") ?? headers.get("host"));
}

export function canonicalUrlFor(path: string): URL | null {
  const canonical = canonicalOrigin();
  return canonical ? new URL(path, canonical.origin) : null;
}

/**
 * SEO-005. The metadata every public page owes: unique title and description,
 * self-canonical, OG card and Twitter card — all of it host-gated, so off the
 * canonical host a page is `noindex, nofollow, nocache` with no canonical, no
 * `og:url` and no social image.
 */
export function buildPublicPageMetadata(page: PublicPage, requestHost: string): Metadata {
  const canonicalBase = isCanonicalHost(requestHost) ? canonicalOrigin() : null;
  const canonicalUrl = canonicalBase ? new URL(page.path, canonicalBase.origin) : null;
  const socialImage = canonicalBase
    ? {
        url: new URL(SOCIAL_IMAGE.path, canonicalBase.origin),
        width: SOCIAL_IMAGE.width,
        height: SOCIAL_IMAGE.height,
        alt: SOCIAL_IMAGE.alt,
      }
    : undefined;

  return {
    metadataBase: canonicalBase ? new URL("/", canonicalBase.origin) : undefined,
    title: page.title,
    description: page.description,
    alternates: canonicalUrl ? { canonical: canonicalUrl } : undefined,
    // `nocache` is set only when it is true. Next serializes an explicit
    // `nocache: false` as the literal directive `nonocache` (SEO-020 found it
    // shipping in `index, follow, nonocache`), which is not a directive any
    // crawler defines — omission is the way to say "caching is fine".
    robots: canonicalUrl
      ? { index: true, follow: true }
      : { index: false, follow: false, nocache: true },
    openGraph: {
      title: page.title,
      description: page.description,
      type: page.ogType,
      url: canonicalUrl ?? undefined,
      siteName: productConfig.productName,
      images: socialImage ? [socialImage] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
      images: socialImage ? [socialImage.url] : undefined,
    },
  };
}

/**
 * SEO-002 / SEO-005. The metadata every *non*-indexable surface owes, and the
 * counterpart to `buildPublicPageMetadata`. Private and error surfaces sit
 * under the root layout, which supplies the homepage's public metadata as the
 * site-wide default, so without an explicit override a signed-in history page
 * or a genuine 404 ships the homepage's canonical, description, `og:url` and
 * social card. SEO-020 measured exactly that.
 *
 * Every field is nulled rather than replaced: Next merges a `null` as "drop
 * the inherited value", which is what a page with nothing to say to a crawler
 * needs. `title` is the one thing a caller may supply, because a browser tab
 * and a bookmark still need a name.
 */
export function buildPrivateSurfaceMetadata(title?: string): Metadata {
  return {
    ...(title ? { title } : {}),
    description: null,
    alternates: { canonical: null },
    robots: { index: false, follow: false, nocache: true },
    openGraph: null,
    twitter: null,
  };
}
