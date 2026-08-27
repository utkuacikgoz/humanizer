import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { productConfig } from "../src/config/product.ts";
import { pricingConfig } from "../src/config/pricing.ts";
import { MIN_PAYWALLABLE_INPUT_WORDS } from "../src/lib/preview-projection.ts";

// SEO-025, the agent-friendly product audit, as a build gate rather than a
// one-time reading.
//
// The acceptance criterion has four halves and a guardrail: the public product
// flow must have semantic controls, labels, understandable errors and stable
// product/pricing facts, and no new protocol may be adopted without evidence
// that a consumer wants it.
//
// "Agent-friendly" here means exactly what accessible means, and nothing more
// exotic. A model driving this product reads the same DOM a screen reader
// reads and the same JSON a browser gets. So the checks below are not a second
// discipline bolted on beside accessibility - the labels half is already held
// by tests/page-quality-gate.test.mjs and is deliberately not repeated. What
// this file adds is the three things that gate does not look at: that the
// controls are real elements rather than clickable boxes, that the product's
// facts say the same thing to a reader and to a parser, and that failures come
// back as sentences.
//
// The guardrail is the reason there is no llms.txt in this repository, and the
// last test here is what keeps it that way. Google's generative-search guidance
// explicitly rejects unnecessary llms.txt files and manufactured mentions
// (docs/SEO.md Section 1). Adding one because it is fashionable is adopting a
// protocol with no evidenced consumer, which is the failure this item names.

const HOST = productConfig.domain;

