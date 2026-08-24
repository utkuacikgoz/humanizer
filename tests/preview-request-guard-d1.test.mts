import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { DistributedPreviewRequestGuard } from "../src/lib/preview-request-guard";

const SECRET = "test-only-preview-guard-secret-32-bytes-minimum";

class TestStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly sql: string,
    private readonly params: Array<string | number | bigint | null | Uint8Array> = [],
  ) {}
  bind(...params: Array<string | number | bigint | null | Uint8Array>) { return new TestStatement(this.sqlite, this.sql, params); }
  async first<T>() { return (this.sqlite.prepare(this.sql).get(...this.params) ?? null) as T | null; }
  async run() {
    const info = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(info.changes) }, results: [] };
  }
}

class TestD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  prepare(sql: string) { return new TestStatement(this.sqlite, sql); }
  async batch(statements: TestStatement[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

async function testBinding() {
  const binding = new TestD1();
  const directory = new URL("../drizzle/", import.meta.url);
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    const migration = await readFile(new URL(file, directory), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) binding.sqlite.exec(statement);
    }
  }
  return binding;
}

function input<T>(key: string, execute: () => Promise<T>, fingerprint = "content-fingerprint") {
  return { clientId: "203.0.113.42", idempotencyKey: key, fingerprint, execute };
}

test("distributed guard replays encrypted results across Worker instances", async () => {
  const binding = await testBinding();
  const first = new DistributedPreviewRequestGuard<Record<string, unknown>>(binding as unknown as D1Database, SECRET);
  const second = new DistributedPreviewRequestGuard<Record<string, unknown>>(binding as unknown as D1Database, SECRET);
  let executions = 0;
  const initial = await first.run(input("request-replay", async () => {
    executions += 1;
    return { original: "private customer writing", preview: "approved preview" };
  }));
  const replay = await second.run(input("request-replay", async () => {
    executions += 1;
    return { shouldNot: "execute" };
  }));

  assert.equal(initial.ok, true);
  assert.equal(replay.ok, true);
  if (initial.ok && replay.ok) {
    assert.equal(initial.replayed, false);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.value, initial.value);
  }
  assert.equal(executions, 1);

  const rows = binding.sqlite.prepare("SELECT * FROM preview_guard_requests").all() as Array<Record<string, unknown>>;
  const serialized = JSON.stringify(rows);
  assert.equal(serialized.includes("203.0.113.42"), false);
  assert.equal(serialized.includes("private customer writing"), false);
  assert.match(String(rows[0].response_ciphertext), /^[A-Za-z0-9_-]+$/);
});

test("distributed guard rejects idempotency conflicts and concurrent third work atomically", async () => {
  const binding = await testBinding();
  const guards = Array.from({ length: 4 }, () => new DistributedPreviewRequestGuard<string>(binding as unknown as D1Database, SECRET));
  let releaseFirst!: (value: string) => void;
  let releaseSecond!: (value: string) => void;
  const first = guards[0].run(input("request-active-1", () => new Promise((resolve) => { releaseFirst = resolve; })));
  const second = guards[1].run(input("request-active-2", () => new Promise((resolve) => { releaseSecond = resolve; })));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const third = await guards[2].run(input("request-active-3", async () => "unexpected"));
  assert.equal(third.ok, false);
  if (!third.ok) assert.equal(third.status, 429);

  const conflict = await guards[3].run(input("request-active-1", async () => "unexpected", "different-content"));
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.status, 409);
  releaseFirst("first");
  releaseSecond("second");
  await Promise.all([first, second]);
});

test("distributed fixed window is shared and the thirteenth request is limited", async () => {
  const binding = await testBinding();
  for (let index = 0; index < 12; index += 1) {
    const guard = new DistributedPreviewRequestGuard<string>(binding as unknown as D1Database, SECRET);
    const result = await guard.run(input(`request-rate-${index}`, async () => String(index), `content-${index}`));
    assert.equal(result.ok, true);
  }
  const limited = await new DistributedPreviewRequestGuard<string>(binding as unknown as D1Database, SECRET)
    .run(input("request-rate-13", async () => "unexpected", "content-13"));
  assert.equal(limited.ok, false);
  if (!limited.ok) {
    assert.equal(limited.status, 429);
    assert.ok((limited.retryAfterSeconds ?? 0) > 0);
  }
});

test("distributed guard fails closed when D1 is unavailable", async () => {
  const unavailable = { prepare() { throw new Error("D1 unavailable"); } } as unknown as D1Database;
  const result = await new DistributedPreviewRequestGuard<string>(unavailable, SECRET)
    .run(input("request-storage", async () => "must not execute"));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 503);
});

test("an expired lease can be reclaimed after an isolate disappears", async () => {
  const binding = await testBinding();
  let now = 1_800_000_000_000;
  const crashed = new DistributedPreviewRequestGuard<string>(binding as unknown as D1Database, SECRET, { now: () => now, leaseMs: 10 });
  void crashed.run(input("request-expired-lease", () => new Promise(() => undefined)));
  while ((binding.sqlite.prepare("SELECT COUNT(*) AS count FROM preview_guard_requests").get() as { count: number }).count === 0) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  now += 11;
  const recovered = await new DistributedPreviewRequestGuard<string>(binding as unknown as D1Database, SECRET, { now: () => now, leaseMs: 10 })
    .run(input("request-expired-lease", async () => "recovered"));
  assert.equal(recovered.ok, true, JSON.stringify(recovered));
});

test("lease fencing prevents a stale Worker from overwriting a reclaimed response", async () => {
  const binding = await testBinding();
  let now = 1_800_000_000_000;
  let releaseStale!: (value: string) => void;
  const staleGuard = new DistributedPreviewRequestGuard<string>(binding as unknown as D1Database, SECRET, { now: () => now, leaseMs: 10 });
  const stale = staleGuard.run(input("request-fenced", () => new Promise((resolve) => { releaseStale = resolve; })));
  while ((binding.sqlite.prepare("SELECT COUNT(*) AS count FROM preview_guard_requests").get() as { count: number }).count === 0) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  now += 11;
  const winner = await new DistributedPreviewRequestGuard<string>(binding as unknown as D1Database, SECRET, { now: () => now, leaseMs: 10 })
    .run(input("request-fenced", async () => "new response"));
  assert.equal(winner.ok, true);

  releaseStale("stale response");
  const staleResult = await stale;
  assert.equal(staleResult.ok, false);
  if (!staleResult.ok) assert.equal(staleResult.status, 409);

  const replay = await new DistributedPreviewRequestGuard<string>(binding as unknown as D1Database, SECRET, { now: () => now })
    .run(input("request-fenced", async () => "must not execute"));
  assert.equal(replay.ok, true);
  if (replay.ok) assert.equal(replay.value, "new response");
});
