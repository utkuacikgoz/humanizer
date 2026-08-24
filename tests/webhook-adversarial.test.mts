// M2-11 adversarial billing matrix — webhook half (docs/QA.md's M2 gate:
// "Signature, replay, ordering, environment mismatch ... tests pass").
//
// These drive the real projector/inbox (src/lib/stripe-webhook-projection.ts,
// the exact code app/api/webhooks/stripe/route.ts calls after signature
// verification) against a real SQLite database through the same migrations
// D1 runs, with only Stripe's HTTP API stubbed. Signature verification
// itself is covered in tests/webhook.test.mts and is not duplicated here.
import assert from "node:assert/strict";
import test from "node:test";
import * as billing from "../db/billing-repository";
import { ingestVerifiedStripeEvent } from "../src/lib/stripe-webhook-projection";
import { createTestDatabase } from "./helpers/sqlite-db.mjs";
import { stripeEvent, stripeStub, stripeSubscription } from "./helpers/stripe-fixtures.mjs";

const PRICE_IDS = { starter: "price_starter_test" } as const;

async function setup(subscriptionOverrides: Parameters<typeof stripeSubscription>[0] = {}) {
  const db = await createTestDatabase();
  const { userId } = await billing.getOrCreateUserByExternalSubject(db, { externalSubject: "sub_webhook", email: null });
  const stripe = stripeStub(stripeSubscription({ userId, ...subscriptionOverrides }));
  const ingest = (event: Parameters<typeof ingestVerifiedStripeEvent>[0]["event"], expectedLivemode = false) =>
    ingestVerifiedStripeEvent({ db, stripe, event, billing, priceIds: PRICE_IDS, expectedLivemode });
  return { db, userId, stripe, ingest };
}

test("replayed webhook delivery performs no second side effect", async () => {
  const { db, userId, stripe, ingest } = await setup();
  const event = stripeEvent({ id: "evt_replay_1" });

  const first = await ingest(event);
  const second = await ingest(event);

  assert.equal(first.outcome, "processed");
  assert.equal(second.outcome, "already-processed");
  assert.equal(second.status, 200, "a duplicate must be acknowledged, not retried");
  assert.equal(stripe.calls.length, 1, "the replay must not re-fetch or re-project the subscription");

  const rows = await db.select().from((await import("../db/schema")).subscriptions);
  assert.equal(rows.length, 1, "a replay must not create a second subscription row");
  assert.ok(await billing.getActiveEntitlement(db, userId));
});

test("a Stripe retry after a failed projection is genuinely reprocessed", async () => {
  const { db, userId, stripe, ingest } = await setup();
  stripe.failNextRetrieves(1);

  const failed = await ingest(stripeEvent({ id: "evt_retry_1" }));
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.status, 500, "a transient failure must ask Stripe to retry");
  assert.equal(await billing.getActiveEntitlement(db, userId), null, "a failed projection grants nothing");

  const retried = await ingest(stripeEvent({ id: "evt_retry_1" }));
  assert.equal(retried.outcome, "processed");
  assert.equal(stripe.calls.length, 2, "the retry must actually re-attempt the projection");
  assert.ok(await billing.getActiveEntitlement(db, userId), "the retry converges on the correct entitlement");
});

test("a live-mode event is refused by a test-mode deployment before it touches the inbox", async () => {
  const { db, userId, stripe, ingest } = await setup();
  const liveEvent = stripeEvent({ id: "evt_livemode_1", livemode: true });

  const result = await ingest(liveEvent, /* expectedLivemode */ false);

  assert.equal(result.outcome, "environment-mismatch");
  assert.equal(result.status, 400, "a wrong-environment event must not be retried forever");
  assert.equal(stripe.calls.length, 0, "a wrong-environment event must never reach the projector");
  assert.equal(await billing.getActiveEntitlement(db, userId), null);

  const inbox = await db.select().from((await import("../db/schema")).stripeEvents);
  assert.equal(inbox.length, 0, "a wrong-environment event must not occupy an inbox row");
});

