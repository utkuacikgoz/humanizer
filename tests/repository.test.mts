import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { anonymousSessions, humanizationJobs, jobPayloads, protectedItems, users } from "../db/schema";
import { ANONYMOUS_RETENTION_MS, persistHumanizationJob, purgeExpiredAnonymousPayloads, redeemPreviewCapability } from "../db/repository";
import { createTestDatabase } from "./helpers/sqlite-db.mjs";

const baseProjection = {
  preview: "In today's busy world, clear communication plays a crucial role.",
  hiddenWordCount: 12,
  issuesImproved: 3,
  naturalness: "Strong" as const,
  meaningPreservation: "High" as const,
  protectedItems: ["Acme Corp", "42%"],
};

const baseInput = {
  mode: "natural" as const,
  clientFingerprint: "hashed-client-fingerprint",
  idempotencyKey: crypto.randomUUID(),
  contentFingerprint: "hashed-content-fingerprint",
  inputWordCount: 49,
  successfulWordCount: 49,
  pipelineVersion: 1,
  original: "The full original text, restricted, must never leave job_payloads.",
  result: "The full humanized text, restricted, must never leave job_payloads.",
  protectedContent: [
    { id: "p1", kind: "company", normalizedValue: "acme corp", start: 0, end: 9 },
    { id: "p2", kind: "percentage", normalizedValue: "42%", start: 20, end: 23 },
  ],
  previewProjection: baseProjection,
};

test("persists a succeeded job and redeems a matching preview via its capability", async () => {
  const db = await createTestDatabase();
  const persisted = await persistHumanizationJob(db, baseInput);

  assert.ok(persisted.jobId);
  assert.ok(persisted.capabilityToken.length >= 32);
  assert.ok(persisted.capabilityExpiresAt.getTime() > Date.now());

  const redeemed = await redeemPreviewCapability(db, persisted.capabilityToken);
  assert.ok(redeemed);
  assert.equal(redeemed.jobId, persisted.jobId);
  assert.equal(redeemed.mode, "natural");
  assert.equal(redeemed.state, "succeeded");
  assert.deepEqual(redeemed.projection, baseProjection);
});

test("never exposes the raw capability digest or the full rewrite text from redemption", async () => {
  const db = await createTestDatabase();
  const persisted = await persistHumanizationJob(db, baseInput);
  const redeemed = await redeemPreviewCapability(db, persisted.capabilityToken);

  // The original is intentionally returned (the user already holds it —
  // see RedeemedPreview's doc comment); the full rewrite never is.
  assert.equal(JSON.stringify(redeemed).includes(baseInput.result), false);

  const [session] = await db.select().from(anonymousSessions).where(eq(anonymousSessions.jobId, persisted.jobId));
  assert.notEqual(session.capabilityDigest, persisted.capabilityToken);
  assert.match(session.capabilityDigest, /^[0-9a-f]{64}$/);
});

test("stores protected content as hashes, never as plaintext", async () => {
  const db = await createTestDatabase();
  const persisted = await persistHumanizationJob(db, baseInput);
  const items = await db.select().from(protectedItems).where(eq(protectedItems.jobId, persisted.jobId));

  assert.equal(items.length, 2);
  for (const item of items) {
    assert.match(item.valueHash, /^[0-9a-f]{64}$/);
    assert.equal(item.valueHash, item.valueHash.toLowerCase());
    assert.notEqual(item.valueHash, "acme corp");
    assert.equal(item.verificationStatus, "preserved");
  }
});

test("rejects an unknown capability token without distinguishing why", async () => {
  const db = await createTestDatabase();
  await persistHumanizationJob(db, baseInput);
  assert.equal(await redeemPreviewCapability(db, "not-a-real-token"), null);
  assert.equal(await redeemPreviewCapability(db, ""), null);
});

test("rejects an already-expired capability", async () => {
  const db = await createTestDatabase();
  const persisted = await persistHumanizationJob(db, { ...baseInput, capabilityTtlMs: -1_000 });
  assert.equal(await redeemPreviewCapability(db, persisted.capabilityToken), null);
});

test("rejects a consumed capability (M2-01's future claim transaction sets consumedAt)", async () => {
  const db = await createTestDatabase();
  const persisted = await persistHumanizationJob(db, baseInput);
  await db.update(anonymousSessions).set({ consumedAt: new Date() }).where(eq(anonymousSessions.jobId, persisted.jobId));
  assert.equal(await redeemPreviewCapability(db, persisted.capabilityToken), null);
});

