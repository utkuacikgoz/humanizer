// M3-02 — an entitled rewrite has to reach the owner's history.
//
// /history shipped against `owner_user_id`, which only checkout ever set, so
// a subscriber's day-to-day rewrites were returned in full and then dropped.
// These drive the exact function app/api/humanize/route.ts's entitled branch
// delegates to (src/lib/entitled-rewrite.ts) against a real SQLite database,
// then read the result back through db/history-repository.ts — the same query
// the /history route uses — rather than asserting on rows the writer just
// wrote.
import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { getOrCreateUserByExternalSubject, upsertSubscriptionFromStripe } from "../db/billing-repository";
import { listHistoryForUser } from "../db/history-repository";
import { getConsumedWords } from "../db/usage-ledger";
import * as schema from "../db/schema";
import { completeEntitledRewrite } from "../src/lib/entitled-rewrite";
import { reservePaidUsage } from "../src/lib/paid-usage";
import { createTestDatabase } from "./helpers/sqlite-db.mjs";
import type { AppDatabase } from "../db/repository";
import type { PaidUsageReservation } from "../src/lib/paid-usage";

const PERIOD_START = new Date("2026-08-01T00:00:00Z");
const PERIOD_END = new Date("2026-09-01T00:00:00Z");

const FULL_REWRITE = [
  "Clear communication helps a team move faster than any process document can.",
  "People understand plain language on the first pass, so fewer meetings are needed.",
  "Writing a decision down early stops the same debate from returning next quarter.",
  "A single concrete example carries more weight than a paragraph of general claims.",
].join(" ");

async function entitledAccount(db: AppDatabase, externalSubject: string) {
  const { userId } = await getOrCreateUserByExternalSubject(db, { externalSubject, email: null });
  await upsertSubscriptionFromStripe(db, {
    userId,
    stripeCustomerId: `cus_${externalSubject}`,
    stripeSubscriptionId: `sub_${crypto.randomUUID()}`,
    planId: "starter",
    catalogVersion: 1,
    status: "active",
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
    cancelAtPeriodEnd: false,
    lastStripeEventId: `evt_${externalSubject}`,
  });
  return userId;
}

async function reserve(db: AppDatabase, externalSubject: string, idempotencyKey: string): Promise<PaidUsageReservation> {
  const admission = await reservePaidUsage(db, { externalSubject, idempotencyKey, words: 60 });
  assert.equal(admission.kind, "reserved");
  if (admission.kind !== "reserved") throw new Error("unreachable");
  return admission.reservation;
}

function rewriteInput(idempotencyKey: string) {
  return {
    mode: "natural" as const,
    clientFingerprint: `hashed-client-${idempotencyKey}`,
    idempotencyKey,
    contentFingerprint: "hashed-content-fingerprint",
    pipelineVersion: 1,
    original: "The original draft the subscriber pasted in before it was rewritten for them.",
    result: FULL_REWRITE,
    inputWordCount: 60,
    successfulWordCount: 58,
    protectedContent: [
      { id: "p1", kind: "company", normalizedValue: "acme corp", start: 0, end: 9 },
    ],
    evidence: {
      issuesImproved: 4,
      naturalness: "Strong" as const,
      meaningPreservation: "High" as const,
      protectedItems: ["Acme Corp"],
    },
  };
}

async function ownedJobIds(db: AppDatabase, userId: string) {
  const rows = await db
    .select({ id: schema.humanizationJobs.id })
    .from(schema.humanizationJobs)
    .where(eq(schema.humanizationJobs.ownerUserId, userId));
  return rows.map((row) => row.id);
}

