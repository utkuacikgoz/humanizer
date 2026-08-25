import { canonicalOrigin, isCanonicalHost, normalizeHost } from "@/src/lib/public-pages";

function requestHost(request: Request) {
  return normalizeHost(
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host,
  );
}

// SEO-002 / SEO-004. The host rule is the shared one in
// src/lib/public-pages.ts, the same rule the sitemap and every page's
// metadata use. This route used to keep a private copy of `configuredSiteUrl()`
// and its own host normalization, which is how a canonical rule drifts: three
// copies, one of them a character out.
//
// Behavior is deliberately unchanged. Off the canonical host — localhost,
// staging, preview, and www until it redirects — robots.txt is a blanket
// `Disallow: /` with no `Sitemap:` line, so a non-production host can never
// invite a crawler in. tests/rendered-html.test.mjs enforces both halves.
//
// `Disallow: /history/` does not cover `/history` itself, and that is
// intentional: the page is `noindex`, and a `noindex` a crawler is forbidden
// to fetch is a `noindex` it never reads.
export function GET(request: Request) {
  const canonical = canonicalOrigin();
  if (!canonical || !isCanonicalHost(requestHost(request))) {
    return new Response([`User-agent: *`, `Disallow: /`, ``].join("\n"), {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" },
    });
  }

  return new Response(
    [
      `User-agent: *`,
      `Allow: /`,
      `Disallow: /api/`,
      `Disallow: /account/`,
      `Disallow: /admin/`,
      `Disallow: /billing/`,
      `Disallow: /checkout/`,
      `Disallow: /history/`,
      `Disallow: /result/`,
      `Disallow: /signin`,
      `Sitemap: ${canonical.origin}/sitemap.xml`,
      ``,
    ].join("\n"),
    { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } },
  );
}
