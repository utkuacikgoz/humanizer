/**
 * SEO-020. The crawl/render QA pass, as a program rather than as a paragraph.
 *
 * It renders every route this application serves out of the built Worker
 * (`dist/server/index.js`) on several request hosts, parses what a crawler
 * would actually receive, and prints a table plus a findings list. Run it
 * after `npm run build`:
 *
 *     npm run build && node --import tsx scripts/seo-crawl.mts
 *
 * What it is not: a live-site check. Outbound to the production host is
 * blocked from the agent sandbox, and even where it is not, this reads the
 * build in this working tree, not the deploy. Every live assertion in
 * docs/SEO.md is an owner action (O-1, O-4, O-6, O-8), not something this
 * script can close.
 *
 * The rules it enforces on every build live in tests/page-quality-gate.test.mjs
 * and tests/metadata-contract.test.mjs. This script is the wider sweep: it
 * covers private surfaces, unknown paths, redirects and off-canonical hosts,
 * and it reports rather than asserts, so a human can read the whole picture in
 * one pass.
 */
import { readFile } from "node:fs/promises";
import { productConfig } from "../src/config/product";
import { PUBLIC_PAGES } from "../src/lib/public-pages";

/**
 * The static-asset binding, backed by the real build output. A stub that
 * answers 404 to everything makes every `<link href="/icon.svg">` and the
 * `og:image` look broken, which is how a crawl report earns a finding nobody
 * can act on.
 */
const ASSETS = {
  async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    try {
      const file = await readFile(new URL(`../dist/client${path}`, import.meta.url));
      return new Response(file, { status: 200 });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  },
};

const CANONICAL = productConfig.domain;
const HOSTS = [CANONICAL, `www.${CANONICAL}`, `staging.${CANONICAL}`, "localhost:5173"];

/** Every path the application serves, plus the ones it must refuse. */
const ROUTES = [
  ...PUBLIC_PAGES.map((page) => page.path),
  "/signin",
  "/history",
  "/checkout/success?job=9a3a2a68-ec26-49a3-a8b3-fbd5950d88e6",
  "/robots.txt",
  "/sitemap.xml",
  "/privacy/",
  "/terms/",
  "/history/",
  "/this-page-does-not-exist",
  "/result/abc",
  "/guides/not-written-yet",
];

type Rendered = {
  status: number;
  location: string | null;
  contentType: string;
  cacheControl: string | null;
  title: string | null;
  description: string | null;
  robots: string[];
  canonical: string | null;
  og: Record<string, string>;
  twitter: Record<string, string>;
  h1: string[];
  headingOrder: number[];
  jsonLd: { types: string[]; invalid: number };
  internalLinks: string[];
  body: string;
};

