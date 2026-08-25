import assert from "node:assert/strict";
import test from "node:test";

// SEO-005's CI gate, at the surface that actually ships: it crawls the
// canonical-host sitemap and holds every URL in it to the metadata contract —
// 200, unique title, description, self-canonical, OG card, Twitter card, one
// H1. It reads the rendered HTML rather than the source, so a page that has
// not yet adopted src/lib/public-pages.ts (the homepage still declares its
// metadata through the root layout) passes on merit instead of on style, and
// a page that quietly drops a required tag fails the build.
async function render(path, host = "ownword.pro") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`https://${host}${path}`, { headers: { accept: "text/html", host } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

const tag = (html, pattern) => (html.match(pattern) ?? [])[1] ?? null;
const meta = (html, name) => tag(html, new RegExp(`<meta name="${name}" content="([^"]*)"`));
const property = (html, name) => tag(html, new RegExp(`<meta property="${name}" content="([^"]*)"`));
const withoutTrailingSlash = (url) => (url.length > 1 && url.endsWith("/") ? url.slice(0, -1) : url);

async function sitemapUrls() {
  const xml = await (await render("/sitemap.xml")).text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
}

test("every sitemap URL satisfies the public metadata contract", async () => {
  const urls = await sitemapUrls();
  assert.ok(urls.length > 0, "the canonical host must publish a non-empty sitemap");
  const seen = { titles: new Set(), descriptions: new Set() };

  for (const url of urls) {
    const { pathname, origin } = new URL(url);
    assert.equal(origin, "https://ownword.pro", `${url} is not on the canonical origin`);
    const response = await render(pathname);
    assert.equal(response.status, 200, `${url} is in the sitemap but does not return 200`);
    const html = await response.text();

    const title = tag(html, /<title>([^<]*)<\/title>/);
    const description = meta(html, "description");
    assert.ok(title && title.trim().length >= 10, `${url} is missing a usable <title>`);
    assert.ok(description && description.trim().length >= 50, `${url} is missing a usable meta description`);
    assert.ok(!seen.titles.has(title), `${url} duplicates the title of another indexable page`);
    assert.ok(!seen.descriptions.has(description), `${url} duplicates another page's meta description`);
    seen.titles.add(title);
    seen.descriptions.add(description);

    assert.equal(
      withoutTrailingSlash(tag(html, /rel="canonical" href="([^"]*)"/) ?? ""),
      withoutTrailingSlash(url),
      `${url} does not self-canonicalize`,
    );

    const robots = meta(html, "robots") ?? "";
    assert.doesNotMatch(robots, /noindex|nofollow|none/, `${url} is in the sitemap but tells crawlers to skip it`);
    assert.doesNotMatch(robots, /nonocache/, `${url} emits a robots directive no crawler defines`);

    for (const name of ["og:title", "og:description", "og:type", "og:url", "og:site_name", "og:image"]) {
      assert.ok(property(html, name), `${url} is missing ${name}`);
    }
    for (const name of ["twitter:card", "twitter:title", "twitter:description"]) {
      assert.ok(meta(html, name), `${url} is missing ${name}`);
    }
    assert.equal(property(html, "og:site_name"), "Ownword");
    assert.equal(withoutTrailingSlash(property(html, "og:url") ?? ""), withoutTrailingSlash(url));

    const headings = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)];
    assert.equal(headings.length, 1, `${url} must have exactly one H1, found ${headings.length}`);
    assert.ok(headings[0][1].replace(/<[^>]*>/g, "").trim().length > 0, `${url} has an empty H1`);
  }
});

test("keeps private surfaces out of the sitemap and out of the index", async () => {
  const urls = await sitemapUrls();
  for (const path of ["/history", "/checkout/success", "/api/history", "/result"]) {
    assert.ok(
      !urls.some((url) => new URL(url).pathname === path || new URL(url).pathname.startsWith(`${path}/`)),
      `${path} is private and must never appear in the sitemap`,
    );
  }

  for (const path of ["/history", "/checkout/success?job=9a3a2a68-ec26-49a3-a8b3-fbd5950d88e6"]) {
    const html = await (await render(path)).text();
    assert.match(meta(html, "robots") ?? "", /noindex/, `${path} must be noindex`);
    assert.equal(
      tag(html, /rel="canonical" href="([^"]*)"/),
      null,
      `${path} is private: it must not inherit the homepage canonical`,
    );
  }
});

// The one date the sitemap claims has to be the date the page shows a reader.
test("claims a lastmod only where the page itself tracks one", async () => {
  const xml = await (await render("/sitemap.xml")).text();
  const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => match[1]);
  for (const entry of entries) {
    const loc = (entry.match(/<loc>([^<]+)<\/loc>/) ?? [])[1];
    const lastmod = (entry.match(/<lastmod>([^<]+)<\/lastmod>/) ?? [])[1];
    if (!lastmod) continue;
    assert.match(lastmod, /^\d{4}-\d{2}-\d{2}$/);
    const html = await (await render(new URL(loc).pathname)).text();
    // React splits interpolated text with `<!-- -->` markers in the SSR stream.
    assert.match(
      html,
      new RegExp(`Last updated: (<!-- -->)?${lastmod}`),
      `${loc} claims a lastmod its page does not show`,
    );
  }
});
