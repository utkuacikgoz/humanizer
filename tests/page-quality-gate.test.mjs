import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CRAWLER_DISALLOWED_PREFIXES, PUBLIC_PAGES } from "../src/lib/public-pages.ts";

// SEO-013. The page-template quality gate, enforced rather than described.
//
// docs/SEO.md Section 6's release gate says no acquisition page is done until
// its intent, canonical, robots, status, title, H1, structured data, sitemap
// membership, internal links, conversion action, claims and accessibility have
// been verified. This file is the half of that list a machine can actually
// check, run against the rendered HTML of every page in the public registry on
// every build. Section 11.5 of docs/SEO.md lists the half it cannot, and says
// so instead of implying this file covers it.
//
// It is deliberately separate from tests/metadata-contract.test.mjs. That file
// crawls the *sitemap* and holds whatever it finds to the metadata contract, so
// it catches a page that ships without metadata. This one starts from the
// *registry* and holds each declared page to the template, so it catches a page
// that ships without an intent, an owner, a conversion action, or an accessible
// document outline. A page has to satisfy both.
const CANONICAL_HOST = "ownword.pro";
const OFF_CANONICAL_HOST = "staging.ownword.pro";

async function render(path, host = CANONICAL_HOST) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  const assets = {
    async fetch(request) {
      const asset = new URL(`../dist/client${new URL(request.url).pathname}`, import.meta.url);
      try {
        return new Response(await readFile(asset), { status: 200 });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  };
  return worker.fetch(
    new Request(`https://${host}${path}`, { headers: { accept: "text/html", host } }),
    { ASSETS: assets },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

const html = async (path, host) => (await render(path, host)).text();

/** Visible text: markup and React's SSR comment markers removed. */
const text = (value) => value.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------
// Intent and ownership: declared in the registry, and distinct
// ---------------------------------------------------------------------

test("every public page declares one distinct search intent and an accountable owner", () => {
  const owners = new Set(["Product", "Copy", "Legal", "SEO", "Engineering"]);
  const intents = new Set();
  for (const page of PUBLIC_PAGES) {
    assert.ok(
      page.intent && page.intent.trim().length >= 40,
      `${page.path} must state the reader it exists for, not a keyword`,
    );
    assert.ok(!intents.has(page.intent), `${page.path} repeats another page's intent; two such pages are one page`);
    intents.add(page.intent);
    assert.ok(owners.has(page.contentOwner), `${page.path} has no accountable owner for its claims`);
    assert.ok(page.primaryCta?.label, `${page.path} declares no primary conversion action`);
  }
});

// ---------------------------------------------------------------------
// The rendered page has to match what the registry promises
// ---------------------------------------------------------------------

test("every public page renders its declared conversion action", async () => {
  for (const page of PUBLIC_PAGES) {
    const body = await html(page.path);
    const controls = [
      ...body.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g),
      ...body.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g),
    ];
    const match = controls.find(([element, inner]) => {
      if (!text(inner).includes(page.primaryCta.label)) return false;
      if (!page.primaryCta.href) return true;
      return new RegExp(`href="${page.primaryCta.href}"`).test(element);
    });
    assert.ok(
      match,
      `${page.path} declares "${page.primaryCta.label}" as its conversion action but renders no such link or button`,
    );
  }
});

test("every public page shows the modification date it claims in the sitemap", async () => {
  for (const page of PUBLIC_PAGES) {
    const body = await html(page.path);
    if (!page.lastModified) {
      assert.doesNotMatch(
        text(body),
        /Last updated: \d{4}-\d{2}-\d{2}/,
        `${page.path} displays a date the sitemap does not claim; one of the two is wrong`,
      );
      continue;
    }
    assert.match(page.lastModified, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(
      text(body).includes(`Last updated: ${page.lastModified}`),
      `${page.path} claims lastmod ${page.lastModified} but does not show it to a reader`,
    );
  }
});

// ---------------------------------------------------------------------
// Internal links: no dead ends, no orphans, no invited-then-refused URLs
// ---------------------------------------------------------------------

test("public pages link to each other, and never into a path robots.txt refuses", async () => {
  const registered = new Set(PUBLIC_PAGES.map((page) => page.path));
  const inbound = new Map([...registered].map((path) => [path, 0]));

  for (const page of PUBLIC_PAGES) {
    const body = await html(page.path);
    const hrefs = [...new Set([...body.matchAll(/href="(\/[^"]*)"/g)].map((match) => match[1]))]
      .filter((href) => !href.startsWith("/_next/"));
    const paths = hrefs.map((href) => href.split("?")[0].split("#")[0] || "/");

    assert.ok(
      paths.some((path) => registered.has(path) && path !== page.path),
      `${page.path} is a dead end: it links to no other indexable page`,
    );

    for (const path of paths) {
      if (registered.has(path) && path !== page.path) inbound.set(path, inbound.get(path) + 1);

      const disallowed = CRAWLER_DISALLOWED_PREFIXES.find((prefix) => path.startsWith(prefix));
      assert.equal(
        disallowed,
        undefined,
        `${page.path} is indexable and links to ${path}, which robots.txt disallows (${disallowed}). ` +
          "A URL a crawler is invited to and forbidden to fetch gets indexed URL-only, and its own noindex " +
          "is never read. Either drop the link or let the crawler read the noindex.",
      );

      const response = await render(path);
      assert.ok(
        response.status < 400,
        `${page.path} links to ${path}, which returns ${response.status}`,
      );
    }
  }

  for (const [path, count] of inbound) {
    assert.ok(count > 0, `${path} is an orphan: no other indexable page links to it`);
  }
});

// ---------------------------------------------------------------------
// Claims: the shapes Section 1 forbids outright
// ---------------------------------------------------------------------
//
// This checks the SHAPE of a claim, never its truth. A machine cannot tell an
// evidenced number from an invented one; what it can tell is that this product
// has no ratings, no customer count and no benchmark published, so any page
// rendering one is rendering something nobody can support.

const FORBIDDEN_CLAIMS = [
  [/\b(guarantee[sd]?|100%|undetectable|bypass(es|ed)?)\b[^.]{0,60}\b(detect\w*|turnitin|gptzero|ai check\w*)/i,
    "a guaranteed detector or Turnitin outcome"],
  [/\b(detect\w*|turnitin|gptzero)\b[^.]{0,60}\b(guarantee[sd]?|100%|undetectable|bypass(es|ed)?)\b/i,
    "a guaranteed detector or Turnitin outcome"],
  [/\b\d(\.\d)?\s*(\/|out of)\s*5\b/i, "a star rating"],
  [/\b(trusted|used|loved) by\s+(over\s+)?[\d,]+/i, "a customer count"],
  [/\b[\d,]+\+?\s+(happy\s+)?(customers|users|writers|students)\b/i, "a customer count"],
  [/\b\d{1,3}(\.\d+)?%\s+(of\s+)?(users|customers|writers|students|drafts|readers)/i, "an unevidenced percentage"],
  [/\b(rated|ranked)\s+#?1\b/i, "a ranking claim"],
  [/\b(the\s+)?(best|leading|#1|number one)\s+(ai\s+)?(humanizer|rewriter|writing tool)/i, "a superlative market claim"],
  [/\bfree trial\b/i, "a free trial this product does not offer"],
];

// "Ownword does not guarantee that any AI-detection tool will fail to flag
// rewritten text" is the disclaimer Section 1 asks for, not the promise it
// forbids, and the two read almost identically to a regular expression. So a
// match is only a finding when nothing negates it just before.
const NEGATED = /\b(not|never|no|cannot|can.t|does\s?n.t|do\s?n.t|without|nor)\b[^.]{0,40}$/i;

test("no public page renders a claim the product cannot back", async () => {
  for (const page of PUBLIC_PAGES) {
    const visible = text(await html(page.path));
    for (const [pattern, what] of FORBIDDEN_CLAIMS) {
      for (const found of visible.matchAll(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`))) {
        if (NEGATED.test(visible.slice(Math.max(0, found.index - 60), found.index))) continue;
        assert.fail(`${page.path} renders ${what}: "${found[0]}"`);
      }
    }
  }
});

// ---------------------------------------------------------------------
// Accessibility: the static half of Section 6's requirement
// ---------------------------------------------------------------------

test("every public page has an accessible document outline and labelled controls", async () => {
  for (const page of PUBLIC_PAGES) {
    const body = await html(page.path);

    assert.match(body, /<html lang="[a-z]{2}(-[A-Za-z]+)?"/, `${page.path} does not declare a document language`);

    const headings = [...body.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g)].map((match) => ({
      level: Number(match[1]),
      text: text(match[2]),
    }));
    const h1s = headings.filter((heading) => heading.level === 1);
    assert.equal(h1s.length, 1, `${page.path} must have exactly one H1, found ${h1s.length}`);
    assert.ok(h1s[0].text.length > 0, `${page.path} has an empty H1`);
    headings.forEach((heading, index) => {
      if (index === 0) return;
      const previous = headings[index - 1].level;
      assert.ok(
        heading.level - previous <= 1,
        `${page.path} jumps from h${previous} to h${heading.level} ("${heading.text.slice(0, 40)}"), ` +
          "which leaves a screen-reader user navigating by heading with a gap in the outline",
      );
    });

    assert.match(body, /<main\b/, `${page.path} has no <main> landmark`);

    for (const [element] of body.matchAll(/<img\b[^>]*>/g)) {
      assert.match(element, /\balt="/, `${page.path} has an <img> with no alt attribute: ${element.slice(0, 90)}`);
    }

    // A decorative inline SVG must be hidden from assistive technology; a
    // meaningful one must name itself.
    for (const [element] of body.matchAll(/<svg\b[^>]*>/g)) {
      assert.match(
        element,
        /aria-hidden="true"|aria-label="|role="img"/,
        `${page.path} has an <svg> that is neither hidden nor named: ${element.slice(0, 90)}`,
      );
    }

    for (const [element, inner] of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
      if (text(inner).length > 0) continue;
      assert.match(
        element,
        /aria-label="|aria-labelledby="|title="/,
        `${page.path} has a link with no discernible name: ${element.slice(0, 90)}`,
      );
    }

    for (const [element, name] of body.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
      const id = (element.match(/\bid="([^"]+)"/) ?? [])[1];
      const labelled =
        /aria-label="|aria-labelledby="/.test(element) ||
        (id && new RegExp(`<label[^>]*for="${id}"`).test(body));
      assert.ok(labelled, `${page.path} has an unlabelled <${name}>: ${element.slice(0, 90)}`);
    }

    // docs/ACTIVATION.md and SEC-17: the native attribute drops keyboard focus
    // to <body>, which strands the person who was operating the control.
    assert.doesNotMatch(
      body.replace(/<[^>]*aria-disabled="[^"]*"[^>]*>/g, ""),
      /<(button|a|input|select|textarea)\b[^>]*\sdisabled[\s=>]/,
      `${page.path} gives a focusable control the native disabled attribute`,
    );
  }
});

// ---------------------------------------------------------------------
// Canonical and robots, from the registry side
// ---------------------------------------------------------------------

test("every registered page self-canonicalizes on the canonical host and claims nothing off it", async () => {
  for (const page of PUBLIC_PAGES) {
    const onCanonical = await html(page.path);
    const expected = `https://${CANONICAL_HOST}${page.path === "/" ? "" : page.path}`;
    assert.equal(
      (onCanonical.match(/rel="canonical" href="([^"]*)"/) ?? [])[1]?.replace(/\/$/, ""),
      expected.replace(/\/$/, ""),
      `${page.path} does not self-canonicalize`,
    );
    assert.doesNotMatch(
      (onCanonical.match(/<meta name="robots" content="([^"]*)"/) ?? [])[1] ?? "",
      /noindex|nofollow/,
      `${page.path} is registered as indexable but tells crawlers to skip it`,
    );

    const offCanonical = await html(page.path, OFF_CANONICAL_HOST);
    assert.equal(
      (offCanonical.match(/rel="canonical" href="([^"]*)"/) ?? [])[1] ?? null,
      null,
      `${page.path} declares a canonical on ${OFF_CANONICAL_HOST}, a host it does not serve`,
    );
    assert.match(
      (offCanonical.match(/<meta name="robots" content="([^"]*)"/) ?? [])[1] ?? "",
      /noindex/,
      `${page.path} is indexable on ${OFF_CANONICAL_HOST}`,
    );
  }
});
