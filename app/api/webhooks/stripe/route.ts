// M2-04/M2-05/M2-06: verified webhook ingress. Raw body is read exactly
// once and signature-verified before any parsing or side effect
// (docs/MONETIZATION.md). Everything after verification — the test/live
// environment check, the inbox, and the idempotent subscription projector —
// lives in src/lib/stripe-webhook-projection.ts, which is a pure module and
// therefore directly testable under plain Node against a real SQLite
// database (tests/webhook-adversarial.test.mts). Only the parts that
// genuinely need the Workers runtime stay here.
import type Stripe from "stripe";
import { ingestVerifiedStripeEvent } from "@/src/lib/stripe-webhook-projection";
import type { StripeConfig } from "../../../../db/stripe-client";

// Stripe's own event payloads are small (well under 1MB); this is
// defense-in-depth against an unauthenticated caller sending an oversized
// body before signature verification even runs, independent of whatever
// platform-level request-size limit Cloudflare Workers enforces (MQA finding).
const MAX_WEBHOOK_BODY_BYTES = 1_000_000;

async function readLimitedBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_WEBHOOK_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response(null, { status: 400 });

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }

  // Read the untouched raw body before any parsing, per docs/MONETIZATION.md.
  let rawBody: string | null;
  try {
    rawBody = await readLimitedBody(request);
  } catch {
    return new Response(null, { status: 400 }); // invalid encoding
  }
  if (rawBody === null) return new Response(null, { status: 413 });

  let getDb: typeof import("../../../../db/index").getDb;
  let billing: typeof import("../../../../db/billing-repository");
  let stripe: Stripe;
  let config: StripeConfig;
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
    config = client.config;
  } catch {
    // Stripe/D1 not configured. 500 so Stripe retries once configuration lands.
    return new Response(null, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, config.webhookSecret);
  } catch {
    // Invalid signature, wrong secret, or stale timestamp: never process, never retry.
    return new Response(null, { status: 400 });
  }

  try {
    const { status } = await ingestVerifiedStripeEvent({
      db: getDb(),
      stripe,
      event,
      billing,
      priceIds: config.priceIds,
      expectedLivemode: config.livemode,
    });
    return new Response(null, { status });
  } catch {
    // The inbox itself (not projection) failed — e.g. D1 unavailable mid
    // request. Never log the raw error: it can carry Stripe object contents.
    // 500 so Stripe retries rather than the event being silently dropped.
    return new Response(null, { status: 500 });
  }
}
