import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/checkout/route";

const AUTH_HEADERS = {
  "oai-authenticated-user-id": "user_123",
  "oai-authenticated-user-email": "person@example.com",
};

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("rejects a non-JSON content type", async () => {
  const response = await POST(new Request("http://localhost/api/checkout", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }));
  assert.equal(response.status, 415);
});

test("requires authentication before anything else", async () => {
  const response = await POST(request({ capability: "a".repeat(43), planId: "starter" }));
  assert.equal(response.status, 401);
  const body = (await response.json()) as { signInPath?: string };
  assert.match(body.signInPath ?? "", /^\/signin-with-chatgpt\?return_to=/);
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
