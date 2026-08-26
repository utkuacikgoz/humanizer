import { CRAWLER_DISALLOWED_PREFIXES, canonicalOrigin, isCanonicalHost, normalizeHost } from "@/src/lib/public-pages";

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
//
// `/signin` follows the same rule, and this is a reversal. It used to be
// `Disallow`ed. The third SEO-020 crawl pass found what made that the wrong
// half of the trade: `/signin` is not like `/checkout/success`, which is
// reached only through a Stripe redirect and is linked from nowhere. It is
// linked from the header of `/`, the site's most indexable page. A URL that a
// crawler is told not to fetch, but is handed a link to from an indexable
// page, is precisely the case where Google indexes it URL-only, with no
// snippet and no way for the page to object - because the `noindex` sits
// behind the `Disallow`. Letting the crawler read the `noindex` is the only
// instruction that actually removes it. Nothing on `/signin` needs hiding
// from a fetch: it is a public GET with an email field and no secret.
//
// The invariant this restores is asserted in tests/page-quality-gate.test.mjs:
// no indexable page may link to a path robots.txt disallows.
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
      ...CRAWLER_DISALLOWED_PREFIXES.map((prefix) => `Disallow: ${prefix}`),
      `Sitemap: ${canonical.origin}/sitemap.xml`,
      ``,
    ].join("\n"),
    { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } },
  );
}
