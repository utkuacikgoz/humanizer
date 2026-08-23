// Redeems an anonymous preview capability issued by POST /api/humanize
// (M1-09: "survives refresh/checkout initiation" per docs/AGENTS.md).
// This is a non-destructive read — it never consumes/rotates the
// capability. Consumption only happens in the future M2-01 claim
// transaction when a job is linked to an authenticated payer.
const CAPABILITY_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export async function GET(request: Request) {
  const capability = new URL(request.url).searchParams.get("capability")?.trim() ?? "";
  if (!CAPABILITY_TOKEN.test(capability)) {
    return Response.json({ error: "This preview link is no longer available." }, { status: 404, headers: { "cache-control": "no-store" } });
  }

  try {
    const { getDb } = await import("../../../db/index");
    const { redeemPreviewCapability } = await import("../../../db/repository");
    const redeemed = await redeemPreviewCapability(getDb(), capability);
    if (!redeemed) {
      // Unknown, expired, and already-claimed capabilities all take this
      // same path deliberately — see docs/SECURITY.md's Enumeration/error
      // oracle control. Do not add detail that would let a caller
      // distinguish "wrong token" from "expired" from "already claimed".
      return Response.json({ error: "This preview link is no longer available." }, { status: 404, headers: { "cache-control": "no-store" } });
    }
    return Response.json(
      { original: redeemed.original, ...redeemed.projection, capabilityExpiresAt: redeemed.capabilityExpiresAt.toISOString() },
      { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
    );
  } catch {
    // Includes the D1 binding being unavailable (e.g. local/dev/test
    // environments without persistence configured) — same uniform response.
    return Response.json({ error: "This preview link is no longer available." }, { status: 404, headers: { "cache-control": "no-store" } });
  }
}
