import assert from "node:assert/strict";
import test from "node:test";
import { POST as humanize } from "../app/api/humanize/route";
import { SAMPLE_TEXT } from "../src/config/sample";
import { resolveBillingReadiness } from "../src/lib/billing-readiness";

test("ACT-06: the shipped sample demonstrates real edits and protected facts", async () => {
  const response = await humanize(new Request("http://localhost/api/humanize", {
    method: "POST",
    headers: { "content-type": "application/json", "x-idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ text: SAMPLE_TEXT, mode: "natural" }),
  }));
  assert.equal(response.status, 200);

  const body = await response.json() as {
    original: string;
    preview: string;
    issuesImproved: number;
    protectedItems: string[];
  };
  assert.equal(body.original, SAMPLE_TEXT);
  assert.notEqual(body.preview, SAMPLE_TEXT, "the activation sample must visibly change");
  assert.ok(body.issuesImproved > 0, "the sample must produce measured improvements");
  assert.ok(body.protectedItems.includes("Dr. Sarah Chen"));
  assert.ok(body.protectedItems.includes("March 14, 2024"));
  assert.ok(body.protectedItems.includes("12%"));
  assert.ok(body.preview.includes("Dr. Sarah Chen"), "a protected person must survive in the visible preview");
  assert.ok(body.preview.includes("12%"), "a protected percentage must survive in the visible preview");
});

test("ACT-11: billing readiness is available only after the server probe succeeds", async () => {
  let probes = 0;
  const ready = await resolveBillingReadiness(async () => { probes += 1; });
  assert.equal(probes, 1);
  assert.equal(ready.available, true);
  assert.equal(ready.signInRequired, true);
  assert.match(ready.message, /sign in/i);
});

test("ACT-11: billing readiness fails closed without leaking configuration details", async () => {
  const unavailable = await resolveBillingReadiness(async () => {
    throw new Error("STRIPE_SECRET_KEY=do-not-leak");
  });
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.signInRequired, true);
  assert.match(unavailable.message, /temporarily unavailable/i);
  assert.doesNotMatch(unavailable.message, /stripe|secret|do-not-leak/i);
});

test("ACT-12 and ACT-16: landing source encodes one-click sample and separates anonymous repeats from paid second use", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  );
  assert.match(source, /humanize\(\{ draft: SAMPLE_TEXT, source: "sample" \}\)/);
  assert.match(source, /submissionInFlight\.current/);
  assert.match(source, /track\("repeat_preview", \{ source: "anonymous_preview" \}\)/);
  assert.doesNotMatch(source, /track\("second_humanization"\)/);
});
