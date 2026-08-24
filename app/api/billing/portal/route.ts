// M2-10: Billing Portal. A portal session is created only for the
// authenticated caller's own mapped Stripe customer — never a
// client-supplied customer ID (docs/MONETIZATION.md).
//
// No app-level CSRF token: see app/api/checkout/route.ts's identical
// note — this route has the same header-only identity boundary.
import { resolveChatGPTUserFromHeaders } from "@/src/lib/chatgpt-identity";

export async function POST(request: Request) {
  const user = resolveChatGPTUserFromHeaders(request);
  if (!user) {
    return Response.json({ error: "Sign in to manage billing." }, { status: 401, headers: { "cache-control": "no-store" } });
  }

  try {
    const [{ getDb }, { getStripeClient, StripeNotConfiguredError, StripeConfigInvalidError }, billing] = await Promise.all([
      import("../../../../db/index"),
      import("../../../../db/stripe-client"),
      import("../../../../db/billing-repository"),
    ]);
    const db = getDb();

    const userId = await billing.findUserIdByExternalSubject(db, user.userId);
    const customerId = userId ? await billing.getStripeCustomerId(db, userId) : null;
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
