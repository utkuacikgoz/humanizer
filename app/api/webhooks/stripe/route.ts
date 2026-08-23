// M2-04/M2-05/M2-06: verified webhook ingress, inbox, and subscription
// projector. Raw body is read exactly once and signature-verified before
// any parsing or side effect (docs/MONETIZATION.md). This route always
// re-fetches the authoritative subscription object from the Stripe API
// rather than trusting a webhook payload's embedded object, since
// delivery order is never guaranteed — see db/billing-repository.ts's
// upsertSubscriptionFromStripe doc comment.
import type Stripe from "stripe";
import type { AppDatabase } from "../../../../db/repository";
import type { SubscriptionStatus } from "../../../../db/schema";
import { STRIPE_CATALOG_VERSION, type PlanId } from "@/src/config/stripe";

const SUBSCRIPTION_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

function extractObjectId(event: Stripe.Event): string | null {
  const object = event.data.object as { id?: unknown };
  return typeof object.id === "string" ? object.id : null;
}

function toId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function extractSubscriptionId(event: Stripe.Event): string | null {
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

async function projectSubscriptionEvent(input: { db: AppDatabase; stripe: Stripe; event: Stripe.Event; billing: typeof import("../../../../db/billing-repository") }) {
  if (!SUBSCRIPTION_EVENT_TYPES.has(input.event.type)) return;
  const subscriptionId = extractSubscriptionId(input.event);
  if (!subscriptionId) return;

  // Always re-fetched: this is Stripe's current truth regardless of
  // which event (possibly out of order) triggered this call.
  const subscription = await input.stripe.subscriptions.retrieve(subscriptionId);
  const userId = subscription.metadata.userId;
  const planId = subscription.metadata.planId as PlanId | undefined;
  if (!userId || !planId) return; // not one of ours, or created outside our checkout flow — skip safely

  const item = subscription.items.data[0];
  if (!item) return;

  await input.billing.upsertSubscriptionFromStripe(input.db, {
    userId,
    stripeCustomerId: toId(subscription.customer) ?? "",
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

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response(null, { status: 400 });

  // Read the untouched raw body before any parsing, per docs/MONETIZATION.md.
  const rawBody = await request.text();

  let getDb: typeof import("../../../../db/index").getDb;
  let billing: typeof import("../../../../db/billing-repository");
  let stripe: Stripe;
  let webhookSecret: string;
  try {
    const [dbModule, billingModule, stripeClientModule] = await Promise.all([
      import("../../../../db/index"),
      import("../../../../db/billing-repository"),
      import("../../../../db/stripe-client"),
    ]);
    getDb = dbModule.getDb;
    billing = billingModule;
    const client = stripeClientModule.getStripeClient();
    stripe = client.stripe;
    webhookSecret = client.config.webhookSecret;
  } catch {
    // Stripe/D1 not configured. 500 so Stripe retries once configuration lands.
    return new Response(null, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch {
    // Invalid signature, wrong secret, or stale timestamp: never process, never retry.
    return new Response(null, { status: 400 });
  }

  const db = getDb();
  const inboxResult = await billing.recordStripeEvent(db, {
    eventId: event.id,
    eventType: event.type,
    objectId: extractObjectId(event),
    stripeCreatedAt: new Date(event.created * 1000),
  });
  if (inboxResult === "already-processed") {
    // A true duplicate: this exact event already succeeded. Acknowledge
    // without repeating any side effect.
    return new Response(null, { status: 200 });
  }
  if (inboxResult === "attempts-exhausted") {
    // Stop asking Stripe to retry a permanently-failing event; it stays
    // recorded as `failed` for manual investigation (docs/MONETIZATION.md:
    // "permanent unsupported events are recorded and safely acknowledged").
    return new Response(null, { status: 200 });
  }

  try {
    await projectSubscriptionEvent({ db, stripe, event, billing });
    await billing.markStripeEventOutcome(db, event.id, "processed");
    return new Response(null, { status: 200 });
  } catch {
    // Never log the raw error here: it can carry Stripe object contents.
    await billing.markStripeEventOutcome(db, event.id, "failed");
    return new Response(null, { status: 500 }); // Stripe retries a 5xx response.
  }
}
