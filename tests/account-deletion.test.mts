// M3-05 — self-service account deletion.
//
// Drives the exact functions app/api/account/route.ts delegates to, against a
// real SQLite database: the authorization boundary, irreversibility,
// idempotency, the subscription rule, and the property that what is retained
// for accounting cannot resurrect anyone's writing.
import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import * as account from "../db/account-deletion-repository";
import * as billing from "../db/billing-repository";
import * as history from "../db/history-repository";
import { persistHumanizationJob } from "../db/repository";
import * as schema from "../db/schema";
import { buildAccountDeleteResponse, buildAccountStatusResponse, type AccountStatusBody } from "../src/lib/account-deletion";
import { buildHistoryDetailResponse, buildHistoryListResponse, type HistoryListBody } from "../src/lib/history-access";
import { drainDeletionJobs } from "../src/lib/purge-worker";
import { createTestDatabase } from "./helpers/sqlite-db.mjs";
import type { AppDatabase } from "../db/repository";

const OWNER_SOURCE = "The private draft the owner asked us to destroy.";
const OWNER_RESULT = "OWNER-ONLY full rewrite text that must not survive account deletion.";
const STRANGER_RESULT = "STRANGER-ONLY full rewrite text.";

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

function authHeaders(externalSubject: string) {
  return {
    "oai-authenticated-user-id": externalSubject,
    "oai-authenticated-user-email": `${externalSubject}@example.com`,
  };
}