test("a test-mode event is refused by a live-mode deployment", async () => {
  const { db, userId, stripe, ingest } = await setup();

  const result = await ingest(stripeEvent({ id: "evt_testmode_1", livemode: false }), /* expectedLivemode */ true);

  assert.equal(result.outcome, "environment-mismatch");
  assert.equal(stripe.calls.length, 0);
  assert.equal(await billing.getActiveEntitlement(db, userId), null);
});

test("a stale event delivered after a newer one cannot resurrect a canceled entitlement", async () => {
  const { db, userId, stripe, ingest } = await setup();

  // Current truth arrives first: the subscription is canceled.
  stripe.setSubscription(stripeSubscription({ userId, status: "canceled" }));
  await ingest(stripeEvent({ id: "evt_order_new", type: "customer.subscription.deleted", created: new Date() }));
  assert.equal(await billing.getActiveEntitlement(db, userId), null);

  // Then an OLD creation event, delayed in delivery, lands. Because the
  // projector re-fetches Stripe's current object rather than projecting the
  // event's embedded payload, it re-projects "canceled" — it does not
  // reinstate the entitlement the stale event describes.
  const stale = stripeEvent({
    id: "evt_order_old",
    type: "customer.subscription.created",
    created: new Date(Date.now() - 60 * 60 * 1000),
    object: { id: "sub_test_1", object: "subscription", status: "active" },
  });
  const result = await ingest(stale);

  assert.equal(result.outcome, "processed");
  assert.equal(await billing.getActiveEntitlement(db, userId), null, "an out-of-order event must not grant access Stripe has revoked");
});

test("events delivered in reverse order converge on Stripe's current state", async () => {
  const { db, userId, stripe, ingest } = await setup();

  await ingest(stripeEvent({ id: "evt_conv_1", type: "customer.subscription.updated" }));
  assert.ok(await billing.getActiveEntitlement(db, userId));

  stripe.setSubscription(stripeSubscription({ userId, status: "past_due" }));
  await ingest(stripeEvent({ id: "evt_conv_2", type: "invoice.payment_failed", object: { id: "in_test_1", object: "invoice", parent: { subscription_details: { subscription: "sub_test_1" } } } }));

  assert.equal(await billing.getActiveEntitlement(db, userId), null, "past_due is not an active entitlement");
});

test("the plan is re-derived from the live price, never from stale subscription metadata", async () => {
  // Simulates a self-service downgrade through the Billing Portal: Stripe
  // updates the subscription's price but never rewrites the metadata written
  // at Checkout creation.
  const { db, userId, ingest } = await setup({ planIdMetadata: "pro", priceId: PRICE_IDS.starter });

  await ingest(stripeEvent({ id: "evt_plan_1" }));

  const entitlement = await billing.getActiveEntitlement(db, userId);
  assert.equal(entitlement?.planId, "starter", "the entitlement must follow the live price, not metadata.planId");
});

test("a subscription on a price we do not sell is skipped rather than guessed", async () => {
  const { db, userId, ingest } = await setup({ priceId: "price_not_in_our_catalog" });

  const result = await ingest(stripeEvent({ id: "evt_unknown_price" }));

  assert.equal(result.outcome, "processed", "an unmappable event is acknowledged, not retried forever");
  assert.equal(await billing.getActiveEntitlement(db, userId), null, "an unknown price must never grant an entitlement");
});

test("a subscription created outside our checkout flow grants nothing", async () => {
  const { db, userId, ingest } = await setup({ userId: null });

  const result = await ingest(stripeEvent({ id: "evt_no_metadata" }));

  assert.equal(result.outcome, "processed");
  assert.equal(await billing.getActiveEntitlement(db, userId), null);
});

test("a forged subscription claiming another user's ID cannot be projected onto a nonexistent account", async () => {
  // subscriptions.user_id is a real foreign key; a metadata.userId that is
  // not an existing internal user cannot silently create an entitlement row.
  const { db, ingest } = await setup({ userId: "not-a-real-user-id" });

  const result = await ingest(stripeEvent({ id: "evt_forged_user" }));

  assert.equal(result.status, 500, "a foreign-key violation must fail closed and stay retryable");
  const rows = await db.select().from((await import("../db/schema")).subscriptions);
  assert.equal(rows.length, 0);
});
