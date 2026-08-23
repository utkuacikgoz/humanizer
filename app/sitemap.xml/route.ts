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
  const publishHomepage = canonical && requestHost(request) === canonical.host.toLowerCase();
  const homepage = publishHomepage
    ? `\n  <url>\n    <loc>${canonical.origin}/</loc>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>`
    : "";
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${homepage}
</urlset>`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
