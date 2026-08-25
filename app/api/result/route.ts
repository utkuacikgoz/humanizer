// M2-08/M2-09: server-authoritative unlock. Returns the full, previously
// server-side-generated rewrite only when the caller's verified identity
// both owns the job and currently holds an active entitlement — never
// from a Checkout redirect, query flag, or client-supplied state (D-006).
//
// The decision logic lives in src/lib/result-access.ts so it can be tested
// against a real database under plain Node; this route only supplies the
// Workers-runtime-bound dependencies.
import { buildResultResponse } from "@/src/lib/result-access";

export async function GET(request: Request) {
  return buildResultResponse(request, async () => {
    const [{ getDb }, billing, auth] = await Promise.all([
      import("../../../db/index"),
      import("../../../db/billing-repository"),
      import("../../../db/auth-repository"),
    ]);
    return { db: getDb(), billing, auth };
  });
}
