import { productConfig } from "@/src/config/product";

function configuredSiteUrl() {
  const configuredDomain = productConfig.domain.trim();
  if (!configuredDomain) return null;

  try {
    return new URL(/^https?:\/\//i.test(configuredDomain) ? configuredDomain : `https://${configuredDomain}`);
  } catch {
    return null;
  }
}

function requestHost(request: Request) {
  return (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host)
    .split(",")[0]
    .trim()
    .toLowerCase();
}

export function GET(request: Request) {
  const canonical = configuredSiteUrl();
  if (!canonical || requestHost(request) !== canonical.host.toLowerCase()) {
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
      `Disallow: /signin-with-chatgpt`,
      `Sitemap: ${canonical.origin}/sitemap.xml`,
      ``,
    ].join("\n"),
    { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } },
  );
}
