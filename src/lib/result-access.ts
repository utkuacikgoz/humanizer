// M2-08/M2-09 unlock decision, extracted from app/api/result/route.ts so the
// authorization path that releases paid content is directly testable under
// plain Node against a real SQLite database (tests/result-access.test.mts).
// The route keeps only the lazy `db/index` import that needs the Workers
// runtime; every access decision below is shared code, so the tests exercise
// the same branches production does.
//
// This module must stay free of `cloudflare:workers`, `next/headers`, and
// `next/navigation` imports.
import { once, resolveSessionUser, type SessionPort } from "@/src/lib/identity";
import type { AppDatabase } from "../../db/repository";
import type { UnlockedResult } from "../../db/billing-repository";

// Job IDs are server-generated UUIDs; anything else is refused before a query
// is built. Ownership is still checked on the row itself — this is input
// hygiene, never the access control.
const JOB_ID = /^[0-9a-f-]{8,64}$/i;

/** Shared with src/lib/history-access.ts so both paths refuse the same shapes. */
export function isJobIdShape(value: string): boolean {
  return JOB_ID.test(value);
}

const NO_STORE = { "cache-control": "no-store" } as const;

/** The subset of db/billing-repository.ts this route depends on. */
export interface ResultAccessPort {
  getUnlockedResult(db: AppDatabase, input: { userId: string; jobId: string }): Promise<UnlockedResult | null>;
}

export interface ResultAccessDeps {
  db: AppDatabase;
  billing: ResultAccessPort;
  /** Identity is a session row now, so resolving it needs the database too. */
  auth: SessionPort;
}

function notFound(pending = false) {
  return Response.json(
    pending ? { error: "Result not found.", pending: true } : { error: "Result not found." },
    { status: 404, headers: NO_STORE },
  );
}

/**
 * Resolves GET /api/result.
 *
 * The URL is read for exactly one thing: the opaque job ID. Every other
 * query parameter a Checkout redirect could carry — `session_id`,
 * `success`, `plan`, a forged customer or price ID — is ignored outright.
 * docs/SECURITY.md classes "Checkout/redirect forgery ... unlock possible"
 * as Critical, and D-006 makes the local entitlement projection the only
 * authority; that is enforced by this function simply never reading those
 * parameters, and asserted in tests/result-access.test.mts.
 *
 * `loadDeps` is invoked lazily and memoized, so a caller with no session
 * cookie and a request with a malformed job id never need a database binding
 * at all — which is also what lets the route's 401/404 behavior be asserted
 * in an environment with no D1. Identity itself is now a database lookup
 * (src/lib/identity.ts), so a caller who DOES present a cookie loads deps
 * once and shares them with the entitlement check below.
 */
export async function buildResultResponse(
  request: Request,
  loadDeps: () => Promise<ResultAccessDeps>,
): Promise<Response> {
  const jobId = new URL(request.url).searchParams.get("job")?.trim() ?? "";
  if (!JOB_ID.test(jobId)) return notFound();

  const deps = once(loadDeps);
  let userId: string;
  try {
    const user = await resolveSessionUser(request, deps);
    if (!user) {
      return Response.json({ error: "Sign in to view this result." }, { status: 401, headers: NO_STORE });
    }
    // The session already names the local user row; nothing here maps an
    // identifier the client supplied onto an account.
    userId = user.userId;
  } catch {
    // Identity could not be resolved (no binding, a database failure). Fail
    // closed as not-found rather than as "signed out", which would send a
    // signed-in customer round a sign-in loop that cannot help them.
    return notFound();
  }

  try {
    const { db, billing } = await deps();

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
      return notFound(true);
    }

    return Response.json(unlocked, { headers: { ...NO_STORE, "x-content-type-options": "nosniff" } });
  } catch {
    // Includes the D1 binding being unavailable. Fail closed: never fall
    // back to serving content when the entitlement check could not run.
    return notFound();
  }
}
