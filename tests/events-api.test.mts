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
  assert.equal((await POST(request({ event: "checkout_completed", properties: { jobId: "9a3a2a68-ec26-49a3-a8b3-fbd5950d88e6" } }))).status, 204);
  assert.equal((await POST(request({ event: "full_result_unlocked", properties: { jobId: "9a3a2a68-ec26-49a3-a8b3-fbd5950d88e6" } }))).status, 204);
  assert.equal((await POST(request({ event: "repeat_preview", properties: { source: "anonymous_preview" } }))).status, 204);
});

test("rejects unknown events and writing-bearing analytics payloads", async () => {
  assert.equal((await POST(request({ event: "made_up", properties: {} }))).status, 400);
  assert.equal((await POST(request({ event: "preview_viewed", properties: { original: "sensitive writing" } }))).status, 400);
  assert.equal((await POST(request({ event: "preview_viewed", properties: { source: "x".repeat(65) } }))).status, 400);
});
