// M3-05 — the purge worker that drains `deletion_jobs`.
//
// The acceptance criterion is about propagation and auditability, so these
// drive the real drain against a real SQLite database rather than a
// re-implementation of it: concurrency, retry bounds, batch isolation, and the
// property that no audit record can hold a customer's writing.
import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import * as billing from "../db/billing-repository";
import * as history from "../db/history-repository";
import { persistHumanizationJob, purgeExpiredAnonymousPayloads, ANONYMOUS_RETENTION_MS } from "../db/repository";
import { sanitizeAuditDetail } from "../db/deletion-audit";
import * as schema from "../db/schema";
import {
  MAX_DELETION_ATTEMPTS,
  drainDeletionJobs,
  runScheduledPurge,
  type DeletionProcessor,
} from "../src/lib/purge-worker";
import { createTestDatabase } from "./helpers/sqlite-db.mjs";
import type { AppDatabase } from "../db/repository";

const SOURCE_TEXT = "The confidential first draft nobody else may ever read again.";
const RESULT_TEXT = "The rewritten sentence that must not survive its own deletion.";

function jobInput(source: string, result: string) {
  return {
    mode: "natural" as const,
    clientFingerprint: `client-${crypto.randomUUID()}`,
    idempotencyKey: crypto.randomUUID(),
    contentFingerprint: "content-fp",
    inputWordCount: 40,
    successfulWordCount: 38,
    pipelineVersion: 1,
    original: source,
    result,
    protectedContent: [{ id: "p1", kind: "person", normalizedValue: "Dr. Elena Marsh", start: 0, end: 14 }],
    previewProjection: {
      preview: "The first approved sentence of the rewrite.",
      hiddenWordCount: 22,
      issuesImproved: 3,
      naturalness: "Strong" as const,
      meaningPreservation: "High" as const,
      protectedItems: ["Dr. Elena Marsh"],
    },
  };
}

