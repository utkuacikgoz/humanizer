// POST /api/auth/request-link — mail a sign-in link.
//
// The decision logic lives in src/lib/magic-link.ts so it can be driven
// against a real database, and a stub mail sender, under plain Node. This
// route only supplies the runtime-bound dependencies.
import { buildSignInRequestResponse } from "@/src/lib/magic-link";
import { loadMagicLinkDeps } from "../auth-deps";

export async function POST(request: Request) {
  return buildSignInRequestResponse(request, loadMagicLinkDeps);
}
