import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

  for (const path of ["/history", "/signin", "/checkout/success?job=9a3a2a68-ec26-49a3-a8b3-fbd5950d88e6"]) {
    const html = await (await render(path)).text();
    assert.match(meta(html, "robots") ?? "", /noindex/, `${path} must be noindex`);
    assert.match(meta(html, "robots") ?? "", /nofollow/, `${path} must be nofollow`);
    assert.equal(
      tag(html, /rel="canonical" href="([^"]*)"/),
      null,
      `${path} is private: it must not inherit the homepage canonical`,
    );
    // Everything below is inherited from the root layout unless a private
    // surface explicitly drops it, and the root layout's default is the
    // homepage's own public metadata. A private URL that unfurls as the
    // homepage is claiming to be a page it is not.
    assert.equal(meta(html, "description"), null, `${path} must not inherit the homepage description`);
    for (const name of ["og:title", "og:description", "og:url", "og:image", "og:site_name"]) {
      assert.equal(property(html, name), null, `${path} must not inherit the homepage ${name}`);
    }
    for (const name of ["twitter:card", "twitter:title", "twitter:description"]) {
      assert.equal(meta(html, name), null, `${path} must not inherit the homepage ${name}`);
    }
  }
});

// SEO-020 handoff H-4. Before app/not-found.tsx existed, an unknown path fell
// through to the framework's built-in 404 underneath the root layout and so
// declared the homepage as its canonical. Repeated across every broken link
// and stale URL, that is how a missing page gets folded into `/`.
test("a genuine 404 is a 404, and claims nothing about the homepage", async () => {
  for (const path of ["/this-page-does-not-exist", "/result/abc", "/guides/not-written-yet"]) {
    const response = await render(path);
    assert.equal(response.status, 404, `${path} must return a genuine 404, not a soft 200`);
    const html = await response.text();

    assert.equal(
      tag(html, /rel="canonical" href="([^"]*)"/),
      null,
      `${path} must not point crawlers at a page that is not this one`,
    );
    assert.equal(meta(html, "description"), null, `${path} must not inherit the homepage description`);
    for (const name of ["og:title", "og:url", "og:image"]) {
      assert.equal(property(html, name), null, `${path} must not inherit the homepage ${name}`);
    }

    // The framework emits its own `noindex` too, so there are two robots
    // tags. Crawlers combine them and the most restrictive wins; both are
    // noindex, so what matters is that neither of them ever says index.
    const robotsTags = [...html.matchAll(/<meta name="robots" content="([^"]*)"/g)].map((match) => match[1]);
    assert.ok(robotsTags.length > 0, `${path} must tell crawlers not to index it`);
    for (const directive of robotsTags) {
      assert.match(directive, /noindex/, `${path} emitted a robots tag without noindex: ${directive}`);
    }
    assert.ok(robotsTags.some((directive) => /nofollow/.test(directive)), `${path} must also be nofollow`);

    const headings = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)];
    assert.equal(headings.length, 1, `${path} must have exactly one H1, found ${headings.length}`);
    assert.match(html, /href="\/"/, `${path} must offer a route back into the site`);
    assert.ok(!/Ownword \| Natural AI Rewrites/.test(tag(html, /<title>([^<]*)<\/title>/) ?? ""),
      `${path} must not wear the homepage title`);
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

// SEO-005 / SEO-020 handoff H-1. The two structural facts the field gate
// above cannot see, because both of them fail by producing *plausible* HTML.
//
// The root layout used to supply the homepage's title, description, canonical
// and social card as the site-wide default. Every private surface and the 404
// then had to remember to null all of it out, and the ones that forgot
// unfurled as the homepage. The gate above cannot catch a regression here,
// because a page that re-inherits the homepage canonical looks correct on `/`
// and is only wrong everywhere else.
//
// And `app/page.tsx` must stay a server component. Adding "use client" back
// does not fail the build: `generateMetadata` is silently ignored and the
// homepage ships with an empty head. That was measured, not assumed.
test("the homepage owns its metadata and the root layout lends none", async () => {
  const [layout, home] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(
    layout,
    /buildPublicPageMetadata|publicPage\(/,
    "the root layout must not make one page's identity the default for every page under it",
  );
  assert.match(layout, /buildPrivateSurfaceMetadata/, "the root layout's metadata default must fail closed");

  assert.doesNotMatch(
    home,
    /^\s*["']use client["']/m,
    'app/page.tsx must stay a server component: a "use client" route drops generateMetadata silently',
  );
  assert.match(
    home,
    /buildPublicPageMetadata\(publicPage\("\/"\), readRequestHost\(await headers\(\)\)\)/,
    "the homepage must build its metadata from the shared registry like every other public page",
  );
});
