import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/checkout/route";

// Presence of a session cookie is what gets past the cheap signed-out check;
// the session itself is resolved against the database, which these
// route-level tests deliberately do not provide — every assertion below is
// about a refusal that happens before or without one.
const AUTH_HEADERS = {
  cookie: "ownword_session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("refuses a request that a third-party page made", async () => {
  // Identity is a cookie now, so cross-site request forgery is a real risk
  // this route did not previously have to answer for.
  const response = await POST(new Request("http://localhost/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.test", ...AUTH_HEADERS },
    body: JSON.stringify({ capability: "a".repeat(43), planId: "starter" }),
  }));
  assert.equal(response.status, 403);
});

test("rejects a non-JSON content type", async () => {
  const response = await POST(new Request("http://localhost/api/checkout", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }));
  assert.equal(response.status, 415);
});

test("requires authentication before anything else", async () => {
  const response = await POST(request({ capability: "a".repeat(43), planId: "starter" }));
  assert.equal(response.status, 401);
  const body = (await response.json()) as { signInPath?: string };
  assert.match(body.signInPath ?? "", /^\/signin\?return_to=/);
});

test("rejects malformed JSON for an authenticated request", async () => {
  const response = await POST(new Request("http://localhost/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", ...AUTH_HEADERS },
    body: "{not json",
  }));
  assert.equal(response.status, 400);
});

test("rejects a malformed capability with the same uniform not-found response preview.test.mts expects", async () => {
  const response = await POST(request({ capability: "short", planId: "starter" }, AUTH_HEADERS));
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("rejects an unpurchasable or unknown plan", async () => {
  const validCapability = "a".repeat(43);
  const unknownPlan = await POST(request({ capability: validCapability, planId: "enterprise" }, AUTH_HEADERS));
  assert.equal(unknownPlan.status, 400);

  // "pro" exists in the catalog but is availability: "announced", not purchasable yet.
  const announcedPlan = await POST(request({ capability: validCapability, planId: "pro" }, AUTH_HEADERS));
  assert.equal(announcedPlan.status, 400);
});
