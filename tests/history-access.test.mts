// M3-01 — authorized history list/detail/delete.
//
// The acceptance criterion is an authorization property ("Every query filters
// by server-derived user ID; anonymous capabilities cannot enumerate; deleted
// records become inaccessible and enter purge workflow"), so these drive the
// exact functions app/api/history/** delegates to, against a real SQLite
// database, rather than a re-implementation of them.
import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import * as billing from "../db/billing-repository";
import * as history from "../db/history-repository";
import { persistHumanizationJob } from "../db/repository";
import * as schema from "../db/schema";
import {
  buildHistoryDeleteResponse,
  buildHistoryDetailResponse,
  buildHistoryListResponse,
  type HistoryListBody,
} from "../src/lib/history-access";
import { createTestDatabase } from "./helpers/sqlite-db.mjs";
import type { AppDatabase } from "../db/repository";

const OWNER_RESULT = "OWNER-ONLY full rewrite text that must never appear in a list response.";
const STRANGER_RESULT = "STRANGER-ONLY full rewrite text.";
const PREVIEW_TEXT = "The first approved sentence of the rewrite.";

function jobInput(result: string) {
  return {
    mode: "natural" as const,
    clientFingerprint: `client-${crypto.randomUUID()}`,
    idempotencyKey: crypto.randomUUID(),
    contentFingerprint: "content-fp",
    inputWordCount: 40,
    successfulWordCount: 38,
    pipelineVersion: 1,
    original: "The original text a user submitted for rewriting.",
    result,
    protectedContent: [
      { id: "p1", kind: "person", normalizedValue: "Dr. Elena Marsh", start: 0, end: 14 },
    ],
    previewProjection: {
      preview: PREVIEW_TEXT,
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
  return async () => ({ db, billing, history });
}

function list(db: AppDatabase, headers: Record<string, string> = {}, query = "") {
  return buildHistoryListResponse(new Request(`http://localhost/api/history${query}`, { headers }), deps(db));
}

function detail(db: AppDatabase, jobId: string, headers: Record<string, string> = {}) {
  return buildHistoryDetailResponse(
    new Request(`http://localhost/api/history/${jobId}`, { headers }),
    jobId,
    deps(db),
  );
}

function remove(db: AppDatabase, jobId: string, headers: Record<string, string> = {}) {
  return buildHistoryDeleteResponse(
    new Request(`http://localhost/api/history/${jobId}`, { method: "DELETE", headers }),
    jobId,
    deps(db),
  );
}

async function grantEntitlement(db: AppDatabase, userId: string, stripeSubscriptionId: string) {
  await billing.upsertSubscriptionFromStripe(db, {
    userId,
    stripeCustomerId: `cus_${userId}`,
    stripeSubscriptionId,
    planId: "starter",
    catalogVersion: 1,
    status: "active",
    currentPeriodStart: new Date(Date.now() - 1_000),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    cancelAtPeriodEnd: false,
    lastStripeEventId: "evt_seed",
  });
}

/**
 * Two accounts, one claimed job each, plus one job left anonymous. Both
 * accounts are entitled, so nothing below can pass merely because the other
 * caller lacked a subscription.
 */
async function scenario() {
  const db = await createTestDatabase();

  const ownerJob = await persistHumanizationJob(db, jobInput(OWNER_RESULT));
  const strangerJob = await persistHumanizationJob(db, jobInput(STRANGER_RESULT));
  const anonymousJob = await persistHumanizationJob(db, jobInput("Never claimed by anyone."));

  const owner = await billing.getOrCreateUserByExternalSubject(db, { externalSubject: "owner", email: null });
  const stranger = await billing.getOrCreateUserByExternalSubject(db, { externalSubject: "stranger", email: null });

  await billing.claimJobForUser(db, { capabilityDigest: await digestOf(ownerJob.capabilityToken), userId: owner.userId });
  await billing.claimJobForUser(db, { capabilityDigest: await digestOf(strangerJob.capabilityToken), userId: stranger.userId });

  await grantEntitlement(db, owner.userId, "sub_owner");
  await grantEntitlement(db, stranger.userId, "sub_stranger");

  return { db, ownerJob, strangerJob, anonymousJob, owner, stranger };
}

async function listBody(response: Response): Promise<HistoryListBody> {
  assert.equal(response.status, 200);
  return (await response.json()) as HistoryListBody;
}

// ---------------------------------------------------------------------
// Every query filters by the server-derived user ID
// ---------------------------------------------------------------------

test("the list returns only the jobs the caller owns", async () => {
  const { db, ownerJob } = await scenario();

  const body = await listBody(await list(db, authHeaders("owner")));
  assert.deepEqual(body.items.map((item) => item.jobId), [ownerJob.jobId]);
  assert.equal(body.entitled, true);
});

test("another entitled user's list never contains someone else's job", async () => {
  const { db, strangerJob } = await scenario();

  const body = await listBody(await list(db, authHeaders("stranger")));
  assert.deepEqual(body.items.map((item) => item.jobId), [strangerJob.jobId]);
});

test("an unclaimed anonymous job appears in nobody's list", async () => {
  const { db, anonymousJob } = await scenario();

  for (const subject of ["owner", "stranger"]) {
    const body = await listBody(await list(db, authHeaders(subject)));
    assert.ok(!body.items.some((item) => item.jobId === anonymousJob.jobId));
  }
});

test("a signed-in visitor with no account row gets an empty history, not an error", async () => {
  const { db } = await scenario();

  const body = await listBody(await list(db, authHeaders("never-seen-before")));
  assert.deepEqual(body.items, []);
  assert.equal(body.entitled, false);
});

test("no client-supplied filter can widen the list", async () => {
  // The only thing the list reads off the request is identity. Every
  // parameter an attacker might hope is honored is ignored outright.
  const { db, ownerJob } = await scenario();
  const forged = [
    "?user=stranger",
    "?userId=stranger",
    "?owner_user_id=",
    "?all=true&limit=1000",
    "?jobs[]=%2A&order=created_at",
  ];
  for (const query of forged) {
    const body = await listBody(await list(db, authHeaders("owner"), query));
    assert.deepEqual(body.items.map((item) => item.jobId), [ownerJob.jobId], `query ${query} must change nothing`);
  }
});

// ---------------------------------------------------------------------
// Anonymous capabilities cannot enumerate
// ---------------------------------------------------------------------

test("an anonymous caller cannot enumerate anything", async () => {
  const { db } = await scenario();

  const response = await list(db);
  assert.equal(response.status, 401);
  const body = await response.text();
  assert.ok(!body.includes("jobId"), "a refusal must not carry a job list");
});

test("a valid preview capability grants its one job and enumerates nothing", async () => {
  // The capability is real and unexpired — it still buys no listing, because
  // no history path reads a capability at all.
  const { db, ownerJob } = await scenario();

  for (const attempt of [
    () => list(db, {}, `?capability=${encodeURIComponent(ownerJob.capabilityToken)}`),
    () => list(db, { "x-capability": ownerJob.capabilityToken }),
    () => list(db, { authorization: `Bearer ${ownerJob.capabilityToken}` }),
  ]) {
    const response = await attempt();
    assert.equal(response.status, 401);
    const text = await response.text();
    assert.ok(!text.includes(ownerJob.jobId));
    assert.ok(!text.includes(OWNER_RESULT));
  }

  // And it cannot open the job it does own through the history detail path.
  const detailAttempt = await detail(db, ownerJob.jobId, { "x-capability": ownerJob.capabilityToken });
  assert.equal(detailAttempt.status, 401);
});

test("identity headers are ignored off the trusted host", async () => {
  // SEC-01 containment: on an origin that does not pass through the hosting
  // boundary, the identity headers are forgeable, so they buy nothing.
  const { db, ownerJob } = await scenario();
  const request = new Request(`https://humanizer.workers.dev/api/history`, { headers: authHeaders("owner") });

  const response = await buildHistoryListResponse(request, deps(db));
  assert.equal(response.status, 401);
  assert.ok(!(await response.text()).includes(ownerJob.jobId));
});

// ---------------------------------------------------------------------
// The list is metadata only
// ---------------------------------------------------------------------

test("the list response never carries a full rewrite", async () => {
  const { db } = await scenario();

  const raw = await (await list(db, authHeaders("owner"))).text();
  assert.ok(!raw.includes(OWNER_RESULT), "the owner's own full rewrite must stay behind the detail path");
  assert.ok(!raw.includes(STRANGER_RESULT));
  assert.ok(raw.includes(PREVIEW_TEXT), "the already-approved preview projection is what the list shows");

  const body = JSON.parse(raw) as HistoryListBody;
  const [item] = body.items;
  assert.deepEqual(Object.keys(item).sort(), [
    "createdAt", "hiddenWordCount", "inputWordCount", "issuesImproved", "jobId",
    "meaningPreservation", "mode", "naturalness", "preview", "protectedItems",
    "state", "successfulWordCount",
  ]);
});

test("the list is refused rather than silently emptied when the database is unavailable", async () => {
  const response = await buildHistoryListResponse(
    new Request("http://localhost/api/history", { headers: authHeaders("owner") }),
    async () => { throw new Error("D1 binding unavailable"); },
  );
  assert.equal(response.status, 503);
});

// ---------------------------------------------------------------------
// Detail: ownership plus the same active-entitlement check as /api/result
// ---------------------------------------------------------------------

test("the owner opens their own rewrite in full", async () => {
  const { db, ownerJob } = await scenario();

  const response = await detail(db, ownerJob.jobId, authHeaders("owner"));
  assert.equal(response.status, 200);
  const body = (await response.json()) as { result: string; jobId: string; preview: string };
  assert.equal(body.result, OWNER_RESULT);
  assert.equal(body.jobId, ownerJob.jobId);
  assert.equal(body.preview, PREVIEW_TEXT);
});

test("an entitled stranger cannot open someone else's rewrite", async () => {
  const { db, ownerJob } = await scenario();

  const response = await detail(db, ownerJob.jobId, authHeaders("stranger"));
  assert.equal(response.status, 404);
  assert.ok(!(await response.text()).includes(OWNER_RESULT));
});

test("an unclaimed job and a job that never existed answer identically", async () => {
  const { db, anonymousJob } = await scenario();

  const unclaimed = await detail(db, anonymousJob.jobId, authHeaders("owner"));
  const nonexistent = await detail(db, "00000000-0000-4000-8000-000000000000", authHeaders("owner"));

  assert.equal(unclaimed.status, nonexistent.status);
  assert.deepEqual(await unclaimed.json(), await nonexistent.json());
});

test("a lapsed owner sees their metadata but cannot open the full rewrite", async () => {
  const { db, ownerJob, owner } = await scenario();
  await billing.upsertSubscriptionFromStripe(db, {
    userId: owner.userId,
    stripeCustomerId: `cus_${owner.userId}`,
    stripeSubscriptionId: "sub_owner",
    planId: "starter",
    catalogVersion: 1,
    status: "canceled",
    currentPeriodStart: new Date(Date.now() - 60_000),
    currentPeriodEnd: new Date(Date.now() - 1_000),
    cancelAtPeriodEnd: true,
    lastStripeEventId: "evt_cancel",
  });

  const listed = await listBody(await list(db, authHeaders("owner")));
  assert.equal(listed.entitled, false);
  assert.deepEqual(listed.items.map((item) => item.jobId), [ownerJob.jobId]);

  const response = await detail(db, ownerJob.jobId, authHeaders("owner"));
  assert.equal(response.status, 404);
  assert.ok(!(await response.text()).includes(OWNER_RESULT));
});

test("a malformed job identifier is refused before any lookup", async () => {
  const { db } = await scenario();
  for (const bad of ["", "../../etc/passwd", "' OR 1=1 --", "x".repeat(200), "<script>"]) {
    assert.equal((await detail(db, bad, authHeaders("owner"))).status, 404);
    assert.equal((await remove(db, bad, authHeaders("owner"))).status, 404);
  }
});

// ---------------------------------------------------------------------
// Delete: inaccessible, purged, idempotent
// ---------------------------------------------------------------------

async function payloadRow(db: AppDatabase, jobId: string) {
  const [row] = await db.select().from(schema.jobPayloads).where(eq(schema.jobPayloads.jobId, jobId)).limit(1);
  return row;
}

test("deleting an owned rewrite makes it 404 on both list and detail", async () => {
  const { db, ownerJob } = await scenario();

  const deleted = await remove(db, ownerJob.jobId, authHeaders("owner"));
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { deleted: true });

  const listed = await listBody(await list(db, authHeaders("owner")));
  assert.deepEqual(listed.items, []);

  const opened = await detail(db, ownerJob.jobId, authHeaders("owner"));
  assert.equal(opened.status, 404);
  assert.ok(!(await opened.text()).includes(OWNER_RESULT));
});

test("delete voids the payload refs and stamps purgedAt rather than only hiding the row", async () => {
  const { db, ownerJob } = await scenario();
  const before = await payloadRow(db, ownerJob.jobId);
  assert.equal(before.resultRef, OWNER_RESULT);
  assert.equal(before.purgedAt, null);

  await remove(db, ownerJob.jobId, authHeaders("owner"));

  const after = await payloadRow(db, ownerJob.jobId);
  assert.equal(after.resultRef, null, "the rewrite text must be gone, not merely unreachable");
  assert.equal(after.sourceRef, "");
  assert.equal(after.previewProjection, null);
  assert.ok(after.purgedAt instanceof Date, "purgedAt is the tombstone the purge worker reads");

  const [protectedItem] = await db
    .select()
    .from(schema.protectedItems)
    .where(eq(schema.protectedItems.jobId, ownerJob.jobId))
    .limit(1);
  assert.equal(protectedItem.valueRef, null);
  assert.ok(protectedItem.purgedAt instanceof Date);
});

test("delete enqueues exactly one history_item deletion job, and repeating it enqueues no more", async () => {
  const { db, ownerJob } = await scenario();

  await remove(db, ownerJob.jobId, authHeaders("owner"));
  const first = await db.select().from(schema.deletionJobs).where(eq(schema.deletionJobs.subjectId, ownerJob.jobId));
  assert.equal(first.length, 1);
  assert.equal(first[0].subjectType, "job");
  assert.equal(first[0].scope, "history_item");
  assert.equal(first[0].status, "pending");

  const repeat = await remove(db, ownerJob.jobId, authHeaders("owner"));
  assert.equal(repeat.status, 200);
  assert.deepEqual(await repeat.json(), { deleted: true }, "a repeated delete answers identically");

  const second = await db.select().from(schema.deletionJobs).where(eq(schema.deletionJobs.subjectId, ownerJob.jobId));
  assert.equal(second.length, 1, "an idempotent delete must not queue a second purge");
});

test("a stranger's delete is refused and destroys nothing", async () => {
  const { db, ownerJob } = await scenario();

  const response = await remove(db, ownerJob.jobId, authHeaders("stranger"));
  assert.equal(response.status, 404);

  const row = await payloadRow(db, ownerJob.jobId);
  assert.equal(row.resultRef, OWNER_RESULT, "a refused delete must leave the owner's data untouched");
  assert.equal(row.purgedAt, null);

  const owned = await listBody(await list(db, authHeaders("owner")));
  assert.deepEqual(owned.items.map((item) => item.jobId), [ownerJob.jobId]);
});

test("nobody can delete an unclaimed anonymous job through this path", async () => {
  const { db, anonymousJob } = await scenario();

  const response = await remove(db, anonymousJob.jobId, authHeaders("owner"));
  assert.equal(response.status, 404);
  assert.equal((await payloadRow(db, anonymousJob.jobId)).purgedAt, null);
});

test("an anonymous caller cannot delete anything", async () => {
  const { db, ownerJob } = await scenario();

  const response = await remove(db, ownerJob.jobId);
  assert.equal(response.status, 401);
  assert.equal((await payloadRow(db, ownerJob.jobId)).resultRef, OWNER_RESULT);
});

test("delete never reports success when the database is unavailable", async () => {
  const response = await buildHistoryDeleteResponse(
    new Request("http://localhost/api/history/00000000-0000-4000-8000-000000000000", { method: "DELETE", headers: authHeaders("owner") }),
    "00000000-0000-4000-8000-000000000000",
    async () => { throw new Error("D1 binding unavailable"); },
  );
  assert.equal(response.status, 503);
});

test("deleting one rewrite leaves the account's other rewrites intact", async () => {
  const { db, owner } = await scenario();
  const second = await persistHumanizationJob(db, jobInput("A second owned rewrite."));
  await billing.claimJobForUser(db, { capabilityDigest: await digestOf(second.capabilityToken), userId: owner.userId });

  const before = await listBody(await list(db, authHeaders("owner")));
  assert.equal(before.items.length, 2);

  await remove(db, second.jobId, authHeaders("owner"));

  const after = await listBody(await list(db, authHeaders("owner")));
  assert.equal(after.items.length, 1);
  assert.ok(!after.items.some((item) => item.jobId === second.jobId));
});
