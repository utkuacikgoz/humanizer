// Redeems an anonymous preview capability issued by POST /api/humanize
// (M1-09: "survives refresh/checkout initiation" per docs/AGENTS.md).
// This is a non-destructive read — it never consumes/rotates the
// capability. Consumption only happens in the future M2-01 claim
// transaction when a job is linked to an authenticated payer.
import { PreviewRequestGuard } from "@/src/lib/preview-request-guard";

const CAPABILITY_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const NOT_FOUND_BODY = { error: "This preview link is no longer available." };

type RedeemedPayload = Record<string, unknown> | typeof NOT_FOUND_BODY;

// Reuses the same per-client rate-limit/coalescing guard POST
// /api/humanize already applies — this endpoint was previously
// unthrottled (MQA finding: 10 rapid sequential redemptions all
// succeeded instantly, each doing multiple D1 reads with no cost).
// Idempotency key here is just the capability token itself: redeeming
// the same capability repeatedly is naturally idempotent and safe to
// coalesce/replay, unlike POST /api/humanize's per-submission key.
const requestGuard = new PreviewRequestGuard<RedeemedPayload>();

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function GET(request: Request) {
  const capability = new URL(request.url).searchParams.get("capability")?.trim() ?? "";
  if (!CAPABILITY_TOKEN.test(capability)) {
    return Response.json(NOT_FOUND_BODY, { status: 404, headers: { "cache-control": "no-store" } });
  }

  const clientId = request.headers.get("cf-connecting-ip")?.trim() || "anonymous-runtime";
  const guarded = await requestGuard.run({
    clientId,
    idempotencyKey: capability,
    fingerprint: await sha256Hex(capability),
    execute: async (): Promise<RedeemedPayload> => {
      try {
        const { getDb } = await import("../../../db/index");
        const { redeemPreviewCapability } = await import("../../../db/repository");
        const redeemed = await redeemPreviewCapability(getDb(), capability);
        if (!redeemed) return NOT_FOUND_BODY; // unknown/expired/already-claimed — see below
        return { original: redeemed.original, ...redeemed.projection, capabilityExpiresAt: redeemed.capabilityExpiresAt.toISOString() };
      } catch {
        // Includes the D1 binding being unavailable (e.g. local/dev/test
        // environments without persistence configured) — same uniform response.
        return NOT_FOUND_BODY;
      }
    },
  });

  if (!guarded.ok) {
    const headers: Record<string, string> = { "cache-control": "no-store" };
    if (guarded.retryAfterSeconds) headers["retry-after"] = String(guarded.retryAfterSeconds);
    return Response.json({ error: guarded.error }, { status: guarded.status, headers });
  }

  // Unknown, expired, and already-claimed capabilities all take this same
  // path deliberately — see docs/SECURITY.md's Enumeration/error oracle
  // control. Do not add detail that would let a caller distinguish "wrong
  // token" from "expired" from "already claimed".
  if (guarded.value === NOT_FOUND_BODY) {
    return Response.json(NOT_FOUND_BODY, { status: 404, headers: { "cache-control": "no-store" } });
  }
  return Response.json(guarded.value, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