async function digestOf(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function deps(db: AppDatabase) {
  return async () => ({ db, billing, account });
}

function statusOf(db: AppDatabase, headers: Record<string, string> = {}) {
  return buildAccountStatusResponse(new Request("http://localhost/api/account", { headers }), deps(db));
}

function deleteAccount(db: AppDatabase, headers: Record<string, string> = {}) {
  return buildAccountDeleteResponse(
    new Request("http://localhost/api/account", { method: "DELETE", headers }),
    deps(db),
  );
}

function historyDeps(db: AppDatabase) {
  return async () => ({ db, billing, history });
}

async function subscribe(db: AppDatabase, userId: string, overrides: Partial<{ status: "active" | "trialing" | "canceled"; cancelAtPeriodEnd: boolean }> = {}) {
  await billing.upsertSubscriptionFromStripe(db, {
    userId,
    stripeCustomerId: `cus_${userId}`,
    stripeSubscriptionId: `sub_${userId}`,
    planId: "starter",
    catalogVersion: 1,
    status: overrides.status ?? "active",
    currentPeriodStart: new Date(Date.now() - 1_000),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    cancelAtPeriodEnd: overrides.cancelAtPeriodEnd ?? false,
    lastStripeEventId: "evt_seed",
  });
}

/** One owner with two claimed jobs, plus a stranger with one, so nothing can pass by emptiness. */
async function scenario() {
  const db = await createTestDatabase();
  const owner = await billing.getOrCreateUserByExternalSubject(db, { externalSubject: "owner", email: "owner@example.com" });
  const stranger = await billing.getOrCreateUserByExternalSubject(db, { externalSubject: "stranger", email: null });

  const ownerJobs: string[] = [];
  for (let index = 0; index < 2; index += 1) {
    const job = await persistHumanizationJob(db, jobInput(OWNER_SOURCE, `${OWNER_RESULT} #${index}`));
    await billing.claimJobForUser(db, { capabilityDigest: await digestOf(job.capabilityToken), userId: owner.userId });
    ownerJobs.push(job.jobId);
  }
  const strangerJob = await persistHumanizationJob(db, jobInput("A stranger's draft.", STRANGER_RESULT));
  await billing.claimJobForUser(db, { capabilityDigest: await digestOf(strangerJob.capabilityToken), userId: stranger.userId });

  await subscribe(db, owner.userId, { status: "canceled" });
  await subscribe(db, stranger.userId);

  return { db, owner, stranger, ownerJobs, strangerJobId: strangerJob.jobId };
}

test("deletion is refused without a server-derived identity", async () => {
  const { db } = await scenario();
  assert.equal((await deleteAccount(db)).status, 401);
  assert.equal((await statusOf(db)).status, 401);
  // An untrusted Host makes the identity headers worthless, so the same
  // headers that work locally authenticate nothing off the trusted origin.
  const forged = new Request("https://attacker.example/api/account", { method: "DELETE", headers: authHeaders("owner") });
  assert.equal((await buildAccountDeleteResponse(forged, deps(db))).status, 401);

  const [ownerRow] = await db.select().from(schema.users).where(eq(schema.users.externalSubject, "owner")).limit(1);
  assert.equal(ownerRow.deletedAt, null, "no unauthenticated request may tombstone an account");
});

test("account deletion makes every owned job unreachable through the history list and the detail path", async () => {
  const { db, owner, ownerJobs, stranger, strangerJobId } = await scenario();

  const before = (await (await buildHistoryListResponse(
    new Request("http://localhost/api/history", { headers: authHeaders("owner") }), historyDeps(db),
  )).json()) as HistoryListBody;
  assert.equal(before.items.length, 2);

  const response = await deleteAccount(db, authHeaders("owner"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true });

  // The list path: the owner id no longer resolves at all, and the rows it
  // would have matched are tombstoned anyway.
  const after = (await (await buildHistoryListResponse(
    new Request("http://localhost/api/history", { headers: authHeaders("owner") }), historyDeps(db),
  )).json()) as HistoryListBody;
  assert.deepEqual(after.items, []);
  assert.equal(await history.listHistoryForUser(db, owner.userId).then((rows) => rows.length), 0);

  for (const jobId of ownerJobs) {
    const detail = await buildHistoryDetailResponse(
      new Request(`http://localhost/api/history/${jobId}`, { headers: authHeaders("owner") }), jobId, historyDeps(db),
    );
    assert.equal(detail.status, 404);
    assert.equal(await history.findHistoryEntryForUser(db, { userId: owner.userId, jobId }), null);
    assert.equal(await billing.getUnlockedResult(db, { userId: owner.userId, jobId }), null);

    const [payload] = await db.select().from(schema.jobPayloads).where(eq(schema.jobPayloads.jobId, jobId)).limit(1);
    assert.equal(payload.sourceRef, "");
    assert.equal(payload.resultRef, null);
    assert.equal(payload.previewProjection, null);
    assert.notEqual(payload.purgedAt, null);

    const items = await db.select().from(schema.protectedItems).where(eq(schema.protectedItems.jobId, jobId));
    for (const item of items) {
      assert.equal(item.valueRef, null);
      assert.notEqual(item.purgedAt, null);
    }
  }

  // The stranger is untouched: deletion is scoped to the server-derived id.
  assert.equal((await history.listHistoryForUser(db, stranger.userId)).length, 1);
  const strangerResult = await billing.getUnlockedResult(db, { userId: stranger.userId, jobId: strangerJobId });
  assert.equal(strangerResult?.result, STRANGER_RESULT);
});

test("deletion tombstones the account so a later sign-in is a new, empty account rather than a resurrection", async () => {
  const { db, owner } = await scenario();
  await deleteAccount(db, authHeaders("owner"));

  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, owner.userId)).limit(1);
  assert.notEqual(row.deletedAt, null);
  assert.equal(row.contactEmail, null);
  assert.notEqual(row.externalSubject, "owner");
  assert.equal(await billing.findUserIdByExternalSubject(db, "owner"), null);

  const returning = await billing.getOrCreateUserByExternalSubject(db, { externalSubject: "owner", email: "owner@example.com" });
  assert.equal(returning.isNew, true);
  assert.notEqual(returning.userId, owner.userId);
  assert.deepEqual(await history.listHistoryForUser(db, returning.userId), []);
});

test("a second deletion request is a no-op, not an error, and leaks nothing", async () => {
  const { db } = await scenario();
  const first = await deleteAccount(db, authHeaders("owner"));
  const queuedAfterFirst = await db.select().from(schema.deletionJobs);
  const auditAfterFirst = await db.select().from(schema.deletionAuditEvents);

  const second = await deleteAccount(db, authHeaders("owner"));
  assert.equal(second.status, first.status);
  assert.deepEqual(await second.json(), { deleted: true });

  assert.equal((await db.select().from(schema.deletionJobs)).length, queuedAfterFirst.length, "a repeat request enqueues nothing new");
  assert.equal((await db.select().from(schema.deletionAuditEvents)).length, auditAfterFirst.length);
  assert.equal((await db.select().from(schema.users)).length, 2, "a repeat request creates no account row");

  // A never-existing account answers identically, so the response cannot be
  // used to tell whether an account was ever there.
  const nobody = await deleteAccount(db, authHeaders("never-seen"));
  assert.equal(nobody.status, 200);
  assert.deepEqual(await nobody.json(), { deleted: true });
});

