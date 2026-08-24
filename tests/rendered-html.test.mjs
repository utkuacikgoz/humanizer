import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/", host = "localhost") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`https://${host}${path}`, { headers: { accept: "text/html", host } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the paid-first writing experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  const html = await response.text();
  assert.match(html, /Keep your meaning/);
  assert.match(html, /Lose the machine tone/);
  assert.match(html, /Paste your text/);
  assert.match(html, /Humanize/);
  assert.doesNotMatch(html, /Meaning-first writing|No signup to try/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /SoftwareApplication/);
  assert.match(html, /Ownword \| Natural AI Rewrites That Preserve Meaning/);
  assert.match(html, />Ownword</);
  assert.match(html, /name="robots" content="noindex, nofollow, nocache"/);
  assert.doesNotMatch(html, /rel="canonical"/);
  assert.doesNotMatch(html, /property="og:image"/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("keeps every host out of search until the canonical domain is configured", async () => {
  const [robotsResponse, sitemapResponse] = await Promise.all([render("/robots.txt"), render("/sitemap.xml")]);
  assert.equal(robotsResponse.status, 200);
  const robots = await robotsResponse.text();
  assert.match(robots, /User-agent: \*/);
  assert.match(robots, /Disallow: \/$/m);
  assert.doesNotMatch(robots, /Sitemap:/);
  assert.equal(sitemapResponse.status, 200);
  const sitemap = await sitemapResponse.text();
  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.doesNotMatch(sitemap, /<loc>/);
});

test("does not trust an inbound host header as a canonical origin", async () => {
  const response = await render("/");
  const html = await response.text();
  assert.doesNotMatch(html, /<link rel="canonical" href="http:\/\/localhost\/?"/);
  assert.doesNotMatch(html, /<meta property="og:url" content="http:\/\/localhost\/?"/);
});

test("publishes one coherent Ownword identity on the canonical host", async () => {
  const [html, sitemap] = await Promise.all([
    render("/", "ownword.pro").then((response) => response.text()),
    render("/sitemap.xml", "ownword.pro").then((response) => response.text()),
  ]);
  assert.match(html, /<title>Ownword \| Natural AI Rewrites That Preserve Meaning<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/ownword\.pro"/);
  assert.match(html, /<meta property="og:site_name" content="Ownword"/);
  assert.match(html, /<meta property="og:image:width" content="1731"/);
  assert.doesNotMatch(html, /Humanizer|favicon\.svg|brand-mark/);
  assert.match(sitemap, /<loc>https:\/\/ownword\.pro\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/ownword\.pro\/privacy<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/ownword\.pro\/terms<\/loc>/);
});

test("keeps brand and pricing copy centralized", async () => {
  const [page, layout, privacy, terms, productConfig, pricingConfig] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/privacy/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/terms/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/config/product.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/config/pricing.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /productConfig\.productName/);
  assert.match(page, /pricingConfig\.plans\.starter/);
  assert.doesNotMatch(page, /\$9(\.99)?\/month/);
  assert.match(productConfig, /productName:\s*"Ownword"/);
  assert.match(productConfig, /domain:\s*"ownword\.pro"/);
  assert.match(productConfig, /supportEmail:\s*"support@ownword\.pro"/);
  assert.match(productConfig, /legalCompanyName:\s*"Bosphorus Elevate LLC"/);
  assert.doesNotMatch(`${page}\n${layout}`, /Bosphorus Elevate|support@ownword\.pro|favicon\.svg|brand-mark/);
  assert.match(`${privacy}\n${terms}`, /productConfig\.legalCompanyName/);
  assert.match(`${privacy}\n${terms}`, /productConfig\.supportEmail/);
  assert.doesNotMatch(page, /[—–]/, "landing copy uses sentence punctuation instead of em or en dashes");
  // Anchored: a bare /monthlyPrice:\s*9/ also matches 9.99, so it would
  // silently keep passing across a price change (MON finding).
  assert.match(pricingConfig, /monthlyPrice:\s*9\.99,/);
});

test("indexes completed legal pages only on the canonical host", async () => {
  for (const path of ["/privacy", "/terms"]) {
    const [offCanonical, canonical] = await Promise.all([render(path), render(path, "ownword.pro")]);
    assert.equal(offCanonical.status, 200);
    assert.equal(canonical.status, 200);
    assert.match(await offCanonical.text(), /name="robots" content="noindex, nofollow, nocache"/);
    const canonicalHtml = await canonical.text();
    assert.doesNotMatch(canonicalHtml, /name="robots" content="noindex, nofollow, nocache"/);
    assert.match(canonicalHtml, new RegExp(`rel="canonical" href="https://ownword\\.pro${path}"`));
    assert.match(canonicalHtml, /Bosphorus Elevate LLC/);
    assert.match(canonicalHtml, /support@ownword\.pro/);
  }
});

test("renders the configured price, not a stale hardcoded one", async () => {
  const html = await (await render()).text();
  assert.match(html, /9\.99/);
  assert.doesNotMatch(html, /\$9\b(?!\.)/);
});