async function render(path: string, host: string, method = "GET"): Promise<Rendered> {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("crawl", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = (await import(workerUrl.href)) as {
    default: { fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> };
  };
  const response = await worker.fetch(
    new Request(`https://${host}${path}`, { method, headers: { accept: "text/html", host }, redirect: "manual" }),
    { ASSETS },
    { waitUntil() {}, passThroughOnException() {} },
  );
  const body = await response.text();
  return {
    ...parse(body),
    status: response.status,
    location: response.headers.get("location"),
    contentType: response.headers.get("content-type") ?? "",
    cacheControl: response.headers.get("cache-control"),
    body,
  };
}

function parse(html: string): Omit<Rendered, "status" | "location" | "body" | "contentType" | "cacheControl"> {
  const one = (pattern: RegExp) => (html.match(pattern) ?? [])[1] ?? null;
  const named = (prefix: "name" | "property", filter: RegExp) => {
    const found: Record<string, string> = {};
    for (const match of html.matchAll(new RegExp(`<meta ${prefix}="([^"]+)" content="([^"]*)"`, "g"))) {
      if (filter.test(match[1])) found[match[1]] = match[2];
    }
    return found;
  };

  const jsonLd = { types: [] as string[], invalid: 0 };
  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const payload = JSON.parse(match[1]) as Record<string, unknown>;
      const graph = payload["@graph"];
      jsonLd.types.push(
        ...(Array.isArray(graph)
          ? graph.map((node) => String((node as Record<string, unknown>)["@type"]))
          : [String(payload["@type"])]),
      );
    } catch {
      jsonLd.invalid += 1;
    }
  }

  return {
    title: one(/<title>([^<]*)<\/title>/),
    description: one(/<meta name="description" content="([^"]*)"/),
    robots: [...html.matchAll(/<meta name="robots" content="([^"]*)"/g)].map((match) => match[1]),
    canonical: one(/rel="canonical" href="([^"]*)"/),
    og: named("property", /^og:/),
    twitter: named("name", /^twitter:/),
    h1: [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((match) => strip(match[1])),
    headingOrder: [...html.matchAll(/<h([1-6])[^>]*>/g)].map((match) => Number(match[1])),
    jsonLd,
    internalLinks: [...new Set([...html.matchAll(/href="(\/[^"]*)"/g)].map((match) => match[1]))]
      .filter((href) => !href.startsWith("/_next/") && !href.startsWith("/api/")),
  };
}

const strip = (value: string) => value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

const findings: string[] = [];
const note = (line: string) => findings.push(line);

/**
 * Whether this response is an HTML document, read from what it says it is.
 *
 * This used to be `status === 200`, which quietly excluded the 404 page from
 * every check below it - and the 404 is an HTML document that a crawler renders
 * and a cache stores like any other. Finding F6 (a 404 with no cache directive)
 * lived in that gap for two passes. A redirect has no body to parse and is
 * excluded by its status.
 */
const isHtml = (_path: string, page: Rendered) =>
  page.contentType.toLowerCase().includes("text/html") && !(page.status >= 300 && page.status < 400);

function reportRow(host: string, path: string, page: Rendered) {
  const flags = isHtml(path, page)
    ? [
        page.robots.some((directive) => /noindex/.test(directive)) ? "noindex" : "INDEXABLE",
        page.canonical ? `canonical=${page.canonical}` : "no-canonical",
        page.jsonLd.types.length ? `ld:${page.jsonLd.types.join("+")}` : "no-ld",
        `h1=${page.h1.length}`,
        `cache=${page.cacheControl ?? "(none)"}`,
      ]
    : [page.location ? `-> ${page.location}` : "(not html)"];
  console.log(`  ${String(page.status).padEnd(3)} ${path.padEnd(46)} ${flags.join("  ")}`);
  if (page.jsonLd.invalid) note(`${host}${path}: ${page.jsonLd.invalid} JSON-LD block(s) do not parse`);
}

async function main() {
  const canonicalPaths = new Set(PUBLIC_PAGES.map((page) => page.path));

  for (const host of HOSTS) {
    console.log(`\n=== ${host} ===`);
    for (const path of ROUTES) {
      const page = await render(path, host);
      reportRow(host, path, page);

      const html = isHtml(path, page);
      const isPublic = canonicalPaths.has(path.split("?")[0]);
      const onCanonical = host === CANONICAL;

      if (html && !onCanonical && !page.robots.some((d) => /noindex/.test(d))) {
        note(`${host}${path}: 200 off the canonical host without noindex`);
      }
      if (html && !onCanonical && page.canonical) {
        note(`${host}${path}: declares a canonical off the canonical host (${page.canonical})`);
      }
      if (html && onCanonical && !isPublic && page.canonical) {
        note(`${host}${path}: private/error surface declares a canonical (${page.canonical})`);
      }
      if (html && onCanonical && !isPublic && (page.description || Object.keys(page.og).length)) {
        note(`${host}${path}: private/error surface carries a description or a social card`);
      }
      // SEO-020 finding F6. A shared cache may assign heuristic freshness to a
      // response that declares none, and a cached 404 outlives the URL becoming
      // a real page. worker/index.ts fills the silence for every HTML response;
      // this is the sweep that would have found the gap.
      if (html && !page.cacheControl) {
        note(`${host}${path}: HTML response with no cache-control, so a shared cache may guess`);
      }
      if (html && page.h1.length !== 1) {
        note(`${host}${path}: ${page.h1.length} <h1> elements (expected exactly 1)`);
      }
      const skipped = page.headingOrder.findIndex(
        (level, index) => index > 0 && level - page.headingOrder[index - 1] > 1,
      );
      if (html && skipped > 0) {
        note(`${host}${path}: heading level jumps from h${page.headingOrder[skipped - 1]} to h${page.headingOrder[skipped]}`);
      }
      if (html && onCanonical && !isPublic && page.jsonLd.types.some((type) => type !== "Organization" && type !== "WebSite")) {
        note(`${host}${path}: private/error surface publishes a page-level entity (${page.jsonLd.types.join("+")})`);
      }
    }
  }

  // Redirects: one hop, method and query preserved.
  console.log("\n=== redirects ===");
  for (const [path, host, method] of [
    ["/privacy/", CANONICAL, "GET"],
    ["/terms/", CANONICAL, "GET"],
    ["/history/", CANONICAL, "GET"],
    ["/privacy?x=1", `www.${CANONICAL}`, "GET"],
    ["/api/humanize", `www.${CANONICAL}`, "POST"],
  ] as const) {
    const first = await render(path, host, method);
    console.log(`  ${first.status} ${method} https://${host}${path} -> ${first.location ?? "(no Location)"}`);
    if (first.location) {
      const next = new URL(first.location, `https://${host}`);
      const second = await render(next.pathname + next.search, next.host, method);
      if (second.status >= 300 && second.status < 400) note(`https://${host}${path}: redirect chain is longer than one hop`);
      if (method === "POST" && first.status !== 308) note(`https://${host}${path}: a ${first.status} on a POST may drop the body`);
    }
  }

  // Link graph over the public pages only: a broken internal link on an
  // indexable page is a crawl budget leak and a dead end for a reader.
  console.log("\n=== internal links (canonical host) ===");
  const inbound = new Map<string, number>(PUBLIC_PAGES.map((page) => [page.path, 0]));
  for (const path of [...canonicalPaths, "/this-page-does-not-exist"]) {
    const page = await render(path, CANONICAL);
    for (const href of page.internalLinks) {
      const target = href.split("?")[0].split("#")[0] || "/";
      if (inbound.has(target) && target !== path) inbound.set(target, (inbound.get(target) ?? 0) + 1);
      const resolved = await render(target, CANONICAL);
      if (resolved.status >= 400) note(`${path} links to ${target}, which returns ${resolved.status}`);
    }
    console.log(`  ${path.padEnd(12)} -> ${page.internalLinks.join(" ") || "(none)"}`);
  }
  for (const [path, count] of inbound) {
    if (count === 0) note(`${path} is an orphan: no other public page links to it`);
  }

  // Customer text must not reach any crawlable surface. The workspace is
  // client-rendered and the account indicator resolves its session in the
  // browser, so the server HTML a crawler sees should carry neither.
  console.log("\n=== privacy sweep ===");
  for (const path of ROUTES) {
    const page = await render(path, CANONICAL);
    if (/Signed in as/.test(page.body)) note(`${path}: server HTML names a signed-in account`);
    // The support address is meant to be here. `example.com` is IANA's
    // reserved documentation domain and is what the sign-in field shows as a
    // placeholder, so neither is a leak; anything else would be.
    const stripped = page.body
      .replace(new RegExp(productConfig.supportEmail, "gi"), "")
      .replace(/[a-z0-9._%+-]+@example\.(com|org|net)/gi, "");
    const leaked = stripped.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    if (leaked) note(`${path}: server HTML contains the address ${leaked[0]}`);
  }
  console.log("  swept every route for a rendered session identity and for stray addresses");

  // The social card is a promise to every unfurler that fetches it.
  const home = await render("/", CANONICAL);
  const ogImage = home.og["og:image"];
  if (!ogImage) note("/: no og:image on the canonical host");
  else {
    const image = await render(new URL(ogImage).pathname, CANONICAL);
    console.log(`  og:image ${ogImage} -> ${image.status}`);
    if (image.status !== 200) note(`/: og:image ${ogImage} returns ${image.status}`);
  }

  console.log(`\n=== findings (${findings.length}) ===`);
  for (const finding of findings) console.log(`  - ${finding}`);
  if (!findings.length) console.log("  none");
}

await main();
