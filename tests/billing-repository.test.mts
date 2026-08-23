import assert from "node:assert/strict";
import test from "node:test";
import { persistHumanizationJob } from "../db/repository";
import {
  claimJobForUser,
  getActiveEntitlement,
  getOrCreateUserByExternalSubject,
  getStripeCustomerId,
  getUnlockedResult,
  markStripeEventOutcome,
  recordStripeEvent,
  upsertSubscriptionFromStripe,
} from "../db/billing-repository";
import { createTestDatabase } from "./helpers/sqlite-db.mjs";

const baseJobInput = {
  mode: "natural" as const,
  clientFingerprint: "client-fp",
  idempotencyKey: crypto.randomUUID(),
  contentFingerprint: "content-fp",
  inputWordCount: 40,
  successfulWordCount: 40,
  pipelineVersion: 1,
  original: "The original text a user submitted.",
  result: "The full paid rewrite text — must never leak pre-entitlement.",
  protectedContent: [],
  previewProjection: {
    preview: "The original text a user submitted.",
    hiddenWordCount: 4,
    issuesImproved: 1,
    naturalness: "Strong" as const,
    meaningPreservation: "High" as const,
    protectedItems: [],
  },
};

async function digestOf(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

test("creates a user once and reuses it for the same external subject", async () => {
  const db = await createTestDatabase();
  const first = await getOrCreateUserByExternalSubject(db, { externalSubject: "sub_1", email: "a@example.com" });
  const second = await getOrCreateUserByExternalSubject(db, { externalSubject: "sub_1", email: "a@example.com" });
  assert.equal(first.isNew, true);
  assert.equal(second.isNew, false);
  assert.equal(first.userId, second.userId);
});

test("claims a job for a user and sets ownership", async () => {
  const db = await createTestDatabase();
  const job = await persistHumanizationJob(db, baseJobInput);
  const { userId } = await getOrCreateUserByExternalSubject(db, { externalSubject: "sub_2", email: null });
  const digest = await digestOf(job.capabilityToken);

  const claimed = await claimJobForUser(db, { capabilityDigest: digest, userId });
  assert.ok(claimed);
  assert.equal(claimed.jobId, job.jobId);
});

test("only one of two concurrent claims for the same capability wins", async () => {
  const db = await createTestDatabase();
  const job = await persistHumanizationJob(db, baseJobInput);
  const digest = await digestOf(job.capabilityToken);
  const userA = await getOrCreateUserByExternalSubject(db, { externalSubject: "sub_a", email: null });
  const userB = await getOrCreateUserByExternalSubject(db, { externalSubject: "sub_b", email: null });

  const [claimA, claimB] = await Promise.all([
    claimJobForUser(db, { capabilityDigest: digest, userId: userA.userId }),
    claimJobForUser(db, { capabilityDigest: digest, userId: userB.userId }),
  ]);

  const winners = [claimA, claimB].filter((result) => result !== null);
  assert.equal(winners.length, 1, "exactly one concurrent claim should win");
});

test("rejects a second claim attempt after the first already consumed it", async () => {
  const db = await createTestDatabase();
  const job = await persistHumanizationJob(db, baseJobInput);
  const digest = await digestOf(job.capabilityToken);
  const userA = await getOrCreateUserByExternalSubject(db, { externalSubject: "sub_c", email: null });
  const userB = await getOrCreateUserByExternalSubject(db, { externalSubject: "sub_d", email: null });

  const first = await claimJobForUser(db, { capabilityDigest: digest, userId: userA.userId });
  const second = await claimJobForUser(db, { capabilityDigest: digest, userId: userB.userId });
  assert.ok(first);
  assert.equal(second, null);
});

test("rejects claiming with an unknown capability digest", async () => {
  const db = await createTestDatabase();
  const { userId } = await getOrCreateUserByExternalSubject(db, { externalSubject: "sub_e", email: null });
  assert.equal(await claimJobForUser(db, { capabilityDigest: "not-a-real-digest", userId }), null);
});

test("the webhook inbox rejects a duplicate event ID and does not error", async () => {
  const db = await createTestDatabase();
  const event = { eventId: "evt_123", eventType: "customer.subscription.updated", objectId: "sub_123", stripeCreatedAt: new Date() };
  assert.equal(await recordStripeEvent(db, event), "new");
  assert.equal(await recordStripeEvent(db, event), "duplicate");
  // Idempotent: recording an outcome for the original insert still works.
  await markStripeEventOutcome(db, event.eventId, "processed");
});

test("subscription projection is idempotent by Stripe subscription ID and converges to the latest call", async () => {
  const db = await createTestDatabase();
  const { userId } = await getOrCreateUserByExternalSubject(db, { externalSubject: "sub_f", email: null });
  const base = {
    userId,
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    planId: "starter",
    catalogVersion: 1,
    currentPeriodStart: new Date("2026-01-01"),
    currentPeriodEnd: new Date("2026-02-01"),
    cancelAtPeriodEnd: false,
    lastStripeEventId: "evt_a",
  };

  await upsertSubscriptionFromStripe(db, { ...base, status: "active" });
  await upsertSubscriptionFromStripe(db, { ...base, status: "past_due", lastStripeEventId: "evt_b" });

  const entitlement = await getActiveEntitlement(db, userId);
  assert.equal(entitlement, null, "past_due is not an active entitlement");

  await upsertSubscriptionFromStripe(db, { ...base, status: "active", lastStripeEventId: "evt_c" });
  const activeAgain = await getActiveEntitlement(db, userId);
  assert.ok(activeAgain);
  assert.equal(activeAgain.status, "active");
  assert.equal(await getStripeCustomerId(db, userId), "cus_1");
});

test("getUnlockedResult requires BOTH ownership and an active entitlement", async () => {
  const db = await createTestDatabase();
  const job = await persistHumanizationJob(db, baseJobInput);
  const owner = await getOrCreateUserByExternalSubject(db, { externalSubject: "sub_g", email: null });
  const stranger = await getOrCreateUserByExternalSubject(db, { externalSubject: "sub_h", email: null });
  const digest = await digestOf(job.capabilityToken);
  await claimJobForUser(db, { capabilityDigest: digest, userId: owner.userId });

  // Owner, but no entitlement yet.
  assert.equal(await getUnlockedResult(db, { userId: owner.userId, jobId: job.jobId }), null);

  await upsertSubscriptionFromStripe(db, {
    userId: owner.userId,
    stripeCustomerId: "cus_2",
    stripeSubscriptionId: "sub_2",
    planId: "starter",
    catalogVersion: 1,
    status: "active",
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 1_000_000),
    cancelAtPeriodEnd: false,
    lastStripeEventId: "evt_x",
  });

  // Entitled, but not the owner.
  assert.equal(await getUnlockedResult(db, { userId: stranger.userId, jobId: job.jobId }), null);

  // Owner AND entitled: unlocked, full text returned.
  const unlocked = await getUnlockedResult(db, { userId: owner.userId, jobId: job.jobId });
  assert.ok(unlocked);
  assert.equal(unlocked.original, baseJobInput.original);
  assert.equal(unlocked.result, baseJobInput.result);
});
