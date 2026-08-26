// GET  /api/auth/verify — redeem a sign-in link, or ask for confirmation.
// POST /api/auth/verify — the confirmed redemption.
//
// GET because this is what a mail client opens. That is also why the token is
// single-use with a short life: a link in an inbox is a bearer credential,
// and some mail providers fetch links before a human ever clicks. A prefetch
// that spends the token costs the customer one extra request for a new link;
// a long-lived, reusable token would cost them their account.
//
// SEC-17: a GET alone can no longer create a session for a browser that did
// not request the link. Where the nonce cookie does not match, the GET renders
// a confirmation naming the address, and only the POST — which carries an
// Origin a top-level navigation cannot forge — signs anyone in. The decision
// logic is in src/lib/magic-link.ts so it is testable under plain Node.
import { buildVerifyConfirmationResponse, buildVerifyResponse } from "@/src/lib/magic-link";
import { loadMagicLinkDeps } from "../auth-deps";

export async function GET(request: Request) {
  return buildVerifyResponse(request, loadMagicLinkDeps);
}

export async function POST(request: Request) {
  return buildVerifyConfirmationResponse(request, loadMagicLinkDeps);
}
