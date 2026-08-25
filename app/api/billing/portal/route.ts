// M2-10: Billing Portal. A portal session is created only for the
// authenticated caller's own mapped Stripe customer — never a
// client-supplied customer ID (docs/MONETIZATION.md).
//
// CSRF: see app/api/checkout/route.ts's note — SameSite=Lax plus the
// same-origin check, now that identity is a cookie.
import { isCrossSiteRequest, once, readSessionCookie, resolveSessionUser } from "@/src/lib/identity";

export async function POST(request: Request) {
  if (isCrossSiteRequest(request)) {
    return Response.json({ error: "This request did not come from Ownword." }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  if (!readSessionCookie(request)) return signedOut();

  try {
    const [{ getDb }, { getStripeClient, StripeNotConfiguredError, StripeConfigInvalidError }, billing, auth] = await Promise.all([
      import("../../../../db/index"),
      import("../../../../db/stripe-client"),
      import("../../../../db/billing-repository"),
      import("../../../../db/auth-repository"),
    ]);
    const db = getDb();

    const user = await resolveSessionUser(request, once(async () => ({ db, auth })));
    if (!user) return signedOut();
    const customerId = await billing.getStripeCustomerId(db, user.userId);
    if (!customerId) {
      return Response.json({ error: "No billing account found." }, { status: 404, headers: { "cache-control": "no-store" } });
    }

    let stripe;
    try {
      ({ stripe } = getStripeClient());
    } catch (error) {
      if (error instanceof StripeNotConfiguredError || error instanceof StripeConfigInvalidError) {
        return Response.json({ error: "Billing is not available yet." }, { status: 503, headers: { "cache-control": "no-store" } });
      }
      throw error;
    }

    const origin = new URL(request.url).origin;
    const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${origin}/` });
    return Response.json({ url: session.url }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "Billing portal could not be opened. Please try again." }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}

function signedOut() {
  return Response.json({ error: "Sign in to manage billing." }, { status: 401, headers: { "cache-control": "no-store" } });
}
