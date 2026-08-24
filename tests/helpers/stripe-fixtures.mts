// Minimal Stripe object/event factories for the M2-11 adversarial matrix.
//
// These build only the fields src/lib/stripe-webhook-projection.ts actually
// reads and cast to the real SDK types, rather than hand-rolling a parallel
// "subscription-like" interface: the projector keeps its production
// signatures (Stripe.Event / Stripe.Subscription), so a future SDK shape
// change surfaces as a type error in the projector instead of quietly
// passing against a test-only stand-in type.
import type Stripe from "stripe";

export interface SubscriptionFixture {
  id?: string;
  status?: string;
  userId?: string | null;
  planIdMetadata?: string;
  priceId?: string;
  customer?: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
}

const HOUR_MS = 60 * 60 * 1000;

export function stripeSubscription(fixture: SubscriptionFixture = {}): Stripe.Subscription {
  const start = fixture.currentPeriodStart ?? new Date(Date.now() - HOUR_MS);
  const end = fixture.currentPeriodEnd ?? new Date(Date.now() + 30 * 24 * HOUR_MS);
  const metadata: Record<string, string> = {};
  if (fixture.userId !== null) metadata.userId = fixture.userId ?? "user-placeholder";
  if (fixture.planIdMetadata) metadata.planId = fixture.planIdMetadata;

  return {
    id: fixture.id ?? "sub_test_1",
    object: "subscription",
    status: fixture.status ?? "active",
    customer: fixture.customer ?? "cus_test_1",
    cancel_at_period_end: fixture.cancelAtPeriodEnd ?? false,
    metadata,
    items: {
      object: "list",
      data: [
        {
          id: "si_test_1",
          object: "subscription_item",
          price: { id: fixture.priceId ?? "price_starter_test", object: "price" },
          current_period_start: Math.floor(start.getTime() / 1000),
          current_period_end: Math.floor(end.getTime() / 1000),
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

export interface EventFixture {
  id?: string;
  type?: string;
  created?: Date;
  livemode?: boolean;
  /** The event's own embedded object — deliberately allowed to disagree with what the API returns. */
  object?: Record<string, unknown>;
}

export function stripeEvent(fixture: EventFixture = {}): Stripe.Event {
  return {
    id: fixture.id ?? "evt_test_1",
    object: "event",
    api_version: "2026-07-29.dahlia",
    created: Math.floor((fixture.created ?? new Date()).getTime() / 1000),
    livemode: fixture.livemode ?? false,
    pending_webhooks: 0,
    request: null,
    type: fixture.type ?? "customer.subscription.updated",
    data: { object: fixture.object ?? { id: "sub_test_1", object: "subscription" } },
  } as unknown as Stripe.Event;
}

/**
 * A stub of the only Stripe API call the projector makes, recording every
 * retrieve so tests can assert that a replayed event performs no second
 * fetch (and therefore no second side effect).
 */
export function stripeStub(initial: Stripe.Subscription) {
  const calls: string[] = [];
  let current = initial;
  let failNext = 0;
  return {
    calls,
    setSubscription(next: Stripe.Subscription) { current = next; },
    failNextRetrieves(count: number) { failNext = count; },
    subscriptions: {
      async retrieve(id: string): Promise<Stripe.Subscription> {
        calls.push(id);
        if (failNext > 0) {
          failNext -= 1;
          throw new Error("stripe api unavailable");
        }
        return current;
      },
    },
  };
}
