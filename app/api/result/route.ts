// M2-08/M2-09: server-authoritative unlock. Returns the full, previously
// server-side-generated rewrite only when the caller's verified identity
// both owns the job and currently holds an active entitlement — never
// from a Checkout redirect, query flag, or client-supplied state (D-006).
import { resolveChatGPTUserFromHeaders } from "@/src/lib/chatgpt-identity";

const JOB_ID = /^[0-9a-f-]{8,64}$/i;

export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("job")?.trim() ?? "";
  if (!JOB_ID.test(jobId)) {
    return Response.json({ error: "Result not found." }, { status: 404, headers: { "cache-control": "no-store" } });
  }

  const user = resolveChatGPTUserFromHeaders(request.headers);
  if (!user) {
    return Response.json({ error: "Sign in to view this result." }, { status: 401, headers: { "cache-control": "no-store" } });
  }

  try {
    const [{ getDb }, billing] = await Promise.all([
      import("../../../db/index"),
      import("../../../db/billing-repository"),
    ]);
    const db = getDb();
    const userId = await billing.findUserIdByExternalSubject(db, user.userId);
    if (!userId) {
      return Response.json({ error: "Result not found.", pending: true }, { status: 404, headers: { "cache-control": "no-store" } });
    }

    const unlocked = await billing.getUnlockedResult(db, { userId, jobId });
    if (!unlocked) {
      // Ownership without (yet) an active entitlement, and "not found",
      // are deliberately the same shape here — but a genuine owner mid
      // webhook-lag is a normal, expected state (M2-09's "pending
      // confirmation"), not an error, so a `pending: true` hint is safe
      // to add without becoming an enumeration oracle: it tells the
      // caller nothing about *whose* job this is or whether it exists at
      // all if they don't already hold a plausible job ID for their own
      // account.
      return Response.json({ error: "Result not found.", pending: true }, { status: 404, headers: { "cache-control": "no-store" } });
    }

    return Response.json(unlocked, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch {
    return Response.json({ error: "Result not found." }, { status: 404, headers: { "cache-control": "no-store" } });
  }
}
