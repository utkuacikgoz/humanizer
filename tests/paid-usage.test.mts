import assert from "node:assert/strict";
import test from "node:test";
import { getOrCreateUserByExternalSubject, upsertSubscriptionFromStripe } from "../db/billing-repository";
import { getConsumedWords } from "../db/usage-ledger";
import { commitPaidUsage, releasePaidUsage, reservePaidUsage } from "../src/lib/paid-usage";
import { createTestDatabase } from "./helpers/sqlite-db.mjs";

const PERIOD_START = new Date("2026-08-01T00:00:00Z");
const PERIOD_END = new Date("2026-09-01T00:00:00Z");

async function entitledScenario() {
  const db = await createTestDatabase();
  const externalSubject = crypto.randomUUID();
  const { userId } = await getOrCreateUserByExternalSubject(db, { externalSubject, email: null });
  await upsertSubscriptionFromStripe(db, {
    userId,
    stripeCustomerId: "cus_paid_usage",
    stripeSubscriptionId: `sub_${crypto.randomUUID()}`,
    planId: "starter",
    catalogVersion: 1,
    status: "active",
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
    cancelAtPeriodEnd: false,
    lastStripeEventId: "evt_paid_usage",
  });
  return { db, externalSubject, userId };
}

test("an anonymous or unentitled visitor is not charged", async () => {
  const db = await createTestDatabase();
  assert.deepEqual(await reservePaidUsage(db, { externalSubject: "missing", idempotencyKey: "request-1", words: 100 }), { kind: "not-entitled" });
});

test("a paid generation reserves and commits only successful words", async () => {
  const { db, externalSubject, userId } = await entitledScenario();
  const admission = await reservePaidUsage(db, { externalSubject, idempotencyKey: "request-2", words: 300 });
  assert.equal(admission.kind, "reserved");
  if (admission.kind !== "reserved") return;
  const usage = await commitPaidUsage(db, admission.reservation, 240);
  assert.equal(usage.consumed, 240);
  assert.equal(usage.remaining, 50_000 - 240);
  assert.equal(usage.paidUseCount, 1);
  assert.equal(await getConsumedWords(db, userId, PERIOD_START), 240);
});

test("a failed paid generation releases its reservation", async () => {
  const { db, externalSubject, userId } = await entitledScenario();
  const admission = await reservePaidUsage(db, { externalSubject, idempotencyKey: "request-3", words: 300 });
  assert.equal(admission.kind, "reserved");
  if (admission.kind !== "reserved") return;
  await releasePaidUsage(db, admission.reservation);
  assert.equal(await getConsumedWords(db, userId, PERIOD_START), 0);
});

test("idempotent paid retries do not reserve twice", async () => {
  const { db, externalSubject, userId } = await entitledScenario();
  const input = { externalSubject, idempotencyKey: "request-replay", words: 400 };
  assert.equal((await reservePaidUsage(db, input)).kind, "reserved");
  assert.equal((await reservePaidUsage(db, input)).kind, "reserved");
  assert.equal(await getConsumedWords(db, userId, PERIOD_START), 400);
});
