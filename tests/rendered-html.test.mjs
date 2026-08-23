import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html", host: "localhost" } }),
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
  assert.match(html, /AI Humanizer for Natural Rewrites That Preserve Meaning/);
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

test("keeps brand and pricing copy centralized", async () => {
  const [page, productConfig, pricingConfig] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/config/product.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/config/pricing.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /productConfig\.productName/);
  assert.match(page, /pricingConfig\.plans\.starter/);
  assert.doesNotMatch(page, /\$9\/month/);
  assert.match(productConfig, /productName:\s*"Humanizer"/);
  assert.match(pricingConfig, /monthlyPrice:\s*9/);
});
