import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/preview/route";

function request(query: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/preview${query}`, { headers });
}

async function assertUniformNotFound(response: Response) {
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = (await response.json()) as { error?: string };
  assert.equal(body.error, "This preview link is no longer available.");
}

test("rejects a missing capability parameter", async () => {
  await assertUniformNotFound(await GET(request("")));
});

test("rejects an empty capability parameter", async () => {
  await assertUniformNotFound(await GET(request("?capability=")));
});

test("rejects a too-short capability", async () => {
  await assertUniformNotFound(await GET(request("?capability=short")));
});

test("rejects a capability containing characters outside the token alphabet", async () => {
  await assertUniformNotFound(await GET(request("?capability=" + encodeURIComponent("not/a valid<token>"))));
});

test(
  "returns the same uniform response for a syntactically valid capability when persistence is unavailable",
  async () => {
    // Under plain Node (this test file), db/index.ts's `cloudflare:workers`
    // import can't resolve, so this exercises the same fail-closed path an
    // unknown/expired/already-claimed capability takes in production — the
    // enumeration-oracle control in docs/SECURITY.md requires all of those
    // to be indistinguishable from the caller's perspective.
    const wellFormedToken = "a".repeat(43);
    await assertUniformNotFound(await GET(request(`?capability=${wellFormedToken}`)));
  },
);

test("rate-limits rapid redemption attempts from the same client (MQA finding: this endpoint was previously unthrottled)", async () => {
  const ip = "203.0.113.55"; // dedicated fake IP so this test's window doesn't share budget with the tests above
  const responses = await Promise.all(
    Array.from({ length: 13 }, (_, i) =>
      GET(request(`?capability=${"b".repeat(42)}${i}`, { "cf-connecting-ip": ip }))),
  );
  const statuses = responses.map((r) => r.status).sort((a, b) => a - b);
  assert.ok(statuses.includes(429), `expected at least one 429 among ${JSON.stringify(statuses)}`);
  const limited = responses.find((r) => r.status === 429);
  assert.ok(limited?.headers.get("retry-after"));
});
