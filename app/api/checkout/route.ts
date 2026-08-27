// M2-03: Checkout Session creation. Requires a valid preview job
// capability and an authenticated identity — payment is bound to a
// specific job and a specific signed-in user server-side; the client
// supplies neither price, plan allowance, nor its own identity as
// authority (D-003).
//
// CSRF. Identity is a cookie now, so the note this comment used to carry
// ("no cookie-based session to forge") no longer holds and the protection it
// promised is here: the session cookie is SameSite=Lax, which a browser does
// not attach to a cross-site POST at all, and any request arriving with an
// Origin naming another site is refused outright (isCrossSiteRequest). Both
// are needed — Lax is the control, the Origin check is the belt.
import { isCrossSiteRequest, once, readSessionCookie, resolveSessionUser, signInPath } from "@/src/lib/identity";
import { isPurchasablePlan } from "@/src/config/stripe";

const CAPABILITY_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

// One verification per price ID per isolate, not per checkout: the first
// request pays a single Stripe read, the rest reuse it. Keyed by price ID
// so rotating STRIPE_PRICE_STARTER re-verifies instead of trusting a
// cached pass for a different price.
const verifiedPriceIds = new Set<string>();

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  if (isCrossSiteRequest(request)) {
    return Response.json({ error: "This request did not come from Ownword." }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return Response.json({ error: "Send a JSON body." }, { status: 415 });
  }

  // Presence of a session cookie is not authentication — the session is
  // resolved against the database below, before anything is claimed or
  // charged. Checking presence first only keeps a signed-out caller from
  // needing a database binding to be told to sign in, which is the same
  // property the previous header check had.
  if (!readSessionCookie(request)) {
    return signedOut();
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
    const [{ getDb }, { getStripeClient, StripeNotConfiguredError, StripeConfigInvalidError }, billing, auth] = await Promise.all([
      import("../../../db/index"),
      import("../../../db/stripe-client"),
      import("../../../db/billing-repository"),
      import("../../../db/auth-repository"),
    ]);
    const db = getDb();
    const user = await resolveSessionUser(request, once(async () => ({ db, auth })));
    if (!user) return signedOut();
    let stripe, config;
    try {
      ({ stripe, config } = getStripeClient());
    } catch (error) {
      if (error instanceof StripeNotConfiguredError || error instanceof StripeConfigInvalidError) {
        return Response.json({ error: "Checkout is not available yet." }, { status: 503, headers: { "cache-control": "no-store" } });
      }
      throw error;
    }

    // Never send a customer to Checkout for a Price that charges something
    // other than what the page advertised (MON: bait-and-switch guard).
    const priceId = config.priceIds[planId];
    if (!verifiedPriceIds.has(priceId)) {
      const { assertPriceMatchesCatalog, PriceMismatchError } = await import("@/src/lib/price-integrity");
      try {
        assertPriceMatchesCatalog(planId, await stripe.prices.retrieve(priceId));
        verifiedPriceIds.add(priceId);
      } catch (error) {
        if (error instanceof PriceMismatchError) {
          // Fail closed and loudly: this is a misconfiguration, not a
          // user error. Charging here would be the actual harm.
          console.error("[checkout] price integrity check failed:", error.message);
          return Response.json({ error: "Checkout is not available yet." }, { status: 503, headers: { "cache-control": "no-store" } });
        }
        throw error;
      }
    }

    // The session already names the local user row: sign-in created it.
    const { userId } = user;

    // SEC-04: never sell a second subscription to someone who already has
    // one. The idempotency key below is per job+plan, so a returning
    // subscriber starting a new job would sail past it and be charged twice.
    // There is no history surface yet, so the unlock card is exactly what a
    // returning customer sees — this is the normal path, not an edge case.
    const existingEntitlement = await billing.getActiveEntitlement(db, userId);
    if (existingEntitlement) {
      return Response.json(
        {
          error: "You already have an active subscription.",
          alreadySubscribed: true,
          manageBillingPath: "/#manage-billing",
        },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }
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
        line_items: [{ price: priceId, quantity: 1 }],
        // Discounts are Stripe's to own, not ours. Letting the customer enter
        // a promotion code Stripe validates keeps every discount decision on
        // Stripe's side of the boundary: this application still sends only a
        // price ID it resolved server-side from the catalog, and still never
        // sends, accepts, or trusts an amount. A homegrown coupon table would
        // have reintroduced exactly the client-influenced-price path
        // docs/SECURITY.md verified does not exist.
        //
        // Coupons are created in the Stripe dashboard. A 100%-off code is the
        // supported way to exercise the full paid journey — real Checkout,
        // real webhook, real entitlement, real unlock — without moving money.
        allow_promotion_codes: true,
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

function signedOut() {
  return Response.json(
    { error: "Sign in to continue.", signInPath: signInPath("/") },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}
