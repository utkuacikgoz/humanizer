import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/checkout/route";
import { STRIPE_PRICE_ENV_KEYS } from "../src/config/stripe";

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

test("rejects an unknown or non-catalog plan", async () => {
  const validCapability = "a".repeat(43);
  // The plan is a name the server resolves against its own catalog, never a
  // price id or an amount the client supplies (D-003).
  for (const planId of ["enterprise", "PRO", "starter ", "", "__proto__", "constructor"]) {
    const response = await POST(request({ capability: validCapability, planId }, AUTH_HEADERS));
    assert.equal(response.status, 400, `${JSON.stringify(planId)} must be refused at the plan gate`);
  }
  for (const planId of [null, 19, { id: "starter" }, ["starter"]]) {
    const response = await POST(request({ capability: validCapability, planId }, AUTH_HEADERS));
    assert.equal(response.status, 400, `${JSON.stringify(planId)} must be refused at the plan gate`);
  }
});

test("accepts every plan the catalog sells, Pro included", async () => {
  // Pro used to be availability "announced" and was refused here. It is
  // active now, so neither catalog plan may be turned away at the plan gate.
  // Nothing further can succeed in this test — there is no database binding —
  // but a 400 would mean the plan itself, not the environment, was rejected.
  const validCapability = "a".repeat(43);
  for (const planId of Object.keys(STRIPE_PRICE_ENV_KEYS)) {
    const response = await POST(request({ capability: validCapability, planId }, AUTH_HEADERS));
    assert.notEqual(response.status, 400, `${planId} must pass the plan gate`);
  }
});
