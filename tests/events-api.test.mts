import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/events/route";

function request(body: unknown) {
  return new Request("http://localhost/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("accepts allowlisted funnel metadata without retaining content", async () => {
  const response = await POST(request({ event: "humanization_completed", properties: { mode: "natural", wordCount: 120, issuesImproved: 4 } }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("rejects unknown events and writing-bearing analytics payloads", async () => {
  assert.equal((await POST(request({ event: "made_up", properties: {} }))).status, 400);
  assert.equal((await POST(request({ event: "checkout_completed", properties: {} }))).status, 400);
  assert.equal((await POST(request({ event: "full_result_unlocked", properties: {} }))).status, 400);
  assert.equal((await POST(request({ event: "preview_viewed", properties: { original: "sensitive writing" } }))).status, 400);
  assert.equal((await POST(request({ event: "preview_viewed", properties: { source: "x".repeat(65) } }))).status, 400);
});