test("the state CHECK constraint rejects a state outside the pipeline's state machine", async () => {
  const db = await createTestDatabase();
  // Deliberately outside the JobState union: proving the DB-level CHECK
  // constraint rejects it (not just the TS type), so bypass the type at
  // the call boundary rather than the column itself.
  const invalidRow: Record<string, unknown> = {
    id: crypto.randomUUID(),
    mode: "natural",
    state: "not-a-real-state",
    clientFingerprint: "c",
    idempotencyKey: "i",
    contentFingerprint: "f",
    inputWordCount: 1,
    pipelineVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await assert.rejects(() => db.insert(humanizationJobs).values(invalidRow as never));
});

test("two jobs sharing a client+idempotency key cannot both be inserted", async () => {
  const db = await createTestDatabase();
  const key = crypto.randomUUID();
  await persistHumanizationJob(db, { ...baseInput, idempotencyKey: key });
  await assert.rejects(() => persistHumanizationJob(db, { ...baseInput, idempotencyKey: key }));
});

test("job_payloads never leaks into the redeemed projection shape", async () => {
  const db = await createTestDatabase();
  const persisted = await persistHumanizationJob(db, baseInput);
  const redeemed = await redeemPreviewCapability(db, persisted.capabilityToken);
  assert.ok(redeemed);
  assert.deepEqual(Object.keys(redeemed).sort(), ["capabilityExpiresAt", "jobId", "mode", "original", "projection", "state"]);
  assert.equal(redeemed.original, baseInput.original);
  assert.deepEqual(Object.keys(redeemed.projection).sort(), Object.keys(baseProjection).sort());

  const [payload] = await db.select().from(jobPayloads).where(eq(jobPayloads.jobId, persisted.jobId));
  assert.equal(payload.sourceRef, baseInput.original);
  assert.equal(payload.resultRef, baseInput.result);
});

// SEC-06 — /privacy promises anonymous drafts are deleted after 30 days.
// Nothing enforced it: every job_payloads row sat with purged_at NULL and
// the source text still in place.

test("purges anonymous draft text once the retention window has passed", async () => {
  const db = await createTestDatabase();
  const persisted = await persistHumanizationJob(db, { ...baseInput, idempotencyKey: crypto.randomUUID() });

  const stale = new Date(Date.now() - ANONYMOUS_RETENTION_MS - 60_000);
  await db.update(jobPayloads).set({ createdAt: stale }).where(eq(jobPayloads.jobId, persisted.jobId));

  assert.equal(await purgeExpiredAnonymousPayloads(db), 1);

  const [payload] = await db.select().from(jobPayloads).where(eq(jobPayloads.jobId, persisted.jobId)).limit(1);
  assert.equal(payload.sourceRef, "", "the draft text must be gone");
  assert.equal(payload.resultRef, null, "the rewrite must be gone");
  assert.ok(payload.purgedAt, "a tombstone must record that this was purged, not never stored");

  const items = await db.select().from(protectedItems).where(eq(protectedItems.jobId, persisted.jobId));
  assert.ok(items.length > 0);
  for (const item of items) {
    assert.equal(item.valueRef, null, "protected values must be purged alongside the payload");
    assert.ok(item.purgedAt);
  }
});

test("leaves anonymous drafts inside the retention window untouched", async () => {
  const db = await createTestDatabase();
  const persisted = await persistHumanizationJob(db, { ...baseInput, idempotencyKey: crypto.randomUUID() });

  assert.equal(await purgeExpiredAnonymousPayloads(db), 0);
  const [payload] = await db.select().from(jobPayloads).where(eq(jobPayloads.jobId, persisted.jobId)).limit(1);
  assert.equal(payload.purgedAt, null);
  assert.notEqual(payload.sourceRef, "");
});

test("never purges a job someone has paid for", async () => {
  const db = await createTestDatabase();
  const persisted = await persistHumanizationJob(db, { ...baseInput, idempotencyKey: crypto.randomUUID() });

  const stale = new Date(Date.now() - ANONYMOUS_RETENTION_MS - 60_000);
  await db.update(jobPayloads).set({ createdAt: stale }).where(eq(jobPayloads.jobId, persisted.jobId));
  const ownerId = crypto.randomUUID();
  await db.insert(users).values({ id: ownerId, externalSubject: "paying-customer", contactEmail: "payer@example.com" });
  await db.update(humanizationJobs).set({ ownerUserId: ownerId }).where(eq(humanizationJobs.id, persisted.jobId));

  assert.equal(await purgeExpiredAnonymousPayloads(db), 0, "an owned job is out of scope for anonymous retention");
  const [payload] = await db.select().from(jobPayloads).where(eq(jobPayloads.jobId, persisted.jobId)).limit(1);
  assert.equal(payload.purgedAt, null);
  assert.notEqual(payload.sourceRef, "");
});
