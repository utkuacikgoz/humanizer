// D-006/M2-07. The ledger was already proven concurrency-safe in
// tests/usage-ledger.test.mts; these cover the gate that finally makes the
// advertised allowance real on the generation path.
import assert from "node:assert/strict";
import test from "node:test";
import { billableWords, reserveQuota } from "../src/lib/quota-gate";

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/humanize", { method: "POST", headers });
}

const SIGNED_IN = {
  host: "ownword.pro",
  "oai-authenticated-user-id": "subject-1",
  "oai-authenticated-user-email": "person@example.com",
};

test("counts billable words the same way the input gate does", () => {
  assert.equal(billableWords("one two three"), 3);
  assert.equal(billableWords("  padded   out  "), 2);
  assert.equal(billableWords(""), 0);
  assert.equal(billableWords("   "), 0);
});

test("an anonymous visitor is never metered", async () => {
  const decision = await reserveQuota(request({ host: "ownword.pro" }), 500);
  assert.deepEqual(decision, { metered: false });
});

test("a caller off the trusted host is never metered", async () => {
  // Identity does not resolve there at all (SEC-01), so there is no
  // allowance to draw down and no way to burn someone else's.
  const decision = await reserveQuota(request({ ...SIGNED_IN, host: "humanizer.workers.dev" }), 500);
  assert.deepEqual(decision, { metered: false });
});

test("a zero-word submission reserves nothing", async () => {
  assert.deepEqual(await reserveQuota(request(SIGNED_IN), 0), { metered: false });
});

test("fails open when persistence is unavailable", async () => {
  // Under plain Node the `cloudflare:workers` import cannot resolve, which is
  // the same path a D1 outage takes. Quota is a billing control, not a
  // security boundary: a paying customer must not lose a rewrite because a
  // metering read failed, and the ledger's own admission check is what
  // actually cannot be raced.
  const decision = await reserveQuota(request(SIGNED_IN), 500);
  assert.deepEqual(decision, { metered: false });
});