test("an account whose subscription can still bill is refused, and told so before it confirms", async () => {
  const { db, stranger } = await scenario();

  const status = (await (await statusOf(db, authHeaders("stranger"))).json()) as AccountStatusBody;
  assert.deepEqual(
    { canDelete: status.canDelete, blockedBy: status.blockedBy, planId: status.subscription?.planId },
    { canDelete: false, blockedBy: "active-subscription", planId: "starter" },
  );

  const refused = await deleteAccount(db, authHeaders("stranger"));
  assert.equal(refused.status, 409);
  const body = (await refused.json()) as { reason: string; error: string };
  assert.equal(body.reason, "active-subscription");
  assert.match(body.error, /Cancel your subscription first/);

  // Refused means nothing happened: no tombstone, no erasure, no queue row.
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, stranger.userId)).limit(1);
  assert.equal(row.deletedAt, null);
  assert.equal((await history.listHistoryForUser(db, stranger.userId)).length, 1);
  assert.equal((await db.select().from(schema.deletionJobs)).length, 0);
});

test("a subscription already set to cancel at period end does not block deletion", async () => {
  const { db, stranger } = await scenario();
  await subscribe(db, stranger.userId, { status: "active", cancelAtPeriodEnd: true });

  const status = (await (await statusOf(db, authHeaders("stranger"))).json()) as AccountStatusBody;
  assert.equal(status.canDelete, true);
  assert.equal(status.blockedBy, null);

  const response = await deleteAccount(db, authHeaders("stranger"));
  assert.equal(response.status, 200);
  assert.equal((await history.listHistoryForUser(db, stranger.userId)).length, 0);
});

test("billing records are retained for accounting, and cannot resurrect any writing", async () => {
  const { db, owner, ownerJobs } = await scenario();
  await deleteAccount(db, authHeaders("owner"));

  const subscriptions = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, owner.userId));
  assert.equal(subscriptions.length, 1, "the Stripe reference tax law requires is kept");
  assert.equal(subscriptions[0].stripeCustomerId, `cus_${owner.userId}`);

  const retained = JSON.stringify([
    subscriptions,
    await db.select().from(schema.humanizationJobs),
    await db.select().from(schema.usageEntries),
    await db.select().from(schema.users),
  ]);
  for (const needle of [OWNER_SOURCE, OWNER_RESULT, "Dr. Elena Marsh", "owner@example.com"]) {
    assert.equal(retained.includes(needle), false, `retained records leaked ${JSON.stringify(needle)}`);
  }
  assert.equal(ownerJobs.length, 2);
});

test("account deletion enqueues one propagation job the purge worker drains", async () => {
  const { db, owner } = await scenario();
  await deleteAccount(db, authHeaders("owner"));

  const [queued] = await db.select().from(schema.deletionJobs);
  assert.equal(queued.subjectType, "user");
  assert.equal(queued.scope, "full_account");
  assert.equal(queued.subjectId, owner.userId);
  assert.equal(queued.requestedByUserId, owner.userId);
  assert.equal(queued.status, "pending");

  const summary = await drainDeletionJobs(db);
  assert.equal(summary.completed, 1);
  const [drained] = await db.select().from(schema.deletionJobs);
  assert.equal(drained.status, "completed");

  const events = await db.select().from(schema.deletionAuditEvents);
  assert.deepEqual(events.map((event) => event.event), ["requested", "claimed", "completed"]);
  const serialized = JSON.stringify(events);
  for (const needle of [OWNER_SOURCE, OWNER_RESULT, "Dr. Elena Marsh", "owner@example.com"]) {
    assert.equal(serialized.includes(needle), false, `audit trail leaked ${JSON.stringify(needle)}`);
  }
  for (const event of events) assert.equal(event.actorUserId, owner.userId);
});

test("a payload written after the deletion request is still caught by the drain", async () => {
  const { db, owner } = await scenario();
  await deleteAccount(db, authHeaders("owner"));

  // Simulates a rewrite that was in flight when the account was deleted: the
  // job row is owned by the deleted account and its payload is not tombstoned.
  const late = await persistHumanizationJob(db, { ...jobInput("A draft that raced the deletion.", "Its rewrite."), ownerUserId: owner.userId });
  const [beforeDrain] = await db.select().from(schema.jobPayloads).where(eq(schema.jobPayloads.jobId, late.jobId)).limit(1);
  assert.equal(beforeDrain.purgedAt, null);

  await drainDeletionJobs(db);

  const [afterDrain] = await db.select().from(schema.jobPayloads).where(eq(schema.jobPayloads.jobId, late.jobId)).limit(1);
  assert.equal(afterDrain.sourceRef, "");
  assert.equal(afterDrain.resultRef, null);
  assert.notEqual(afterDrain.purgedAt, null);
});
