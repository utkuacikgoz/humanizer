import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// SEO F3 / H-7. `/signin`, `/history` and `/checkout/success` are private
// surfaces, so they are deliberately absent from `src/lib/public-pages.ts` and
// therefore invisible to tests/page-quality-gate.test.mjs — which is exactly
// how all three shipped rendering zero `<h1>`. A page nobody indexes still has
// readers who navigate it by heading.
//
// This file is the outline half of that gate, run against the rendered HTML of
// the private surfaces instead of the public registry. It also holds the two
// things the sign-in redesign fixed and must not regress: no decorative step
// number where there is no sequence, and a live region that exists before it
// has anything to announce.
const PRIVATE_SURFACES = ["/signin", "/history", "/checkout/success"];

async function render(path) {
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
    new Request(`https://ownword.pro${path}`, { headers: { accept: "text/html", host: "ownword.pro" } }),
    { ASSETS: assets },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

const html = async (path) => (await render(path)).text();
const text = (value) => value.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

function headingsOf(body) {
  return [...body.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g)].map((match) => ({
    level: Number(match[1]),
    text: text(match[2]),
  }));
}

test("every private surface renders exactly one H1 and no gap in its outline", async () => {
  for (const path of PRIVATE_SURFACES) {
    const body = await html(path);
    const headings = headingsOf(body);
    const h1s = headings.filter((heading) => heading.level === 1);

    assert.equal(h1s.length, 1, `${path} must have exactly one H1, found ${h1s.length}`);
    assert.ok(h1s[0].text.length > 0, `${path} has an empty H1`);
    headings.forEach((heading, index) => {
      if (index === 0) return;
      const previous = headings[index - 1].level;
      assert.ok(
        heading.level - previous <= 1,
        `${path} jumps from h${previous} to h${heading.level} ("${heading.text.slice(0, 40)}"), ` +
          "which leaves a screen-reader user navigating by heading with a gap in the outline",
      );
    });

    assert.match(body, /<main\b/, `${path} has no <main> landmark`);
  }
});

// `.step-number` is positional information: 01 paste, 02 read, 03 pay. These
// three surfaces each carried one anyway — 00, 03, 04 — numbering a step in a
// sequence that does not exist. app/globals.css already refuses to number the
// four independent reasons in `.why` on the same grounds.
test("no private surface wears a step number for a sequence it is not part of", async () => {
  for (const path of PRIVATE_SURFACES) {
    const body = await html(path);
    assert.doesNotMatch(
      body,
      /class="[^"]*\bstep-number\b/,
      `${path} renders a step number, which claims a position in a sequence it has none in`,
    );
  }
});

// BRAND.md's accessibility invariant: "aria-live regions that already exist in
// the DOM before the content arrives; a region inserted together with its
// message is not announced." /signin used to mount its status line together
// with the message, which both broke the announcement and painted a band
// saying a link was on its way before one had been asked for.
test("the sign-in page's live regions exist before they have anything to say", async () => {
  const body = await html("/signin");

  const status = body.match(/<p[^>]*class="auth-status"[^>]*>([\s\S]*?)<\/p>/);
  const alert = body.match(/<p[^>]*class="auth-alert"[^>]*>([\s\S]*?)<\/p>/);
  assert.ok(status, "the polite status region is not in the first render");
  assert.ok(alert, "the assertive error region is not in the first render");
  assert.match(status[0], /role="status"/);
  assert.match(alert[0], /role="alert"/);
  assert.equal(text(status[1]), "", "the status region announced something before anything happened");
  assert.equal(text(alert[1]), "", "the error region announced something before anything happened");

  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  // Empty, they must take no space and paint nothing — but never `display:
  // none`, which removes the node a screen reader is watching.
  const collapse = css.match(/\.auth-status:empty, \.auth-alert:empty \{[^}]*\}/);
  assert.ok(collapse, "nothing collapses the empty live regions, so the card carries two blank bands");
  assert.doesNotMatch(collapse[0], /display:\s*none/, "an empty live region must not be display:none");
});

// The field is the one control on the gate every paying customer passes
// through. It took keyboard focus with no visible indicator once already
// (WCAG 2.4.7, docs/QA.md); the rule that fixed it is asserted here so a
// future edit cannot quietly drop it again.
test("the sign-in field keeps a visible keyboard focus indicator", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  const base = css.match(/\n\.signin-input \{[^}]*\}/);
  assert.ok(base, ".signin-input has no base rule");
  assert.doesNotMatch(
    base[0],
    /outline:\s*0|outline:\s*none/,
    "the base rule suppresses the outline again, which is how the field lost its focus ring",
  );

  const ring = css.match(/\.signin-input:focus-visible \{[^}]*\}/);
  assert.ok(ring, ".signin-input has no focus-visible rule");
  assert.match(ring[0], /outline:\s*2px solid var\(--green-bright\)/);
});
