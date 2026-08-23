// M2-03: Checkout Session creation. Requires a valid preview job
// capability and an authenticated identity — payment is bound to a
// specific job and a specific signed-in user server-side; the client
// supplies neither price, plan allowance, nor its own identity as
// authority (D-003).
//
// No app-level CSRF token: this route has no cookie-based session to
// forge in the first place. Identity arrives exclusively via
// oai-authenticated-user-* headers injected by the trusted hosting
// boundary (app/chatgpt-auth.ts) — a cross-site form/fetch cannot set
// those. If a cookie-based auth path is ever added, this reasoning no
// longer holds and CSRF protection becomes required here.
import { chatGPTSignInPath, resolveChatGPTUserFromHeaders } from "@/src/lib/chatgpt-identity";
import { isPurchasablePlan } from "@/src/config/stripe";

const CAPABILITY_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return Response.json({ error: "Send a JSON body." }, { status: 415 });
  }

  const user = resolveChatGPTUserFromHeaders(request.headers);
  if (!user) {
    return Response.json({ error: "Sign in to continue.", signInPath: chatGPTSignInPath("/") }, { status: 401, headers: { "cache-control": "no-store" } });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "The request body is not valid JSON." }, { status: 400 });
  }
  if (!payload || typeof payload !== "object") {
    return Response.json({ error: "A capability and plan are required." }, { status: 400 });
  }

  const { capability, planId } = payload as { capability?: unknown; planId?: unknown };
  if (typeof capability !== "string" || !CAPABILITY_TOKEN.test(capability)) {
    return Response.json({ error: "This preview link is no longer available." }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  if (typeof planId !== "string" || !isPurchasablePlan(planId)) {
    return Response.json({ error: "Choose a valid plan." }, { status: 400 });
  }

  try {
    const [{ getDb }, { getStripeClient, StripeNotConfiguredError, StripeConfigInvalidError }, billing] = await Promise.all([
      import("../../../db/index"),
      import("../../../db/stripe-client"),
      import("../../../db/billing-repository"),
    ]);
    const db = getDb();
    let stripe, config;
    try {
      ({ stripe, config } = getStripeClient());
    } catch (error) {
      if (error instanceof StripeNotConfiguredError || error instanceof StripeConfigInvalidError) {
        return Response.json({ error: "Checkout is not available yet." }, { status: 503, headers: { "cache-control": "no-store" } });
      }
      throw error;
    }

    const { userId } = await billing.getOrCreateUserByExternalSubject(db, { externalSubject: user.userId, email: user.email });
    const capabilityDigest = await sha256Hex(capability);
    const claimed = await billing.claimJobForUser(db, { capabilityDigest, userId });
    if (!claimed) {
      return Response.json({ error: "This preview link is no longer available." }, { status: 404, headers: { "cache-control": "no-store" } });
    }

    const existingCustomerId = await billing.getStripeCustomerId(db, userId);
    const origin = new URL(request.url).origin;

    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        line_items: [{ price: config.priceIds[planId], quantity: 1 }],
        client_reference_id: userId,
        // Opaque internal references only — never writing, capability
        // tokens, or sensitive attributes (D-005).
        metadata: { jobId: claimed.jobId, userId, planId },
        subscription_data: { metadata: { jobId: claimed.jobId, userId, planId } },
        ...(existingCustomerId ? { customer: existingCustomerId } : { customer_email: user.email }),
        success_url: `${origin}/checkout/success?job=${encodeURIComponent(claimed.jobId)}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?checkout=canceled`,
      },
      // Stable per job+plan: a retried/double-clicked request converges on
      // the same session instead of creating a second one (M2-03).
      { idempotencyKey: `checkout:${claimed.jobId}:${planId}` },
    );

    if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
    return Response.json({ url: session.url }, { headers: { "cache-control": "no-store" } });
  } catch {
    // Never surface raw Stripe/driver error details to the client.
    return Response.json({ error: "Checkout could not be started. Please try again." }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