async function render(path, host = HOST) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`https://${host}${path}`, { headers: { accept: "text/html", host } }),
    { ASSETS: { fetch: async () => new Response("asset", { status: 200 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

const html = async (path) => (await render(path)).text();

/** Visible text, with tag boundaries closed up so "<sup>$</sup>9.99" reads as "$9.99". */
function visibleText(body) {
  return body
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

const activePlans = Object.values(pricingConfig.plans).filter((plan) => plan.availability === "active");

// ---------------------------------------------------------------------
// Semantic controls: a real element, not a clickable box
// ---------------------------------------------------------------------

// An agent, like a keyboard user and like a screen reader, decides what it can
// operate from the element, not from the styling. A <div onClick> is invisible
// to all three. tests/page-quality-gate.test.mjs already proves every control
// on a public page is *named*; this proves it is a *control*.
test("every control in the public product flow is a real element", async () => {
  const body = await html("/");

  const roleButtons = [...body.matchAll(/<(?!button\b)([a-z]+)\b[^>]*\brole="button"[^>]*>/g)];
  assert.equal(
    roleButtons.length,
    0,
    `/ paints ${roleButtons.length} element(s) as a button instead of using one: ` +
      `${roleButtons.map((match) => match[0].slice(0, 70)).join(", ")}`,
  );

  // A <button> with no type is a submit button. Outside a form that is inert
  // today and a surprise the first time the control is moved into one.
  const untyped = [...body.matchAll(/<button\b(?![^>]*\btype=)[^>]*>/g)];
  assert.equal(
    untyped.length,
    0,
    `/ has ${untyped.length} <button> without an explicit type: ${untyped.map((m) => m[0].slice(0, 70)).join(", ")}`,
  );

  // The source half. A handler on a non-interactive element renders as a div
  // with no role at all, which the rendered check above cannot see.
  for (const path of ["../app/landing-page.tsx", "../app/checkout/success/page.tsx", "../app/signin/page.tsx"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    for (const [, tag] of source.matchAll(/<([a-zA-Z][\w.]*)\b[^>]*?\son(?:Click|KeyDown|KeyUp|MouseDown)=/gs)) {
      assert.ok(
        /^(button|a|input|select|textarea|form|Link|summary|details|dialog)$/.test(tag),
        `${path} puts an interaction handler on <${tag}>, which is not operable by keyboard or by anything reading the DOM`,
      );
    }
  }
});

// ---------------------------------------------------------------------
// Stable product and pricing facts
// ---------------------------------------------------------------------

// The failure this catches is a page that tells a reader one price and a parser
// another. An agent quoting a price to a customer will take whichever it finds
// first, and a mismatch is a commercial claim nobody made on purpose.
test("the price a reader sees and the price a parser reads are the same number", async () => {
  const body = await html("/");
  const text = visibleText(body);

  const entity = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((match) => JSON.parse(match[1].replace(/\\u003c/g, "<")))
    .find((payload) => payload["@type"] === "SoftwareApplication");
  assert.ok(entity, "/ publishes no SoftwareApplication entity on the canonical host");
  assert.ok(Array.isArray(entity.offers), "/ publishes a SoftwareApplication with no offers while billing is enabled");

  assert.deepEqual(
    entity.offers.map((offer) => [offer.name, offer.price, offer.priceCurrency]),
    activePlans.map((plan) => [plan.name, String(plan.monthlyPrice), pricingConfig.currency.toUpperCase()]),
    "the Offer blocks do not match the purchasable plans in src/config/pricing.ts",
  );

  for (const plan of activePlans) {
    const rendered = `$${plan.monthlyPrice}`;
    assert.ok(
      text.includes(rendered),
      `the ${plan.name} plan is offered at ${rendered} in structured data and that price is not visible on the page`,
    );
  }

  // And nothing else. A price the catalog does not know about is a price
  // nothing can keep in step with Stripe.
  const catalogPrices = new Set(activePlans.map((plan) => `$${plan.monthlyPrice}`));
  for (const [amount] of text.matchAll(/\$\s?\d[\d,]*(?:\.\d+)?/g)) {
    const normalized = amount.replace(/\s/g, "");
    assert.ok(
      catalogPrices.has(normalized),
      `/ shows ${normalized}, which is not a price in src/config/pricing.ts`,
    );
  }
});

test("the allowances a reader sees are the allowances the catalog sells", async () => {
  const text = visibleText(await html("/"));

  const shown = new Set(
    // `\s*`, not `\s+`: the allowance renders as `<b>50,000</b><span>words a
    // month</span>`, and visibleText() closes tag boundaries up so the price
    // in `<sup>$</sup>9.99` stays one token.
    [...text.matchAll(/([\d][\d,]*)\s*words?\b/gi)].map((match) => Number(match[1].replace(/,/g, ""))),
  );
  const expected = new Set([...activePlans.map((plan) => plan.wordLimit), MIN_PAYWALLABLE_INPUT_WORDS]);

  for (const plan of activePlans) {
    assert.ok(
      shown.has(plan.wordLimit),
      `the ${plan.name} plan sells ${plan.wordLimit} words a month and the page does not say so`,
    );
  }
  for (const value of shown) {
    assert.ok(
      expected.has(value),
      `/ quotes an allowance of ${value} words, which is neither a catalog word limit nor the preview minimum`,
    );
  }
});

test("the product identifies itself the same way to a reader and to a parser", async () => {
  const body = await html("/");
  const entity = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((match) => JSON.parse(match[1].replace(/\\u003c/g, "<")))
    .flatMap((payload) => (Array.isArray(payload["@graph"]) ? payload["@graph"] : [payload]));

  for (const node of entity) {
    if (typeof node.name !== "string") continue;
    assert.equal(
      node.name,
      productConfig.productName,
      `a ${node["@type"]} entity on / names the product "${node.name}"`,
    );
  }
  assert.match(
    body,
    new RegExp(`<title>[^<]*${productConfig.productName}`),
    "/ does not name the product in its title",
  );
});

// ---------------------------------------------------------------------
// Understandable errors
// ---------------------------------------------------------------------

// Every failure the public API can return is read by a person or by something
// acting for one. A status code says a request failed; a sentence says what to
// do about it. This holds every error literal in the request-handling code to
// being a sentence, and to carrying none of the customer's own text.
test("every error the API can return is a sentence, not a code", async () => {
  const files = await handlerSources();
  let checked = 0;

  for (const [path, source] of files) {
    for (const [, quoted, templated] of source.matchAll(/\berror:\s*(?:"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/g)) {
      const raw = quoted ?? templated;
      const message = raw.replace(/\$\{[^}]*\}/g, "N");
      checked += 1;

      assert.match(
        message,
        /^[A-Z"“]/,
        `${path} returns an error that does not start as a sentence: ${JSON.stringify(message)}`,
      );
      assert.match(
        message,
        /[.!?]$/,
        `${path} returns an error with no terminal punctuation: ${JSON.stringify(message)}`,
      );
      assert.ok(
        message.length >= 10 && message.length <= 220,
        `${path} returns an error of ${message.length} characters, which is a code or an essay: ${JSON.stringify(message)}`,
      );
      assert.doesNotMatch(
        message,
        /\b(undefined|null|NaN|TypeError|SyntaxError|ECONNREFUSED|SQLITE|D1_ERROR|stack|errno)\b/,
        `${path} leaks an internal identifier into an error a customer reads: ${JSON.stringify(message)}`,
      );

      // A template that interpolates the request body would put the
      // customer's writing in an error string, and from there into a log.
      if (templated) {
        for (const [, expression] of raw.matchAll(/\$\{([^}]*)\}/g)) {
          assert.doesNotMatch(
            expression,
            /\b(text|draft|body|input|content|prompt|candidate|original)\b/i,
            `${path} interpolates ${expression.trim()} into an error message, which can carry the customer's writing`,
          );
        }
      }
    }
  }

  assert.ok(checked >= 20, `only ${checked} error messages were found; the scan is not reaching the API routes`);
});

/** Every request-handling source file: the API routes and the libraries they answer from. */
async function handlerSources() {
  const found = [];
  const walk = async (dir) => {
    for (const entry of await readdir(new URL(dir, import.meta.url), { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const child = `${dir}${entry.name}${entry.isDirectory() ? "/" : ""}`;
      if (entry.isDirectory()) await walk(child);
      else if (/\.tsx?$/.test(entry.name)) found.push(child);
    }
  };
  await walk("../app/api/");
  await walk("../src/lib/");
  return Promise.all(
    found.map(async (path) => [path, await readFile(new URL(path, import.meta.url), "utf8")]),
  );
}

// ---------------------------------------------------------------------
// The guardrail: no new protocol without an evidenced consumer
// ---------------------------------------------------------------------

// SEO-025's guardrail, and the one part of this item that is a decision rather
// than a measurement. There is no llms.txt here, and its absence is deliberate:
// Google's AI-optimization guidance rejects it by name, no crawler this product
// cares about is documented to consume one, and a second unversioned copy of
// the product's facts is a second thing to keep true. If a consumer with
// evidence turns up, this test is where the decision gets revisited - out loud,
// by deleting a line - rather than by a file quietly appearing in public/.
test("no agent protocol file has been adopted without an evidenced consumer", async () => {
  const banned = ["llms.txt", "llms-full.txt", "ai.txt", "ai-plugin.json", "agents.json", "mcp.json"];
  const publicDir = await readdir(new URL("../public/", import.meta.url), { recursive: true });

  for (const name of banned) {
    assert.ok(
      !publicDir.some((entry) => entry.endsWith(name)),
      `public/ ships ${name}. docs/SEO.md Section 1 follows Google's guidance, which rejects it; ` +
        "adopting it needs an evidenced consumer and a decision recorded in docs/DECISIONS.md first",
    );
  }

  for (const path of ["/llms.txt", "/ai.txt", "/.well-known/ai-plugin.json"]) {
    const response = await render(path);
    assert.equal(response.status, 404, `${path} is served; nothing in this product should answer it`);
  }

  const robots = await (await render("/robots.txt")).text();
  assert.doesNotMatch(robots, /llms|ai-plugin|ai\.txt/i, "robots.txt advertises an agent protocol file");
});
