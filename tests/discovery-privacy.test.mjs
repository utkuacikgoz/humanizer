import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { productConfig } from "../src/config/product.ts";

// SEO-007. Customer writing must not reach a discovery surface: not a URL, not
// a title or description, not a social tag, not the sitemap, not structured
// data, not an analytics payload, and not a shared cache.
//
// The access-control half of SEO-007 is proven elsewhere and thoroughly:
// tests/history-access.test.mts, tests/result-access.test.mts and
// tests/sentence-operations.test.mts hold every read, write and delete of a
// customer's text to the owner who made it. This file is the half those cannot
// see - what a crawler, an unfurler, a shared proxy cache or an analytics
// pipeline receives without ever authenticating.
const ROUTES = [
  "/",
  "/privacy",
  "/terms",
  "/signin",
  "/signin?return_to=%2Fhistory",
  "/history",
  "/checkout/success?job=9a3a2a68-ec26-49a3-a8b3-fbd5950d88e6",
  "/robots.txt",
  "/sitemap.xml",
  "/this-page-does-not-exist",
];

async function render(path, host = "ownword.pro") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`https://${host}${path}`, { headers: { accept: "text/html", host } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

// The two surfaces that render a customer's own writing - the workspace on `/`
// and the list on `/history` - are client components that fetch it over an
// authenticated request. Nothing a crawler receives has been through that
// fetch, so no route's server HTML should name an account or carry an address
// that is not the published support one.
test("no route's server-rendered HTML names an account or an address", async () => {
  for (const path of ROUTES) {
    const body = await (await render(path)).text();
    assert.doesNotMatch(body, /Signed in as/, `${path} renders a session identity into HTML a crawler receives`);

    // example.com is IANA's reserved documentation domain and is what the
    // sign-in field shows as a placeholder. The support address is meant to be
    // on the legal pages. Anything else is a leak.
    const stripped = body
      .replaceAll(productConfig.supportEmail, "")
      .replace(/[a-z0-9._%+-]+@example\.(com|org|net)/gi, "");
    const leaked = stripped.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    assert.equal(leaked?.[0], undefined, `${path} renders the address ${leaked?.[0]}`);
  }
});

// A personalized render in a shared cache is the same disclosure as an
// unauthorized response, arriving one hop later.
test("no HTML route is storable by a shared cache", async () => {
  for (const path of ROUTES) {
    if (path.startsWith("/robots.txt") || path.startsWith("/sitemap.xml")) continue;
    // The 404 is excluded on purpose, and the exclusion is a finding, not a
    // shrug: it is the one HTML response the framework emits with no
    // `cache-control` at all (SEO-020 finding F6). It carries no
    // personalization, so it is outside what this test is protecting, but a
    // heuristically cached 404 outlives the URL becoming a real page. Recorded
    // in docs/SEO.md Section 11.2 as ENG-owned.
    if (path === "/this-page-does-not-exist") continue;
    const response = await render(path);
    assert.match(
      response.headers.get("cache-control") ?? "",
      /no-store/,
      `${path} may be retained by a shared cache`,
    );
  }
});

// A URL is the one place text cannot be taken back from: it lands in proxy
// logs, browser history, bookmarks and Referer headers. Every identifier this
// application puts in a URL has to be opaque.
test("no internal link carries anything but an opaque identifier", async () => {
  for (const path of ROUTES) {
    const body = await (await render(path)).text();
    for (const [, href] of body.matchAll(/href="(\/[^"]*)"/g)) {
      if (href.startsWith("/_next/")) continue;
      const url = new URL(href, "https://ownword.pro");
      for (const [name, value] of url.searchParams) {
        assert.ok(
          value.length <= 64 && !/\s/.test(value),
          `${path} links to ${href}, whose "${name}" is long or contains whitespace: writing does not belong in a URL`,
        );
      }
    }
  }
});

// The /api/events allowlist is the server-side backstop and is enforced in
// tests/events-api.test.mts. This is the client-side half: a track() call that
// passed a draft would be rejected in production as a silent 400, which is a
// defect nobody would see. Here it fails the build instead.
test("every analytics call site sends content-free, allowlisted properties", async () => {
  const [route, ...callers] = await Promise.all(
    ["../app/api/events/route.ts", "../app/landing-page.tsx", "../app/checkout/success/page.tsx"].map((path) =>
      readFile(new URL(path, import.meta.url), "utf8"),
    ),
  );
  const allowed = new Set(
    (route.match(/const allowedPropertyNames = new Set\(\[([^\]]*)\]\)/) ?? [])[1]
      .split(",")
      .map((name) => name.trim().replace(/^"|"$/g, ""))
      .filter(Boolean),
  );
  assert.ok(allowed.size > 0, "could not read the /api/events property allowlist");

  for (const source of callers) {
    for (const [call, properties] of source.matchAll(/track\(\s*"[a-z_]+"\s*,\s*\{([^}]*)\}/g)) {
      for (const [, name] of properties.matchAll(/(?:^|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*[:,}]/g)) {
        assert.ok(
          allowed.has(name),
          `an analytics call sends "${name}", which /api/events does not allow: ${call.slice(0, 80)}`,
        );
      }
    }
  }
});
