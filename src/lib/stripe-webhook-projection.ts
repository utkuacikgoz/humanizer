// M2-04/M2-05/M2-06 projector, extracted from app/api/webhooks/stripe/route.ts
// so the inbox + projection logic that actually decides entitlement can be
// driven directly from tests (tests/webhook-adversarial.test.mts) against a
// real SQLite database. The route keeps ownership of the parts that cannot
// run outside the Workers runtime — reading the raw body, resolving secrets,
// and verifying the Stripe signature — and delegates everything after
// verification to `ingestVerifiedStripeEvent` below.
//
// This module must stay free of `cloudflare:workers`, `next/headers`, and
// `next/navigation` imports (see app/api/checkout/route.ts's note): anything
// importing those transitively crashes tests/*.test.mts at import time.
import type Stripe from "stripe";
import type { AppDatabase } from "../../db/repository";
import type { SubscriptionStatus } from "../../db/schema";
import { STRIPE_CATALOG_VERSION, type PlanId } from "@/src/config/stripe";

export const SUBSCRIPTION_EVENT_TYPES: ReadonlySet<string> = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

export function extractObjectId(event: Stripe.Event): string | null {
  const object = event.data.object as { id?: unknown };
  return typeof object.id === "string" ? object.id : null;
}

function toId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

export function extractSubscriptionId(event: Stripe.Event): string | null {
  const object = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
      return toId((object as Stripe.Checkout.Session).subscription);
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return (object as Stripe.Subscription).id;
    case "invoice.paid":
    case "invoice.payment_failed":
      return (object as Stripe.Invoice).parent?.subscription_details?.subscription
        ? toId((object as Stripe.Invoice).parent!.subscription_details!.subscription)
        : null;
    default:
      return null;
  }
}

/**
 * Reverse-maps a live Stripe price ID back to an internal plan ID via the
 * server-owned catalog. `subscription.metadata.planId` (set once at
 * Checkout creation, per app/api/checkout/route.ts) is NOT used for this:
 * a plan/price change made later through Stripe's self-service Billing
 * Portal or dashboard updates the subscription's price but never touches
 * its metadata, so trusting stored metadata here would keep granting the
 * *original* plan's entitlement forever after a downgrade (MON review
 * finding). Re-deriving from the live price is what actually satisfies
 * docs/MONETIZATION.md's "Map Stripe price ID to internal plan version
 * server-side" for every subsequent event, not just the first one.
 */
export function planIdForPrice(priceId: string | undefined, priceIds: Record<PlanId, string>): PlanId | null {
  if (!priceId) return null;
  const match = (Object.entries(priceIds) as [PlanId, string][]).find(([, id]) => id === priceId);
  return match?.[0] ?? null;
}

/** The only Stripe API surface the projector uses; keeps it stubbable in tests. */
export interface StripeSubscriptionSource {
  subscriptions: { retrieve(id: string): Promise<Stripe.Subscription> };
}

/** The subset of db/billing-repository.ts the projector depends on. */
export interface WebhookBillingPort {
  recordStripeEvent(
    db: AppDatabase,
    input: { eventId: string; eventType: string; objectId: string | null; stripeCreatedAt: Date },
  ): Promise<"new" | "retry" | "already-processed" | "attempts-exhausted">;
  markStripeEventOutcome(db: AppDatabase, eventId: string, status: "processed" | "failed"): Promise<void>;
  upsertSubscriptionFromStripe(
    db: AppDatabase,
    input: {
      userId: string;
      stripeCustomerId: string;
      stripeSubscriptionId: string;
      planId: string;
      catalogVersion: number;
      status: SubscriptionStatus;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
      cancelAtPeriodEnd: boolean;
      lastStripeEventId: string | null;
    },
  ): Promise<void>;
}

export interface IngestInput {
  db: AppDatabase;
  stripe: StripeSubscriptionSource;
  event: Stripe.Event;
  billing: WebhookBillingPort;
  priceIds: Record<PlanId, string>;
  /**
   * The mode of the configured Stripe secret key (src/lib/stripe-config.ts).
   * An event whose own `livemode` flag disagrees is from the wrong Stripe
   * environment and is refused before it can touch the inbox or entitlement.
   */
  expectedLivemode: boolean;
}

export type IngestOutcome =
  | "environment-mismatch"
  | "already-processed"
  | "attempts-exhausted"
  | "processed"
  | "failed";

