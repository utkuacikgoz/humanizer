import assert from "node:assert/strict";
import test from "node:test";

import { PreviewRequestGuard } from "../src/lib/preview-request-guard";

test("preview guard enforces its request window", async () => {
  const guard = new PreviewRequestGuard<string>({ maxRequests: 2 });
  for (const key of ["request-01", "request-02"]) {
    const result = await guard.run({ clientId: "client", idempotencyKey: key, fingerprint: key, execute: async () => key });
    assert.equal(result.ok, true);
  }
  const limited = await guard.run({ clientId: "client", idempotencyKey: "request-03", fingerprint: "three", execute: async () => "three" });
  assert.equal(limited.ok, false);
  if (!limited.ok) {
    assert.equal(limited.status, 429);
    assert.ok((limited.retryAfterSeconds ?? 0) > 0);
  }
});

test("preview guard limits concurrent work without caching failures", async () => {
  const guard = new PreviewRequestGuard<string>({ maxConcurrent: 1 });
  let release!: (value: string) => void;
  const first = guard.run({
    clientId: "client",
    idempotencyKey: "request-01",
    fingerprint: "one",
    execute: () => new Promise((resolve) => { release = resolve; }),
  });
  const limited = await guard.run({ clientId: "client", idempotencyKey: "request-02", fingerprint: "two", execute: async () => "two" });
  assert.equal(limited.ok, false);
  release("one");
  assert.equal((await first).ok, true);

  const failedKey = "request-failure";
  await assert.rejects(guard.run({ clientId: "other", idempotencyKey: failedKey, fingerprint: "same", execute: async () => { throw new Error("provider failed"); } }));
  const retry = await guard.run({ clientId: "other", idempotencyKey: failedKey, fingerprint: "same", execute: async () => "recovered" });
  assert.equal(retry.ok, true);
});

test("preview guard releases concurrency when execute throws synchronously", async () => {
  const guard = new PreviewRequestGuard<string>({ maxConcurrent: 1 });
  await assert.rejects(guard.run({
    clientId: "client",
    idempotencyKey: "request-sync-failure",
    fingerprint: "same",
    execute: (() => { throw new Error("sync failure"); }) as () => Promise<string>,
  }));
  const retry = await guard.run({
    clientId: "client",
    idempotencyKey: "request-after-failure",
    fingerprint: "next",
    execute: async () => "recovered",
  });
  assert.equal(retry.ok, true);
});