test("an entitled rewrite is stored once, owned by the requesting account, and readable in that account's history", async () => {
  const db = await createTestDatabase();
  const ownerSubject = `owner-${crypto.randomUUID()}`;
  const strangerSubject = `stranger-${crypto.randomUUID()}`;
  const ownerId = await entitledAccount(db, ownerSubject);
  const strangerId = await entitledAccount(db, strangerSubject);

  const key = crypto.randomUUID();
  const payload = await completeEntitledRewrite(db, await reserve(db, ownerSubject, key), rewriteInput(key));

  assert.equal(payload.paid, true);
  assert.equal(payload.result, FULL_REWRITE, "the customer still gets the complete rewrite");
  assert.equal(payload.usage.consumed, 58);

  const owned = await ownedJobIds(db, ownerId);
  assert.equal(owned.length, 1, "exactly one owned job row");

  const history = await listHistoryForUser(db, ownerId);
  assert.equal(history.length, 1);
  assert.equal(history[0].jobId, owned[0]);
  assert.equal(history[0].issuesImproved, 4);
  assert.equal(history[0].successfulWordCount, 58);
  assert.ok(history[0].preview.length > 0, "a history row needs a projection to render");
  // The list is metadata only: the full rewrite stays in job_payloads.resultRef
  // and is released only by the entitlement-checked detail path.
  assert.doesNotMatch(JSON.stringify(history[0]), /carries more weight/);

  assert.deepEqual(await listHistoryForUser(db, strangerId), [], "another account sees nothing");

  const [payloadRow] = await db
    .select()
    .from(schema.jobPayloads)
    .where(eq(schema.jobPayloads.jobId, owned[0]))
    .limit(1);
  assert.equal(payloadRow.resultRef, FULL_REWRITE, "the full rewrite is stored only in job_payloads.resultRef");

  const [commit] = await db
    .select()
    .from(schema.usageEntries)
    .where(eq(schema.usageEntries.entryType, "commit"));
  assert.equal(commit.jobId, owned[0], "the committed operation points at the history row it produced");
});

test("a retried entitled request under the same operation key does not write a second history row", async () => {
  const db = await createTestDatabase();
  const subject = `owner-${crypto.randomUUID()}`;
  const userId = await entitledAccount(db, subject);
  const key = crypto.randomUUID();

  // A replayed request re-derives everything: the in-memory replay cache is
  // gone (isolate recycle), so the reservation, the commit, and the history
  // write are all attempted again under the same operation key.
  const first = await completeEntitledRewrite(db, await reserve(db, subject, key), rewriteInput(key));
  const second = await completeEntitledRewrite(db, await reserve(db, subject, key), rewriteInput(key));

  assert.equal(first.result, FULL_REWRITE);
  assert.equal(second.result, FULL_REWRITE, "the retry still returns the complete rewrite");
  assert.equal((await ownedJobIds(db, userId)).length, 1, "no second history row");
  assert.equal((await listHistoryForUser(db, userId)).length, 1);
  assert.equal(await getConsumedWords(db, userId, PERIOD_START), 58, "and no second charge");
});

test("an owned job never gets an anonymous capability", async () => {
  const db = await createTestDatabase();
  const subject = `owner-${crypto.randomUUID()}`;
  const userId = await entitledAccount(db, subject);
  const key = crypto.randomUUID();

  await completeEntitledRewrite(db, await reserve(db, subject, key), rewriteInput(key));
  const [jobId] = await ownedJobIds(db, userId);

  // db/schema.ts's invariant: a job's access principal is exactly one of an
  // unconsumed anonymous session OR owner_user_id, never both.
  const sessions = await db
    .select()
    .from(schema.anonymousSessions)
    .where(eq(schema.anonymousSessions.jobId, jobId));
  assert.equal(sessions.length, 0, "an owned job's principal is its owner, not a capability");
});

test("a failed payload write still returns the paid rewrite and leaves the charge alone", async () => {
  const db = await createTestDatabase();
  const subject = `owner-${crypto.randomUUID()}`;
  const userId = await entitledAccount(db, subject);
  const key = crypto.randomUUID();
  const skipped: string[] = [];

  const payload = await completeEntitledRewrite(db, await reserve(db, subject, key), rewriteInput(key), {
    persistJob: async () => {
      throw new Error("D1_ERROR: insert into job_payloads failed");
    },
    onPersistenceSkipped: (reason) => skipped.push(reason),
  });

  assert.equal(payload.result, FULL_REWRITE, "persistence is a convenience, not part of the paid guarantee");
  assert.equal(payload.usage.consumed, 58, "the committed words are not released over a history write");
  assert.deepEqual(skipped, ["write-failed"]);
  assert.equal((await ownedJobIds(db, userId)).length, 0);
  assert.deepEqual(await listHistoryForUser(db, userId), []);
});