export interface IngestResult {
  outcome: IngestOutcome;
  /** The HTTP status the webhook route should return to Stripe. */
  status: number;
}

export async function projectSubscriptionEvent(input: {
  db: AppDatabase;
  stripe: StripeSubscriptionSource;
  event: Stripe.Event;
  billing: WebhookBillingPort;
  priceIds: Record<PlanId, string>;
}): Promise<void> {
  if (!SUBSCRIPTION_EVENT_TYPES.has(input.event.type)) return;
  const subscriptionId = extractSubscriptionId(input.event);
  if (!subscriptionId) return;

  // Always re-fetched: this is Stripe's current truth regardless of which
  // event (possibly out of order, possibly a replay of a long-stale one)
  // triggered this call. Projecting the event's own embedded object would
  // let a delayed `customer.subscription.created` resurrect an entitlement
  // that Stripe has since canceled.
  const subscription = await input.stripe.subscriptions.retrieve(subscriptionId);
  const userId = subscription.metadata?.userId;
  if (!userId) return; // not one of ours, or created outside our checkout flow — skip safely

  const item = subscription.items.data[0];
  if (!item) return;

  const planId = planIdForPrice(item.price?.id, input.priceIds);
  if (!planId) return; // current price isn't a plan we sell — skip safely rather than guess

  await input.billing.upsertSubscriptionFromStripe(input.db, {
    userId,
    stripeCustomerId: toId(subscription.customer as string | { id: string }) ?? "",
    stripeSubscriptionId: subscription.id,
    planId,
    catalogVersion: STRIPE_CATALOG_VERSION,
    status: subscription.status as SubscriptionStatus,
    currentPeriodStart: new Date(item.current_period_start * 1000),
    currentPeriodEnd: new Date(item.current_period_end * 1000),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    lastStripeEventId: input.event.id,
  });
}

/**
 * Everything the webhook route does after signature verification: the
 * environment-mode check, the inbox insert/dedupe, projection, and outcome
 * marking. Returns the HTTP status the route should hand back to Stripe.
 *
 * Fail-closed ordering matters here and is asserted in
 * tests/webhook-adversarial.test.mts:
 * - The livemode check runs BEFORE the inbox insert, so a wrong-environment
 *   event never occupies an inbox row nor reaches the projector. It returns
 *   400 rather than 500 deliberately: a mode mismatch is a deployment
 *   misconfiguration, and asking Stripe to retry it forever would only turn
 *   a configuration error into a retry storm.
 * - An already-processed event returns 200 without repeating any side
 *   effect (replay defense, docs/MONETIZATION.md).
 * - A processing failure returns 500 so Stripe retries, but only within the
 *   attempt budget db/billing-repository.ts enforces.
 */
export async function ingestVerifiedStripeEvent(input: IngestInput): Promise<IngestResult> {
  if (input.event.livemode !== input.expectedLivemode) {
    return { outcome: "environment-mismatch", status: 400 };
  }

  const inboxResult = await input.billing.recordStripeEvent(input.db, {
    eventId: input.event.id,
    eventType: input.event.type,
    objectId: extractObjectId(input.event),
    stripeCreatedAt: new Date(input.event.created * 1000),
  });

  if (inboxResult === "already-processed") {
    // A true duplicate: this exact event already succeeded. Acknowledge
    // without repeating any side effect.
    return { outcome: "already-processed", status: 200 };
  }
  if (inboxResult === "attempts-exhausted") {
    // Stop asking Stripe to retry a permanently-failing event; it stays
    // recorded as `failed` for manual investigation (docs/MONETIZATION.md:
    // "permanent unsupported events are recorded and safely acknowledged").
    return { outcome: "attempts-exhausted", status: 200 };
  }

  try {
    await projectSubscriptionEvent({
      db: input.db,
      stripe: input.stripe,
      event: input.event,
      billing: input.billing,
      priceIds: input.priceIds,
    });
    await input.billing.markStripeEventOutcome(input.db, input.event.id, "processed");
    return { outcome: "processed", status: 200 };
  } catch {
    // Never log the raw error here: it can carry Stripe object contents.
    await input.billing.markStripeEventOutcome(input.db, input.event.id, "failed");
    return { outcome: "failed", status: 500 }; // Stripe retries a 5xx response.
  }
}
