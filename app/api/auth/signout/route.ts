// POST /api/auth/signout — end the session server-side and clear the cookie.
//
// POST, never GET: a link that signs someone out is a nuisance any third-party
// page can trigger, and a GET sign-out would be fetched by every prefetcher.
import { buildSignOutResponse } from "@/src/lib/magic-link";
import { loadMagicLinkDeps } from "../auth-deps";

export async function POST(request: Request) {
  return buildSignOutResponse(request, loadMagicLinkDeps);
}
