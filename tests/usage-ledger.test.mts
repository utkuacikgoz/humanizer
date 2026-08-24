// M2-07. The point of these tests is the concurrency one: D-013 deferred
// this work precisely because an admission control that races looks correct
// under sequential testing and over-grants under load.
import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { usageEntries, users } from "../db/schema";
import { commitUsage, getConsumedWords, releaseUsage, reserveUsage } from "../db/usage-ledger";
import { createTestDatabase } from "./helpers/sqlite-db.mjs";
import type { AppDatabase } from "../db/repository";

const PERIOD = new Date("2026-08-01T00:00:00Z");
const ALLOWANCE = 1_000;

async function seedUser(db: AppDatabase): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(users).values({ id, externalSubject: `subject-${id}`, contactEmail: "person@example.com" });
  return id;
}

function reserve(db: AppDatabase, userId: string, words: number, key = crypto.randomUUID()) {
  return reserveUsage(db, { userId, operationKey: key, words, periodStart: PERIOD, allowance: ALLOWANCE });
}

test("admits a reservation inside the allowance", async () => {
  const db = await createTestDatabase();
  const userId = await seedUser(db);
  assert.deepEqual(await reserve(db, userId, 400), { admitted: true, replayed: false });
  assert.equal(await getConsumedWords(db, userId, PERIOD), 400);
});

test("refuses a reservation that would exceed the allowance", async () => {
  const db = await createTestDatabase();
  const userId = await seedUser(db);
  await reserve(db, userId, 900);
  const result = await reserve(db, userId, 200);
  assert.equal(result.admitted, false);
  assert.deepEqual(result, { admitted: false, consumed: 900, allowance: ALLOWANCE, remaining: 100 });
  assert.equal(await getConsumedWords(db, userId, PERIOD), 900, "a refused attempt must not consume anything");
});

test("admits a reservation that lands exactly on the allowance", async () => {
  const db = await createTestDatabase();
  const userId = await seedUser(db);
  await reserve(db, userId, 900);
  assert.equal((await reserve(db, userId, 100)).admitted, true);
  assert.equal(await getConsumedWords(db, userId, PERIOD), ALLOWANCE);
});

// The reason this module was deferred until it could be proven.
test("concurrent reservations never over-grant the allowance", async () => {
  const db = await createTestDatabase();
  const userId = await seedUser(db);

  // Twenty simultaneous attempts at 100 words each against a 1,000 allowance.
  // Exactly ten may be admitted. A read-then-write implementation admits more.
  const results = await Promise.all(Array.from({ length: 20 }, () => reserve(db, userId, 100)));
  const admitted = results.filter((r) => r.admitted).length;

  assert.equal(admitted, 10, `expected exactly 10 admissions, got ${admitted}`);
  const consumed = await getConsumedWords(db, userId, PERIOD);
  assert.equal(consumed, ALLOWANCE);
  assert.ok(consumed <= ALLOWANCE, "the ledger must never exceed the allowance");
});

test("concurrent reservations of uneven size never over-grant", async () => {
  const db = await createTestDatabase();
  const userId = await seedUser(db);
  const sizes = [300, 250, 400, 150, 200, 350, 100, 500];
  const results = await Promise.all(sizes.map((w) => reserve(db, userId, w)));

  const granted = sizes.filter((_, i) => results[i].admitted).reduce((a, b) => a + b, 0);
  assert.ok(granted <= ALLOWANCE, `granted ${granted} against an allowance of ${ALLOWANCE}`);
  assert.equal(await getConsumedWords(db, userId, PERIOD), granted);
});

test("replaying the same operation key does not reserve twice", async () => {
  const db = await createTestDatabase();
  const userId = await seedUser(db);
  const key = "attempt-同-1";

  assert.deepEqual(await reserve(db, userId, 300, key), { admitted: true, replayed: false });
  assert.deepEqual(await reserve(db, userId, 300, key), { admitted: true, replayed: true });
  assert.equal(await getConsumedWords(db, userId, PERIOD), 300, "a replay must not double-charge");
});

test("a concurrent replay of one operation key reserves once", async () => {
  const db = await createTestDatabase();
  const userId = await seedUser(db);
  const key = "attempt-racing";
  const results = await Promise.all(Array.from({ length: 6 }, () => reserve(db, userId, 200, key)));
  assert.ok(results.every((r) => r.admitted));
  assert.equal(await getConsumedWords(db, userId, PERIOD), 200);
});

