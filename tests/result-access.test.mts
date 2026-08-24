// M2-11 adversarial billing matrix — unlock half (docs/QA.md's M2 gate:
// "redirect forgery, and webhook-lag tests pass"; "Success/cancel query
// parameters and forged session/customer/price IDs never unlock").
//
// These drive src/lib/result-access.ts — the exact decision path
// app/api/result/route.ts delegates to — against a real SQLite database,
// so every assertion here is about production behavior rather than a
// re-implementation of it.
import assert from "node:assert/strict";
import test from "node:test";
import * as billing from "../db/billing-repository";
import { persistHumanizationJob } from "../db/repository";
import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from "../db/schema";
import { buildResultResponse } from "../src/lib/result-access";
import { ingestVerifiedStripeEvent } from "../src/lib/stripe-webhook-projection";
import { createTestDatabase } from "./helpers/sqlite-db.mjs";
import { stripeEvent, stripeStub, stripeSubscription } from "./helpers/stripe-fixtures.mjs";
import type { AppDatabase } from "../db/repository";

const FULL_RESULT = "The full paid rewrite text — must never leave the server without a verified entitlement.";
const PRICE_IDS = { starter: "price_starter_test" } as const;

const jobInput = () => ({
  mode: "natural" as const,
  clientFingerprint: "client-fp",
  idempotencyKey: crypto.randomUUID(),
  contentFingerprint: "content-fp",
  inputWordCount: 40,
  successfulWordCount: 40,
  pipelineVersion: 1,
  original: "The original text a user submitted.",
  result: FULL_RESULT,
  protectedContent: [],
  previewProjection: {
    preview: "The original text a user submitted.",
    hiddenWordCount: 4,
    issuesImproved: 1,
    naturalness: "Strong" as const,
    meaningPreservation: "High" as const,
    protectedItems: [],
  },
});

