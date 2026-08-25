import assert from "node:assert/strict";
import test from "node:test";
import {
  PUBLIC_PAGES,
  buildPublicPageMetadata,
  canonicalUrlFor,
  isCanonicalHost,
  publicPage,
  readRequestHost,
} from "../src/lib/public-pages";
import { serializeJsonLd, siteStructuredData } from "../src/lib/site-structured-data";

const CANONICAL_HOST = "ownword.pro";
const PRIVATE_PREFIXES = ["/api", "/account", "/admin", "/billing", "/checkout", "/history", "/result", "/signin"];

function headers(values: Record<string, string>) {
  return { get: (name: string) => values[name.toLowerCase()] ?? null };
}

test("registers only canonical, public, existing paths", () => {
  const paths = PUBLIC_PAGES.map((page) => page.path);
  assert.deepEqual(paths, [...new Set(paths)], "a duplicate path would produce two sitemap entries for one URL");
  for (const page of PUBLIC_PAGES) {
    assert.match(page.path, /^\/[^?#]*$/, `${page.path} must be an absolute path with no query or fragment`);
    assert.ok(page.path === "/" || !page.path.endsWith("/"), `${page.path} must not carry a trailing slash`);
    for (const prefix of PRIVATE_PREFIXES) {
      assert.ok(
        page.path !== prefix && !page.path.startsWith(`${prefix}/`),
        `${page.path} is a private surface and must never be publicly indexable`,
      );
    }
  }
});

// SEO-005's CI contract, at the source: a page cannot enter the registry
// without the fields every public page owes.
test("gives every public page a unique, non-boilerplate title and description", () => {
  const titles = PUBLIC_PAGES.map((page) => page.title);
  const descriptions = PUBLIC_PAGES.map((page) => page.description);
  assert.deepEqual(titles, [...new Set(titles)], "duplicate titles cannibalize each other in search results");
  assert.deepEqual(descriptions, [...new Set(descriptions)]);
  for (const page of PUBLIC_PAGES) {
    assert.ok(page.title.length >= 10 && page.title.length <= 70, `${page.path} title length: ${page.title.length}`);
    assert.ok(
      page.description.length >= 50 && page.description.length <= 200,
      `${page.path} description length: ${page.description.length}`,
    );
    assert.ok(page.priority.length > 0 && page.changefreq.length > 0);
  }
});

// docs/SEO.md Section 6: omit `lastmod` rather than fabricate one. A page may
// only claim a modification date it actually tracks, and never a future one.
test("emits only real, non-future modification dates", () => {
  const today = new Date().toISOString().slice(0, 10);
  for (const page of PUBLIC_PAGES) {
    if (page.lastModified === undefined) continue;
    assert.match(page.lastModified, /^\d{4}-\d{2}-\d{2}$/, `${page.path} lastmod must be ISO YYYY-MM-DD`);
    assert.ok(!Number.isNaN(Date.parse(page.lastModified)), `${page.path} lastmod is not a real date`);
    assert.ok(page.lastModified <= today, `${page.path} claims a modification date in the future`);
  }
});

test("publishes indexable metadata only on the canonical host", () => {
  const metadata = buildPublicPageMetadata(publicPage("/privacy"), CANONICAL_HOST);
  assert.equal(metadata.title, "Privacy Policy | Ownword");
  assert.equal(String(metadata.alternates?.canonical), "https://ownword.pro/privacy");
  assert.deepEqual(metadata.robots, { index: true, follow: true });
  assert.equal(metadata.openGraph?.title, metadata.title);
  assert.equal(metadata.openGraph?.description, metadata.description);
  // `OpenGraph`/`Twitter` are discriminated unions; read the discriminant off
  // a plain record rather than narrowing every variant.
  const openGraph = metadata.openGraph as Record<string, unknown> | undefined;
  const twitter = metadata.twitter as Record<string, unknown> | undefined;
  assert.equal(openGraph?.type, "article");
  assert.equal(openGraph?.siteName, "Ownword");
  assert.equal(String(openGraph?.url), "https://ownword.pro/privacy");
  assert.equal(twitter?.card, "summary_large_image");
  assert.ok(JSON.stringify(metadata.openGraph?.images).includes("/og.png"));
});

// Next serializes an explicit `nocache: false` as the meaningless directive
// `nonocache`. Indexable pages must simply not mention it.
test("never emits a nonocache robots directive", () => {
  const metadata = buildPublicPageMetadata(publicPage("/"), CANONICAL_HOST);
  assert.ok(metadata.robots && typeof metadata.robots === "object" && !("nocache" in metadata.robots));
});

test("fails closed on every host that is not the canonical domain", () => {
  for (const host of ["localhost", "www.ownword.pro", "ownword.pro.evil.example", "staging.ownword.pro", ""]) {
    const metadata = buildPublicPageMetadata(publicPage("/"), host);
    assert.equal(isCanonicalHost(host), false, `${host} must not be treated as canonical`);
    assert.equal(metadata.alternates, undefined, `${host} emitted a canonical it cannot serve`);
    assert.deepEqual(metadata.robots, { index: false, follow: false, nocache: true });
    assert.equal(metadata.metadataBase, undefined);
    assert.equal(metadata.openGraph?.url, undefined);
    assert.equal(metadata.openGraph?.images, undefined);
    assert.equal(metadata.twitter?.images, undefined);
  }
});

test("reads the request host without trusting a forwarded list or casing", () => {
  assert.equal(readRequestHost(headers({ host: "OwnWord.PRO" })), "ownword.pro");
  assert.equal(readRequestHost(headers({ "x-forwarded-host": "ownword.pro", host: "internal" })), "ownword.pro");
  assert.equal(readRequestHost(headers({ host: "ownword.pro, evil.example" })), "ownword.pro");
  assert.equal(readRequestHost(headers({})), "");
  assert.equal(String(canonicalUrlFor("/terms")), "https://ownword.pro/terms");
});

// SEO-006. Every property must be verifiable from configuration; an absent
// property is correct, an invented one is structured-data spam.
test("describes the real operating entity and nothing it cannot evidence", () => {
  const payload = siteStructuredData(CANONICAL_HOST);
  assert.ok(payload, "canonical host must publish site-level structured data");
  const graph = payload["@graph"] as Array<Record<string, unknown>>;
  const organization = graph.find((node) => node["@type"] === "Organization");
  const website = graph.find((node) => node["@type"] === "WebSite");

  assert.equal(payload["@context"], "https://schema.org");
  assert.equal(organization?.name, "Ownword");
  assert.equal(organization?.legalName, "Bosphorus Elevate LLC");
  assert.equal(organization?.url, "https://ownword.pro/");
  assert.deepEqual(organization?.contactPoint, [
    { "@type": "ContactPoint", contactType: "customer support", email: "support@ownword.pro", availableLanguage: "English" },
  ]);
  assert.equal(website?.url, "https://ownword.pro/");
  assert.equal(website?.inLanguage, "en");
  assert.deepEqual(website?.publisher, { "@id": organization?.["@id"] });

  const serialized = JSON.stringify(payload);
  for (const unverifiable of ["logo", "sameAs", "aggregateRating", "review", "foundingDate", "address", "telephone", "SearchAction"]) {
    assert.doesNotMatch(serialized, new RegExp(unverifiable), `${unverifiable} is not evidenced and must not be marked up`);
  }
});

test("publishes no entity claim off the canonical host", () => {
  assert.equal(siteStructuredData("localhost"), null);
  assert.equal(siteStructuredData("www.ownword.pro"), null);
});

test("escapes markup-closing sequences in JSON-LD", () => {
  assert.equal(serializeJsonLd({ name: "</script><script>" }), '{"name":"\\u003c/script>\\u003cscript>"}');
});