// README.md: "Never charge quota for failed attempts or internal retries."

test("a failed attempt returns its whole reservation", async () => {
  const db = await createTestDatabase();
  const userId = await seedUser(db);
  const key = crypto.randomUUID();
  await reserve(db, userId, 400, key);
  await releaseUsage(db, key);
  assert.equal(await getConsumedWords(db, userId, PERIOD), 0, "a failure must cost the customer nothing");
});

test("a partial success charges only the words that came back", async () => {
  const db = await createTestDatabase();
  const userId = await seedUser(db);
  const key = crypto.randomUUID();
  await reserve(db, userId, 400, key);
  await commitUsage(db, { operationKey: key, successfulWords: 250 });
  assert.equal(await getConsumedWords(db, userId, PERIOD), 250);
});

test("a full success charges the whole reservation", async () => {
  const db = await createTestDatabase();
  const userId = await seedUser(db);
  const key = crypto.randomUUID();
  await reserve(db, userId, 400, key);
  await commitUsage(db, { operationKey: key, successfulWords: 400 });
  assert.equal(await getConsumedWords(db, userId, PERIOD), 400);
});

test("committing more than was reserved cannot inflate usage", async () => {
  const db = await createTestDatabase();
  const userId = await seedUser(db);
  const key = crypto.randomUUID();
  await reserve(db, userId, 100, key);
  await commitUsage(db, { operationKey: key, successfulWords: 99_999 });
  assert.equal(await getConsumedWords(db, userId, PERIOD), 100);
});

test("a retried commit does not release capacity twice", async () => {
  const db = await createTestDatabase();
  const userId = await seedUser(db);
  const key = crypto.randomUUID();
  await reserve(db, userId, 400, key);
  await commitUsage(db, { operationKey: key, successfulWords: 250 });
  await commitUsage(db, { operationKey: key, successfulWords: 250 });
  assert.equal(await getConsumedWords(db, userId, PERIOD), 250);
});

test("releasing an unknown operation is a no-op, not an error", async () => {
  const db = await createTestDatabase();
  await releaseUsage(db, "never-reserved");
});

test("released capacity can be reserved again", async () => {
  const db = await createTestDatabase();
  const userId = await seedUser(db);
  const first = crypto.randomUUID();
  await reserve(db, userId, ALLOWANCE, first);
  assert.equal((await reserve(db, userId, 100)).admitted, false);
  await releaseUsage(db, first);
  assert.equal((await reserve(db, userId, 100)).admitted, true);
});

test("usage is scoped to the billing period", async () => {
  const db = await createTestDatabase();
  const userId = await seedUser(db);
  await reserve(db, userId, ALLOWANCE);
  const nextPeriod = new Date("2026-09-01T00:00:00Z");
  const result = await reserveUsage(db, {
    userId, operationKey: crypto.randomUUID(), words: 500, periodStart: nextPeriod, allowance: ALLOWANCE,
  });
  assert.equal(result.admitted, true, "a new period starts with a fresh allowance");
  assert.equal(await getConsumedWords(db, userId, nextPeriod), 500);
});

test("usage is scoped to the user", async () => {
  const db = await createTestDatabase();
  const [a, b] = [await seedUser(db), await seedUser(db)];
  await reserve(db, a, ALLOWANCE);
  assert.equal((await reserve(db, b, 500)).admitted, true, "one customer cannot consume another's allowance");
});

test("the ledger is append-only — nothing is mutated in place", async () => {
  const db = await createTestDatabase();
  const userId = await seedUser(db);
  const key = crypto.randomUUID();
  await reserve(db, userId, 400, key);
  await commitUsage(db, { operationKey: key, successfulWords: 250 });

  const rows = await db.select().from(usageEntries).where(eq(usageEntries.userId, userId));
  const types = rows.map((r) => r.entryType).sort();
  assert.deepEqual(types, ["commit", "release", "reservation"]);
  const reservation = rows.find((r) => r.entryType === "reservation");
  assert.equal(reservation?.attemptedWords, 400, "the original reservation must survive unedited");
});

test("rejects a non-positive or fractional reservation", async () => {
  const db = await createTestDatabase();
  const userId = await seedUser(db);
  for (const words of [0, -50, 1.5, Number.NaN]) {
    await assert.rejects(() => reserve(db, userId, words));
  }
});
