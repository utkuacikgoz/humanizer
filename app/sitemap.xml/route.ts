import { PUBLIC_PAGES, canonicalOrigin, isCanonicalHost, normalizeHost } from "@/src/lib/public-pages";

function requestHost(request: Request) {
  return normalizeHost(
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host,
  );
}

// SEO-004. The URL list is the public-page registry in src/lib/public-pages.ts
// — the same source app/layout.tsx, /privacy and /terms build their metadata
// from — so the sitemap cannot drift into listing a route no page serves, and
// a private surface (/checkout/success, /history) cannot be added here without
// first being declared publicly indexable.
//
// `lastmod` is emitted only for pages that carry a human-maintained
// modification date (the legal pages display theirs), never a build-time
// `new Date()`: docs/SEO.md Section 6 prefers omission over a fabricated date,
// and a sitemap that claims every URL changed at deploy time teaches crawlers
// to ignore the field.
export function GET(request: Request) {
  const canonical = canonicalOrigin();
  const publish = canonical && isCanonicalHost(requestHost(request));
  const urls = publish
    ? PUBLIC_PAGES.map((page) => {
        const lastmod = page.lastModified ? `\n    <lastmod>${page.lastModified}</lastmod>` : "";
        return `\n  <url>\n    <loc>${new URL(page.path, canonical.origin).toString()}</loc>${lastmod}\n    <changefreq>${page.changefreq}</changefreq>\n    <priority>${page.priority}</priority>\n  </url>`;
      }).join("")
    : "";
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}
</urlset>`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
