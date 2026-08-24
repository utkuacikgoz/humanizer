// M3-01 authorized history: the list/detail/delete access decisions, extracted
// from app/api/history/** so they are directly testable under plain Node
// against a real SQLite database (tests/history-access.test.mts). The routes
// keep only the lazy `db/index` import that needs the Workers runtime.
//
// This module must stay free of `cloudflare:workers`, `next/headers`, and
// `next/navigation` imports.
//
// The acceptance criterion for M3-01 is an authorization property, so it is
// worth stating exactly how it is met here:
//
//   * The user id is always derived server-side, from the hosting boundary's
//     identity headers via resolveChatGPTUserFromHeaders, then mapped to a
//     local row. It is never read from the URL, the body, or a header the
//     client controls.
//   * The only client-supplied value any of these paths accepts is a single
//     job id on detail/delete, and it is re-checked against `owner_user_id`
//     in the same query that selects the row.
//   * An anonymous preview capability grants exactly its one job through
//     /api/preview, as before. Nothing here reads a capability, so a
//     capability cannot enumerate: with no identity these paths answer 401
//     before a database binding is even loaded.
//   * A job owned by nobody, owned by someone else, or already deleted
//     produces the identical 404 shape as a job that never existed.
import { resolveChatGPTUserFromHeaders } from "@/src/lib/chatgpt-identity";
import { isJobIdShape } from "@/src/lib/result-access";
import type { AppDatabase } from "../../db/repository";
import type { Entitlement, UnlockedResult } from "../../db/billing-repository";
import type { HistoryDeletionOutcome, HistoryEntry } from "../../db/history-repository";

const NO_STORE = { "cache-control": "no-store" } as const;
const JSON_HEADERS = { ...NO_STORE, "x-content-type-options": "nosniff" } as const;

/** The subset of db/billing-repository.ts these routes depend on. */
export interface HistoryBillingPort {
  findUserIdByExternalSubject(db: AppDatabase, externalSubject: string): Promise<string | null>;
  getActiveEntitlement(db: AppDatabase, userId: string): Promise<Entitlement | null>;
  getUnlockedResult(db: AppDatabase, input: { userId: string; jobId: string }): Promise<UnlockedResult | null>;
}

/** The subset of db/history-repository.ts these routes depend on. */
export interface HistoryPort {
  listHistoryForUser(db: AppDatabase, userId: string): Promise<HistoryEntry[]>;
  findHistoryEntryForUser(db: AppDatabase, input: { userId: string; jobId: string }): Promise<HistoryEntry | null>;
  deleteHistoryEntryForUser(db: AppDatabase, input: { userId: string; jobId: string }): Promise<HistoryDeletionOutcome>;
}

export interface HistoryAccessDeps {
  db: AppDatabase;
  billing: HistoryBillingPort;
  history: HistoryPort;
}

export interface HistoryListBody {
  /** True only when the local subscription projection says the account is active/trialing right now. */
  entitled: boolean;
  items: HistoryEntry[];
}

export type HistoryDetailBody = HistoryEntry & UnlockedResult;

function notFound() {
  return Response.json({ error: "Rewrite not found." }, { status: 404, headers: NO_STORE });
}

function signInRequired() {
  return Response.json({ error: "Sign in to view your history." }, { status: 401, headers: NO_STORE });
}

function unavailable() {
  return Response.json({ error: "History is unavailable right now." }, { status: 503, headers: NO_STORE });
}

/**
 * GET /api/history.
 *
 * Returns metadata for the signed-in caller's own rewrites and nothing else.
 * The request carries no filter, no id, and no ordering the server honours —
 * the whole query is `owner_user_id = <server-derived id>`, so there is no
 * client-supplied input for an attacker to widen.
 *
 * Not gated on an active entitlement, deliberately. Every field returned here
 * is from the preview projection an anonymous visitor already sees before
 * paying, so no paid content is released; and a lapsed subscriber has to be
 * able to see what is stored about them in order to delete it. The full
 * rewrite stays behind the entitlement check on the detail path. `entitled`
 * is reported so the interface can say honestly which items it can open.
 */
