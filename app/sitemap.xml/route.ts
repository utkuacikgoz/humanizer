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

// Only routes that (a) genuinely exist under app/, (b) return 200, and (c)
// are meant to be publicly indexable belong here. Do not add a path just
// because it's planned — see docs/SEO.md's backlog for what's still open.
const INDEXABLE_ROUTES: Array<{ path: string; changefreq: string; priority: string }> = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/privacy", changefreq: "yearly", priority: "0.3" },
  { path: "/terms", changefreq: "yearly", priority: "0.3" },
];

export function GET(request: Request) {
  const canonical = configuredSiteUrl();
  const publish = canonical && requestHost(request) === canonical.host.toLowerCase();
  const urls = publish
    ? INDEXABLE_ROUTES.map(
        (route) =>
          `\n  <url>\n    <loc>${new URL(route.path, canonical.origin).toString()}</loc>\n    <changefreq>${route.changefreq}</changefreq>\n    <priority>${route.priority}</priority>\n  </url>`,
      ).join("")
    : "";
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}
</urlset>`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
