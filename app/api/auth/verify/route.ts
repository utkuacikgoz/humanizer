// GET /api/auth/verify — redeem a sign-in link and start a session.
//
// GET because this is what a mail client opens. That is also why the token is
// single-use with a short life: a link in an inbox is a bearer credential,
// and some mail providers fetch links before a human ever clicks. A prefetch
// that spends the token costs the customer one extra request for a new link;
// a long-lived, reusable token would cost them their account.
import { buildVerifyResponse } from "@/src/lib/magic-link";
import { loadMagicLinkDeps } from "../auth-deps";

export async function GET(request: Request) {
  return buildVerifyResponse(request, loadMagicLinkDeps);
}
