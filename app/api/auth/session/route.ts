// GET /api/auth/session — whether the caller's own cookie names a live
// session, and the address behind it.
//
// The session cookie is HttpOnly by design, so the sign-in page cannot see it
// and has to ask. This answers only for the cookie the caller presented.
import { buildSessionStateResponse } from "@/src/lib/magic-link";
import { loadMagicLinkDeps } from "../auth-deps";

export async function GET(request: Request) {
  return buildSessionStateResponse(request, loadMagicLinkDeps);
}
