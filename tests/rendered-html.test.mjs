import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { pricingConfig } from "../src/config/pricing.ts";
import { PREVIEW_LINK_TTL_HOURS } from "../src/config/retention.ts";

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
  // SEO-020 finding F4, now fixed. This request arrives on `localhost`, so
  // the page is noindex and must publish no entity claim at all: not the
  // site-level Organization/WebSite graph, and no longer the homepage's
  // SoftwareApplication block with its Offer prices in it. That block used to
  // ship on every host because it rendered from a client component that could
  // not read the request Host. The canonical-host half of this is asserted in
  // "publishes the product entity on the canonical host only" below.
  assert.doesNotMatch(html, /application\/ld\+json/);
  assert.doesNotMatch(html, /SoftwareApplication/);
  assert.match(html, /Ownword \| Natural AI Rewrites That Preserve Meaning/);
  assert.match(html, />Ownword</);
  assert.match(html, /name="robots" content="noindex, nofollow, nocache"/);
  assert.doesNotMatch(html, /rel="canonical"/);
  assert.doesNotMatch(html, /property="og:image"/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

// SEO-006 / SEO-020 finding F4. The product entity and its prices belong to
// the canonical host and nowhere else.
test("publishes the product entity on the canonical host only", async () => {
  const canonical = await (await render("/", "ownword.pro")).text();
  const blocks = [...canonical.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((match) => JSON.parse(match[1]));
  const software = blocks.find((block) => block["@type"] === "SoftwareApplication");
  assert.ok(software, "the canonical homepage must describe the product");
  assert.equal(software.name, "Ownword");
  assert.ok(Array.isArray(software.offers) && software.offers.length > 0, "a purchasable plan must carry an Offer");
  for (const offer of software.offers) {
    assert.equal(offer["@type"], "Offer");
    assert.match(offer.price, /^\d+(\.\d+)?$/);
    assert.equal(offer.priceCurrency, "USD");
  }
  // The graph the root layout emits is separate and must still be there.
  assert.ok(blocks.some((block) => Array.isArray(block["@graph"])), "the site graph must still be emitted");

  for (const host of ["staging.ownword.pro", "localhost", "www.ownword.pro.example.com"]) {
    const offHost = await (await render("/", host)).text();
    assert.doesNotMatch(offHost, /SoftwareApplication/, `${host} must not publish the product entity`);
    assert.doesNotMatch(offHost, /"@type":"Offer"/, `${host} must not publish a price`);
  }
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
  // SEO handoff H-1 split the homepage route into a server shell
  // (app/page.tsx) and the landing surface (app/landing-page.tsx). The copy
  // this test guards moved with the surface, so the guard follows it. `shell`
  // is read too, so a value that migrates back up into the route file is
  // still caught.
  const [page, shell, layout, privacy, terms, productConfig, pricingConfig] = await Promise.all([
    readFile(new URL("../app/landing-page.tsx", import.meta.url), "utf8"),
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
  assert.doesNotMatch(`${page}\n${shell}\n${layout}`, /Bosphorus Elevate|support@ownword\.pro|favicon\.svg|brand-mark/);
  assert.match(`${privacy}\n${terms}`, /productConfig\.legalCompanyName/);
  assert.match(`${privacy}\n${terms}`, /productConfig\.supportEmail/);
  assert.doesNotMatch(`${page}\n${shell}`, /[—–]/, "landing copy uses sentence punctuation instead of em or en dashes");
  // Anchored: a bare /monthlyPrice:\s*9/ also matches 9.99, so it would
  // silently keep passing across a price change (MON finding).
  assert.match(pricingConfig, /monthlyPrice:\s*9\.99,/);
});

// ---------------------------------------------------------------------
// The pricing band's roadmap rows
// ---------------------------------------------------------------------
//
// Unbuilt capabilities used to sit outside the ruled feature list, in a
// trailing "Not included." sentence. That made a planned capability reading as
// a bought one structurally impossible, and it also made it a paragraph most
// people's eyes slide past. The rows are inside the card now with a per row
// status, which is harder to miss and easier to get wrong, so the property
// docs/MONETIZATION.md actually cares about is asserted here instead of being
// guaranteed by the layout.

/** Every `<li>` in the document, markup intact. */
const listItems = (html) => [...html.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/g)].map((match) => match[0]);
// React's SSR splits an interpolated value out of its sentence with comment
// markers, so a copy assertion has to read the text a person sees, not the
// markup.
const visible = (markup) =>
  markup.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

test("no planned capability can read as one the customer has bought", async () => {
  const html = await (await render("/", "ownword.pro")).text();
  const rows = listItems(html);
  assert.ok(rows.length > 0, "the page rendered no list items at all, so this test would prove nothing");

  for (const plan of Object.values(pricingConfig.plans)) {
    if (plan.availability !== "active") continue;

    for (const feature of plan.plannedFeatures) {
      const row = rows.find((item) => visible(item).includes(feature));
      assert.ok(row, `${plan.id} does not render its planned capability "${feature}" at all`);

      // The status is real text inside the row, so a screen reader reads it as
      // part of the list item rather than it being carried by colour alone.
      assert.match(
        row,
        /class="plan-status"[^>]*>[^<]*[^\s<]/,
        `"${feature}" renders with no status, so it reads as a delivered feature`,
      );
      // A tick means "you get this". A roadmap row may never carry one.
      assert.doesNotMatch(
        row,
        /<svg\b/,
        `"${feature}" carries the included-feature marker while not being included`,
      );
      // And no word implying a date nobody has agreed to. docs/PRODUCT.md
      // defers every one of these past V1 with no schedule.
      assert.doesNotMatch(
        visible(row),
        /coming soon|shortly|next month|this year|Q[1-4] 20|\b20\d\d\b/i,
        `"${feature}" promises a date for something that has none`,
      );
    }

    // The delivered features are the ones that carry the marker.
    for (const feature of plan.features) {
      if (/words/i.test(feature)) continue; // the allowance is the cards' own line
      const row = rows.find((item) => visible(item).includes(feature));
      assert.ok(row, `"${feature}" is sold but not shown`);
      assert.match(row, /<svg\b/, `"${feature}" is included but carries no marker`);
      assert.doesNotMatch(row, /class="plan-status"/, `"${feature}" is included but wears a roadmap status`);
    }

    // The allowance is the one thing the two plans differ by, so it is on the
    // card, and it comes from the catalog.
    assert.ok(
      html.includes(plan.wordLimit.toLocaleString("en-US")),
      `${plan.id} does not show the allowance it is sold on`,
    );
  }
});

test("the pricing band's only deadline is the one the database enforces", async () => {
  const [html, source] = await Promise.all([
    (await render("/", "ownword.pro")).text(),
    readFile(new URL("../app/landing-page.tsx", import.meta.url), "utf8"),
  ]);

  // Stated, and stated as the value the capability token is actually stamped
  // with. A lifetime written down a second time is the invented scarcity
  // docs/ACTIVATION.md rejects, arriving by drift rather than by intent.
  assert.match(visible(html), new RegExp(`stays open for ${PREVIEW_LINK_TTL_HOURS} hours`));
  assert.match(source, /PREVIEW_LINK_TTL_HOURS/);
  assert.doesNotMatch(
    source.replace(/^\s*\/\/.*$/gm, ""),
    /24 hours/,
    "the preview lifetime must be read from src/config/retention.ts, not written out",
  );

  // The other real pressure: the visitor's own unread words, rendered from the
  // live result and therefore absent when there is no result to be urgent
  // about.
  assert.match(source, /unreadWords > 0/);
  assert.match(source, /\$\{unreadWords\} more words of your rewrite/);

  // Nothing invented. No timer, no seat count, no deadline on the price.
  const band = html.match(/<section class="pricing"[\s\S]*?<\/section>/);
  assert.ok(band, "the pricing band did not render");
  assert.doesNotMatch(
    visible(band[0]),
    /limited time|hurry|only \d+ (left|remaining|seats)|today only|ends (in|soon)|\d+ (people|customers)|free trial/i,
    "the pricing band introduced urgency that is not a fact about this product",
  );
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
  for (const path of ["/api/", "/account/", "/admin/", "/billing/", "/checkout/", "/history/", "/result/"]) {
    assert.match(canonical, new RegExp(`^Disallow: ${path.replace(/\//g, "\\/")}$`, "m"), `${path} must stay disallowed`);
  }
  // /history and /signin are deliberately crawlable so their noindex can be
  // read; only the subtree below /history is disallowed. /signin is linked
  // from the header of the homepage, so disallowing it would have left a URL
  // a crawler is invited to and forbidden to read - the one shape that gets
  // indexed URL-only. See the comment in app/robots.txt/route.ts.
  assert.doesNotMatch(canonical, /^Disallow: \/history$/m);
  assert.doesNotMatch(canonical, /^Disallow: \/signin$/m);

  for (const host of ["localhost", "staging.ownword.pro", "ownword.pro.example.com"]) {
    const offHost = await (await render("/robots.txt", host)).text();
    assert.match(offHost, /^Disallow: \/$/m, `${host} must fail closed`);
    assert.doesNotMatch(offHost, /Allow: \//);
    assert.doesNotMatch(offHost, /Sitemap:/);
  }
});