export async function buildHistoryListResponse(
  request: Request,
  loadDeps: () => Promise<HistoryAccessDeps>,
): Promise<Response> {
  const user = resolveChatGPTUserFromHeaders(request);
  if (!user) return signInRequired();

  try {
    const { db, billing, history } = await loadDeps();
    const userId = await billing.findUserIdByExternalSubject(db, user.userId);
    // A signed-in visitor with no local account has no history rather than an
    // error: there is nothing to hide and nothing to reveal.
    if (!userId) return Response.json({ entitled: false, items: [] } satisfies HistoryListBody, { headers: JSON_HEADERS });

    const [entitlement, items] = await Promise.all([
      billing.getActiveEntitlement(db, userId),
      history.listHistoryForUser(db, userId),
    ]);
    return Response.json({ entitled: entitlement !== null, items } satisfies HistoryListBody, { headers: JSON_HEADERS });
  } catch {
    // Includes the D1 binding being unavailable. Fail closed with an explicit
    // service error rather than an empty list, which would read as "you have
    // no rewrites" and could prompt someone to redo work they still have.
    return unavailable();
  }
}

/**
 * GET /api/history/{id}.
 *
 * Ownership is established first, then the full rewrite is released only by
 * db/billing-repository.ts's getUnlockedResult — the same ownership plus
 * active-entitlement decision /api/result already makes, not a second copy of
 * it. A deleted item fails at the ownership step, because the delete voided
 * the payload and stamped `purged_at`, which both this path's lookup and
 * getUnlockedResult treat as gone.
 */
export async function buildHistoryDetailResponse(
  request: Request,
  jobId: string,
  loadDeps: () => Promise<HistoryAccessDeps>,
): Promise<Response> {
  if (!isJobIdShape(jobId)) return notFound();

  const user = resolveChatGPTUserFromHeaders(request);
  if (!user) return signInRequired();

  try {
    const { db, billing, history } = await loadDeps();
    const userId = await billing.findUserIdByExternalSubject(db, user.userId);
    if (!userId) return notFound();

    const entry = await history.findHistoryEntryForUser(db, { userId, jobId });
    if (!entry) return notFound();

    const unlocked = await billing.getUnlockedResult(db, { userId, jobId });
    // Owned, but no active entitlement (or the webhook has not landed yet).
    // Same 404 shape; the metadata the list already showed this same caller is
    // all they keep.
    if (!unlocked) return Response.json({ error: "Rewrite not found.", locked: true }, { status: 404, headers: NO_STORE });

    return Response.json({ ...entry, ...unlocked } satisfies HistoryDetailBody, { headers: JSON_HEADERS });
  } catch {
    return notFound();
  }
}

/**
 * DELETE /api/history/{id}.
 *
 * The DELETE verb is load-bearing, not decoration: a cross-site form can only
 * issue GET or POST, and a cross-site `fetch` with this method is stopped by
 * the CORS preflight, so a third-party page cannot destroy a signed-in
 * customer's work by navigation alone. There is no session cookie to check
 * beyond that; identity is the boundary-injected header set.
 *
 * Idempotent: repeating a delete returns the same success body, and a delete
 * of something the caller does not own returns the same 404 as a delete of
 * something that never existed.
 */
export async function buildHistoryDeleteResponse(
  request: Request,
  jobId: string,
  loadDeps: () => Promise<HistoryAccessDeps>,
): Promise<Response> {
  if (!isJobIdShape(jobId)) return notFound();

  const user = resolveChatGPTUserFromHeaders(request);
  if (!user) return signInRequired();

  try {
    const { db, billing, history } = await loadDeps();
    const userId = await billing.findUserIdByExternalSubject(db, user.userId);
    if (!userId) return notFound();

    const outcome = await history.deleteHistoryEntryForUser(db, { userId, jobId });
    if (outcome === "not-found") return notFound();
    return Response.json({ deleted: true }, { headers: JSON_HEADERS });
  } catch {
    // Never report a deletion that may not have happened.
    return unavailable();
  }
}
