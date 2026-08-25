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

test("never indexes the private checkout result surface", async () => {
  const response = await render("/checkout/success?job=9a3a2a68-ec26-49a3-a8b3-fbd5950d88e6", "ownword.pro");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /name="robots" content="noindex, nofollow, nocache"/);
  assert.doesNotMatch(html, /rel="canonical" href="https:\/\/ownword\.pro\/checkout/);
});

test("renders the configured price, not a stale hardcoded one", async () => {
  const html = await (await render()).text();
  assert.match(html, /9\.99/);
  assert.doesNotMatch(html, /\$9\b(?!\.)/);
});

// SEO-003 / handoff H-3. `www.ownword.pro` is a bound custom domain. It used
// to serve the whole application on a second hostname — fail-closed, so
// nothing duplicate was indexed, but a link earned on a www URL consolidated
// nothing.
test("redirects the www host to the apex in one hop, keeping method and query", async () => {
  const home = await render("/", "www.ownword.pro");
  assert.equal(home.status, 308, "301 lets a client rewrite POST to GET; 308 does not");
  assert.equal(home.headers.get("location"), "https://ownword.pro/");

  const query = await render("/privacy?utm_source=newsletter&a=b", "www.ownword.pro");
  assert.equal(query.headers.get("location"), "https://ownword.pro/privacy?utm_source=newsletter&a=b");

  // Case-insensitive: a Host header is not required to be lowercase.
  assert.equal((await render("/terms", "WWW.OwnWord.PRO")).headers.get("location"), "https://ownword.pro/terms");

  // One hop: the apex must answer, not redirect again.
  assert.equal((await render("/", "ownword.pro")).status, 200);

  // Neighbouring hostnames are not www, and must not be swept up.
  for (const host of ["ownword.pro", "localhost", "staging.ownword.pro", "wwwownword.pro", "www.ownword.pro.example.com"]) {
    assert.notEqual((await render("/", host)).status, 308, `${host} must not be redirected`);
  }
});

test("never redirects the apex to itself on a spoofed forwarded host", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("https://ownword.pro/", { headers: { host: "ownword.pro", "x-forwarded-host": "www.ownword.pro" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200, "an inbound header claiming www must not start a redirect loop on the apex");
});

// SEO-002 / handoff H-2. The route now reads the shared host rule instead of
// keeping a private copy; these assert the output did not move with it.
test("robots.txt allows the canonical host and fails closed everywhere else", async () => {
  const canonical = await (await render("/robots.txt", "ownword.pro")).text();
  assert.match(canonical, /^User-agent: \*$/m);
  assert.match(canonical, /^Allow: \/$/m);
  assert.match(canonical, /^Sitemap: https:\/\/ownword\.pro\/sitemap\.xml$/m);
  for (const path of ["/api/", "/account/", "/admin/", "/billing/", "/checkout/", "/history/", "/result/", "/signin"]) {
    assert.match(canonical, new RegExp(`^Disallow: ${path.replace(/\//g, "\\/")}$`, "m"), `${path} must stay disallowed`);
  }
  // /history is deliberately crawlable so its noindex can be read; only the
  // subtree below it is disallowed.
  assert.doesNotMatch(canonical, /^Disallow: \/history$/m);

  for (const host of ["localhost", "staging.ownword.pro", "ownword.pro.example.com"]) {
    const offHost = await (await render("/robots.txt", host)).text();
    assert.match(offHost, /^Disallow: \/$/m, `${host} must fail closed`);
    assert.doesNotMatch(offHost, /Allow: \//);
    assert.doesNotMatch(offHost, /Sitemap:/);
  }
});