async function digestOf(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function get(db: AppDatabase, query: string, headers: Record<string, string> = {}) {
  return buildResultResponse(
    new Request(`http://localhost/api/result${query}`, { headers }),
    async () => ({ db, billing }),
  );
}

function authHeaders(externalSubject: string) {
  return {
    "oai-authenticated-user-id": externalSubject,
    "oai-authenticated-user-email": `${externalSubject}@example.com`,
  };
}

async function grantEntitlement(db: AppDatabase, userId: string, overrides: Partial<{
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date;
  stripeSubscriptionId: string;
}> = {}) {
  await billing.upsertSubscriptionFromStripe(db, {
    userId,
    stripeCustomerId: "cus_test",
    stripeSubscriptionId: overrides.stripeSubscriptionId ?? "sub_test",
    planId: "starter",
    catalogVersion: 1,
    status: overrides.status ?? "active",
    currentPeriodStart: new Date(Date.now() - 1_000),
    currentPeriodEnd: overrides.currentPeriodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    cancelAtPeriodEnd: overrides.cancelAtPeriodEnd ?? false,
    lastStripeEventId: "evt_seed",
  });
}

/** Owner has claimed the job; entitlement is granted separately per test. */
async function scenario() {
  const db = await createTestDatabase();
  const job = await persistHumanizationJob(db, jobInput());
  const owner = await billing.getOrCreateUserByExternalSubject(db, { externalSubject: "owner", email: null });
  const stranger = await billing.getOrCreateUserByExternalSubject(db, { externalSubject: "stranger", email: null });
  await billing.claimJobForUser(db, { capabilityDigest: await digestOf(job.capabilityToken), userId: owner.userId });
  return { db, job, owner, stranger };
}

async function assertLocked(response: Response) {
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.text();
  assert.ok(!body.includes(FULL_RESULT), "the locked result must never appear in the response body");
}

test("an unauthenticated caller is refused before any lookup", async () => {
  const { db, job } = await scenario();
  const response = await get(db, `?job=${job.jobId}`);
  assert.equal(response.status, 401);
});

test("a malformed job identifier is refused without a database query", async () => {
  const { db } = await scenario();
  for (const bad of ["", "../../etc/passwd", "' OR 1=1 --", "x".repeat(200), "<script>"]) {
    const response = await get(db, `?job=${encodeURIComponent(bad)}`, authHeaders("owner"));
    await assertLocked(response);
  }
});

test("forged Checkout return parameters do not unlock anything", async () => {
  // The classic redirect forgery: the attacker owns the job but never paid,
  // and decorates the return URL with everything a naive implementation
  // might trust (docs/SECURITY.md: "Checkout/redirect forgery ... Critical
  // if unlock possible").
  const { db, job } = await scenario();
  const forged = [
    `?job=${job.jobId}&success=true`,
    `?job=${job.jobId}&session_id=cs_test_forged_session_id`,
    `?job=${job.jobId}&session_id={CHECKOUT_SESSION_ID}&paid=1&entitled=true`,
    `?job=${job.jobId}&customer=cus_someone_else&price=price_starter_test&plan=pro`,
    `?job=${job.jobId}&subscription=sub_active&status=active`,
  ];
  for (const query of forged) {
    await assertLocked(await get(db, query, authHeaders("owner")));
  }
});

test("a genuinely entitled owner is unaffected by whatever junk the redirect carries", async () => {
  // The mirror of the test above: the unlock decision must depend only on
  // ownership plus entitlement, so extra parameters change nothing either way.
  const { db, job, owner } = await scenario();
  await grantEntitlement(db, owner.userId);

  const clean = await get(db, `?job=${job.jobId}`, authHeaders("owner"));
  const noisy = await get(db, `?job=${job.jobId}&success=false&plan=nonexistent&session_id=cs_forged`, authHeaders("owner"));

  assert.equal(clean.status, 200);
  assert.equal(noisy.status, 200);
  assert.deepEqual(await clean.json(), await noisy.json());
});

test("an entitled stranger cannot read another user's job", async () => {
  const { db, job, stranger } = await scenario();
  await grantEntitlement(db, stranger.userId, { stripeSubscriptionId: "sub_stranger" });

  await assertLocked(await get(db, `?job=${job.jobId}`, authHeaders("stranger")));
});

test("an unclaimed job is not readable by anyone, entitled or not", async () => {
  const db = await createTestDatabase();
  const job = await persistHumanizationJob(db, jobInput());
  const buyer = await billing.getOrCreateUserByExternalSubject(db, { externalSubject: "buyer", email: null });
  await grantEntitlement(db, buyer.userId);

  await assertLocked(await get(db, `?job=${job.jobId}`, authHeaders("buyer")));
});

test("only active and trialing subscription statuses unlock", async () => {
  const unlocking: ReadonlySet<SubscriptionStatus> = new Set(["active", "trialing"]);

  for (const status of SUBSCRIPTION_STATUSES) {
    const { db, job, owner } = await scenario();
    await grantEntitlement(db, owner.userId, { status });
    const response = await get(db, `?job=${job.jobId}`, authHeaders("owner"));

    if (unlocking.has(status)) {
      assert.equal(response.status, 200, `${status} should unlock`);
      assert.equal(((await response.json()) as { result: string }).result, FULL_RESULT);
    } else {
      assert.equal(response.status, 404, `${status} must NOT unlock`);
      await assertLocked(response.clone());
    }
  }
});

test("a canceled-at-period-end subscription stops unlocking once the period has elapsed", async () => {
  // The projection can be left saying `active` forever if Stripe's final
  // customer.subscription.deleted delivery never succeeds (the inbox stops
  // retrying after its attempt budget). Access must still end at the period
  // boundary the customer was told about.
  const { db, job, owner } = await scenario();
  await grantEntitlement(db, owner.userId, {
    status: "active",
    cancelAtPeriodEnd: true,
    currentPeriodEnd: new Date(Date.now() - 1_000),
  });

  await assertLocked(await get(db, `?job=${job.jobId}`, authHeaders("owner")));
});

test("a canceled-at-period-end subscription still unlocks before the period ends", async () => {
  const { db, job, owner } = await scenario();
  await grantEntitlement(db, owner.userId, {
    status: "active",
    cancelAtPeriodEnd: true,
    currentPeriodEnd: new Date(Date.now() + 60 * 60 * 1000),
  });

  const response = await get(db, `?job=${job.jobId}`, authHeaders("owner"));
  assert.equal(response.status, 200, "cancellation takes effect at the period end, not immediately");
});

test("a renewing subscription whose period end has passed still unlocks (no false lockout)", async () => {
  // The mirror of the expiry check: a normal renewal briefly leaves the
  // projection with an elapsed period_end until the renewal webhook lands.
  // That must not lock a paying customer out.
  const { db, job, owner } = await scenario();
  await grantEntitlement(db, owner.userId, {
    status: "active",
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date(Date.now() - 60 * 60 * 1000),
  });

  const response = await get(db, `?job=${job.jobId}`, authHeaders("owner"));
  assert.equal(response.status, 200);
});

test("a purged payload is not served even to an entitled owner", async () => {
  const { db, job, owner } = await scenario();
  await grantEntitlement(db, owner.userId);
  const schema = await import("../db/schema");
  const { eq } = await import("drizzle-orm");
  await db.update(schema.jobPayloads).set({ purgedAt: new Date() }).where(eq(schema.jobPayloads.jobId, job.jobId));

  await assertLocked(await get(db, `?job=${job.jobId}`, authHeaders("owner")));
});

test("webhook lag: the payer sees a pending state, then the same job unlocks once the webhook lands", async () => {
  // docs/QA.md M2 gate: "Webhook lag displays pending confirmation and later
  // unlocks the preserved job." The whole sequence runs against the real
  // projector and the real unlock path.
  const { db, job, owner } = await scenario();

  const beforeWebhook = await get(db, `?job=${job.jobId}&session_id=cs_test_real`, authHeaders("owner"));
  assert.equal(beforeWebhook.status, 404);
  const pendingBody = (await beforeWebhook.json()) as { pending?: boolean };
  assert.equal(pendingBody.pending, true, "an owner awaiting confirmation gets a pending hint, not a hard error");

  const stripe = stripeStub(stripeSubscription({ userId: owner.userId }));
  const ingested = await ingestVerifiedStripeEvent({
    db,
    stripe,
    event: stripeEvent({ id: "evt_lag_1", type: "checkout.session.completed", object: { id: "cs_test_real", object: "checkout.session", subscription: "sub_test_1" } }),
    billing,
    priceIds: PRICE_IDS,
    expectedLivemode: false,
  });
  assert.equal(ingested.outcome, "processed");

  const afterWebhook = await get(db, `?job=${job.jobId}`, authHeaders("owner"));
  assert.equal(afterWebhook.status, 200, "the original preserved job unlocks — not an empty dashboard");
  assert.equal(((await afterWebhook.json()) as { result: string }).result, FULL_RESULT);
});

test("a signed-in visitor with no account row gets the same uniform not-found", async () => {
  const { db, job } = await scenario();
  await assertLocked(await get(db, `?job=${job.jobId}`, authHeaders("never-seen-before")));
});

test("the unlock path fails closed when the database is unavailable", async () => {
  const failing = new Request("http://localhost/api/result?job=00000000-0000-4000-8000-000000000000", { headers: authHeaders("owner") });
  const response = await buildResultResponse(failing, async () => { throw new Error("D1 binding unavailable"); });
  await assertLocked(response);
});