async function digestOf(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** One owned, then deleted, job — i.e. one queued `history_item` deletion. */
async function seedDeletedJob(db: AppDatabase, subject: string, source = SOURCE_TEXT, result = RESULT_TEXT) {
  const job = await persistHumanizationJob(db, jobInput(source, result));
  const user = await billing.getOrCreateUserByExternalSubject(db, { externalSubject: subject, email: null });
  await billing.claimJobForUser(db, { capabilityDigest: await digestOf(job.capabilityToken), userId: user.userId });
  const outcome = await history.deleteHistoryEntryForUser(db, { userId: user.userId, jobId: job.jobId });
  assert.equal(outcome, "deleted");
  return { jobId: job.jobId, userId: user.userId };
}

function queued(db: AppDatabase) {
  return db.select().from(schema.deletionJobs);
}

function auditRows(db: AppDatabase) {
  return db.select().from(schema.deletionAuditEvents);
}

test("a queued deletion is drained, marked completed, and recorded under the requesting user's authority", async () => {
  const db = await createTestDatabase();
  const { jobId, userId } = await seedDeletedJob(db, "owner-a");

  const summary = await drainDeletionJobs(db);
  assert.deepEqual(
    { claimed: summary.claimed, completed: summary.completed, parked: summary.parked },
    { claimed: 1, completed: 1, parked: 0 },
  );

  const [row] = await queued(db);
  assert.equal(row.status, "completed");
  assert.equal(row.subjectId, jobId);
  assert.equal(row.requestedByUserId, userId);
  assert.notEqual(row.completedAt, null);
  assert.equal(row.failureCode, null);
  assert.equal(JSON.parse(row.processorStatus).primary_store, "completed");

  const events = await auditRows(db);
  const names = events.map((event) => event.event);
  assert.deepEqual(names, ["requested", "claimed", "completed"]);
  for (const event of events) {
    assert.equal(event.actorUserId, userId, "every audit record names the authority the deletion was made under");
    assert.equal(event.subjectId, jobId);
  }
});

test("draining again is a no-op: a completed job is never re-processed", async () => {
  const db = await createTestDatabase();
  await seedDeletedJob(db, "owner-b");

  await drainDeletionJobs(db);
  const auditAfterFirst = (await auditRows(db)).length;

  const second = await drainDeletionJobs(db);
  assert.deepEqual(
    { claimed: second.claimed, completed: second.completed, contended: second.contended },
    { claimed: 0, completed: 0, contended: 0 },
  );
  assert.equal((await auditRows(db)).length, auditAfterFirst, "a no-op drain writes no audit records");
});

test("concurrent drains never process the same queued job twice", async () => {
  const db = await createTestDatabase();
  const seeded = [];
  for (const subject of ["c1", "c2", "c3", "c4"]) seeded.push(await seedDeletedJob(db, subject));

  const [left, right] = await Promise.all([drainDeletionJobs(db), drainDeletionJobs(db)]);

  assert.equal(left.completed + right.completed, seeded.length, "each queued job completes exactly once across both drains");
  assert.equal(left.claimed + right.claimed, seeded.length, "a claim is a guarded write, so only one drain can win each row");

  const rows = await queued(db);
  assert.equal(rows.length, seeded.length);
  for (const row of rows) {
    assert.equal(row.status, "completed");
    assert.equal(row.attempts, 1, "a second drain must not burn a retry attempt on a job it did not claim");
  }

  const completions = (await auditRows(db)).filter((event) => event.event === "completed");
  assert.equal(completions.length, seeded.length);
  assert.equal(new Set(completions.map((event) => event.deletionJobId)).size, seeded.length);
});

test("a failing job is retried to the bound, then parked, and never blocks the rest of the batch", async () => {
  const db = await createTestDatabase();
  const poisoned = await seedDeletedJob(db, "poison");
  const healthy = await seedDeletedJob(db, "healthy");

  let calls = 0;
  const flaky: DeletionProcessor = {
    name: "flaky_store",
    async purge(subject) {
      if (subject.subjectId !== poisoned.jobId) return;
      calls += 1;
      // Deliberately shaped like a driver error, whose message in production
      // could carry bound statement parameters. Nothing derived from it may
      // reach the queue row or the audit trail.
      throw new Error(`D1_ERROR: near "${SOURCE_TEXT}": syntax error`);
    },
  };

  const first = await drainDeletionJobs(db, { processors: [flaky] });
  assert.equal(first.claimed, 2);
  assert.equal(first.completed, 1, "the healthy job in the same batch still completes");
  assert.equal(first.deferred, 1);

  const healthyRow = (await queued(db)).find((row) => row.subjectId === healthy.jobId);
  assert.equal(healthyRow?.status, "completed");

  for (let pass = 2; pass <= MAX_DELETION_ATTEMPTS; pass += 1) {
    await drainDeletionJobs(db, { processors: [flaky] });
  }

  const parked = (await queued(db)).find((row) => row.subjectId === poisoned.jobId);
  assert.equal(parked?.status, "failed");
  assert.equal(parked?.attempts, MAX_DELETION_ATTEMPTS);
  assert.equal(parked?.completedAt, null, "a parked job is never reported as completed");
  assert.equal(parked?.failureCode, "processor:flaky_store", "only a self-generated code is stored");
  assert.equal(JSON.parse(parked!.processorStatus).flaky_store, "failed");
  assert.equal(calls, MAX_DELETION_ATTEMPTS, "retries are bounded, not infinite");

  // Past the bound the row is left alone entirely: no further attempts, and
  // the rest of the queue keeps draining around it.
  const after = await drainDeletionJobs(db, { processors: [flaky] });
  assert.equal(after.claimed, 0);
  assert.equal(calls, MAX_DELETION_ATTEMPTS);

  const parkedEvents = (await auditRows(db)).filter((event) => event.event === "parked");
  assert.equal(parkedEvents.length, 1);
  assert.equal(JSON.parse(parkedEvents[0].detail).failureCode, "processor:flaky_store");
});

test("a processor that already succeeded is not called again on a retry", async () => {
  const db = await createTestDatabase();
  const { jobId } = await seedDeletedJob(db, "mixed");

  const succeededCalls: string[] = [];
  const good: DeletionProcessor = {
    name: "good_store",
    async purge(subject) { succeededCalls.push(subject.subjectId); },
  };
  let failTwice = 2;
  const late: DeletionProcessor = {
    name: "late_store",
    async purge() { if (failTwice-- > 0) throw new Error("temporarily unavailable"); },
  };

  await drainDeletionJobs(db, { processors: [good, late] });
  await drainDeletionJobs(db, { processors: [good, late] });
  await drainDeletionJobs(db, { processors: [good, late] });

  assert.deepEqual(succeededCalls, [jobId], "propagation already recorded as completed is not repeated");
  const [row] = await queued(db);
  assert.equal(row.status, "completed");
  assert.deepEqual(JSON.parse(row.processorStatus), { primary_store: "completed", good_store: "completed", late_store: "completed" });
});

test("an unsupported processor is recorded as unsupported rather than failing the deletion", async () => {
  const db = await createTestDatabase();
  await seedDeletedJob(db, "unsupported");

  const accountsOnly: DeletionProcessor = {
    name: "accounts_only",
    supports: (subject) => subject.scope === "full_account",
    async purge() { throw new Error("must not be called"); },
  };

  const summary = await drainDeletionJobs(db, { processors: [accountsOnly] });
  assert.equal(summary.completed, 1);
  const [row] = await queued(db);
  assert.equal(JSON.parse(row.processorStatus).accounts_only, "unsupported");
});

test("no audit record and no queue row contains source or result text", async () => {
  const db = await createTestDatabase();
  await seedDeletedJob(db, "audit-check");

  const failing: DeletionProcessor = {
    name: "leaky_store",
    async purge() { throw new Error(`failed writing ${SOURCE_TEXT} / ${RESULT_TEXT}`); },
  };
  for (let pass = 0; pass < MAX_DELETION_ATTEMPTS; pass += 1) {
    await drainDeletionJobs(db, { processors: [failing] });
  }

  const needles = [SOURCE_TEXT, RESULT_TEXT, "Dr. Elena Marsh", "confidential", "rewritten sentence"];
  const serialized = JSON.stringify([...(await auditRows(db)), ...(await queued(db))]);
  for (const needle of needles) {
    assert.equal(serialized.includes(needle), false, `audit trail leaked ${JSON.stringify(needle)}`);
  }
});

test("audit detail accepts counts and codes and drops anything that could carry writing", () => {
  assert.equal(sanitizeAuditDetail({ payloadsVoided: 3, complete: true, failureCode: "processor:r2" }),
    JSON.stringify({ payloadsVoided: 3, complete: true, failureCode: "processor:r2" }));
  // A sentence, a digest of one, and a driver message are all rejected.
  assert.equal(sanitizeAuditDetail({ note: SOURCE_TEXT }), "{}");
  assert.equal(sanitizeAuditDetail({ digest: "a".repeat(64) + "b" }), "{}");
  assert.equal(sanitizeAuditDetail({ digest: "5f4dcc3b5aa765d61d8327deb882cf99" }), "{}", "a digest is a confirmation oracle for short text");
  assert.equal(sanitizeAuditDetail({ error: "D1_ERROR: near \"secret\"" }), "{}");
});

test("the scheduled pass also ages out unclaimed anonymous payloads", async () => {
  const db = await createTestDatabase();
  await seedDeletedJob(db, "scheduled");

  const anonymous = await persistHumanizationJob(db, jobInput("An anonymous draft nobody claimed.", "Its rewrite."));
  const stale = new Date(Date.now() - ANONYMOUS_RETENTION_MS - 60_000);
  await db.update(schema.jobPayloads).set({ createdAt: stale }).where(eq(schema.jobPayloads.jobId, anonymous.jobId));

  const summary = await runScheduledPurge(db);
  assert.equal(summary.deletions.completed, 1);
  assert.equal(summary.anonymousPayloadsPurged, 1);

  const [payload] = await db.select().from(schema.jobPayloads)
    .where(and(eq(schema.jobPayloads.jobId, anonymous.jobId)))
    .limit(1);
  assert.equal(payload.sourceRef, "");
  assert.equal(payload.resultRef, null);
  assert.notEqual(payload.purgedAt, null);

  // Nothing left to collect on the next pass.
  assert.equal(await purgeExpiredAnonymousPayloads(db), 0);
});
