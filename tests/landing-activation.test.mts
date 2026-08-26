import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { POST as humanize } from "../app/api/humanize/route";
import { SAMPLE_TEXT } from "../src/config/sample";
import {
  BILLING_READINESS_FAILURE_TTL_MS,
  BILLING_READINESS_TTL_MS,
  resetBillingReadinessCacheForTests,
  resolveBillingReadiness,
  resolveCachedBillingReadiness,
} from "../src/lib/billing-readiness";

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
  // H-1 moved the landing surface out of the route file; app/page.tsx is now
  // a server shell that renders this component.
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../app/landing-page.tsx", import.meta.url), "utf8"),
  );
  assert.match(source, /humanize\(\{ draft: SAMPLE_TEXT, source: "sample" \}\)/);
  assert.match(source, /submissionInFlight\.current/);
  assert.match(source, /track\("repeat_preview", \{ source: "anonymous_preview" \}\)/);
  assert.doesNotMatch(source, /track\("second_humanization"\)/);
});

// ---------------------------------------------------------------------
// SEC-18 — the readiness probe was an unauthenticated Stripe amplifier
// ---------------------------------------------------------------------

test("SEC-18: a flood of anonymous requests drives one probe, not one each", async () => {
  resetBillingReadinessCacheForTests();
  let probes = 0;
  let clock = 1_000;
  const probe = async () => { probes += 1; };

  // The proven ratio was 1:1 — one Stripe read per configured plan per
  // anonymous request, which makes exhausting Stripe's read limit a one-line
  // loop and the resulting outage a customer-visible "checkout unavailable".
  for (let call = 0; call < 50; call += 1) {
    const verdict = await resolveCachedBillingReadiness(probe, () => clock);
    assert.equal(verdict.available, true);
  }
  assert.equal(probes, 1, `50 requests must not be 50 Stripe reads, got ${probes}`);

  // A concurrent burst collapses onto one probe too, not one per miss.
  resetBillingReadinessCacheForTests();
  probes = 0;
  await Promise.all(Array.from({ length: 20 }, () => resolveCachedBillingReadiness(probe, () => clock)));
  assert.equal(probes, 1, `a concurrent burst must not fan out, got ${probes}`);

  // And the memo expires, so this is a bound rather than a permanent answer.
  clock += BILLING_READINESS_TTL_MS + 1;
  await resolveCachedBillingReadiness(probe, () => clock);
  assert.equal(probes, 2);
  resetBillingReadinessCacheForTests();
});

test("SEC-18: a closed verdict is held briefly, so a fixed misconfiguration recovers", async () => {
  resetBillingReadinessCacheForTests();
  let clock = 1_000;
  let broken = true;
  const probe = async () => { if (broken) throw new Error("price mismatch"); };

  assert.equal((await resolveCachedBillingReadiness(probe, () => clock)).available, false);
  broken = false;
  // Still closed inside the short failure window.
  assert.equal((await resolveCachedBillingReadiness(probe, () => clock)).available, false);
  // A closed verdict must not be cached for the long TTL: that would turn an
  // operator's fix into a wait, which is the same outage this finding is about.
  assert.ok(BILLING_READINESS_FAILURE_TTL_MS < BILLING_READINESS_TTL_MS);

  clock += BILLING_READINESS_FAILURE_TTL_MS + 1;
  assert.equal((await resolveCachedBillingReadiness(probe, () => clock)).available, true);
  resetBillingReadinessCacheForTests();
});

test("SEC-18: the temporary Stripe diagnostic block is gone", async () => {
  const route = await readFile(new URL("../app/api/billing/readiness/route.ts", import.meta.url), "utf8");
  const code = route.replace(/^\s*\/\/.*$/gm, ""); // the removal is described in a comment; the code must not do it
  assert.doesNotMatch(code, /stripe-diagnostic/, "the per-stage logging was also a log-volume amplifier");
  assert.doesNotMatch(code, /console\.log/);
  assert.doesNotMatch(code, /describeKey|resolveStripeConfig/, "key and config shape must not be reported at all");
  assert.match(code, /resolveCachedBillingReadiness/, "the route must use the memoized probe");
});
