// M3-05 self-service account deletion: the access decisions, extracted from
// app/api/account/route.ts so they are directly testable under plain Node
// against a real SQLite database (tests/account-deletion.test.mts). The route
// keeps only the lazy `db/index` import that needs the Workers runtime.
//
// This module must stay free of `cloudflare:workers`, `next/headers` and
// `next/navigation` imports.
//
// Authorization, stated exactly: the account acted on is the one the hosting
// boundary's identity headers resolve to, mapped to a local row server-side.
// These handlers accept no body, no id, no query parameter — there is no
// client-supplied value anywhere on this path for an attacker to point at
// someone else's account. Deleting requires nothing but proving you are the
// account holder, because ownership is the correct authority for destroying
// your own data.
import { resolveChatGPTUserFromHeaders } from "@/src/lib/chatgpt-identity";
import type { AppDatabase } from "../../db/repository";
import type { AccountDeletionResult, BillingBlock } from "../../db/account-deletion-repository";

const NO_STORE = { "cache-control": "no-store" } as const;
const JSON_HEADERS = { ...NO_STORE, "x-content-type-options": "nosniff" } as const;

/** The subset of db/billing-repository.ts this path depends on. */
export interface AccountBillingPort {
  findUserIdByExternalSubject(db: AppDatabase, externalSubject: string): Promise<string | null>;
}

/** The subset of db/account-deletion-repository.ts this path depends on. */
export interface AccountDeletionPort {
  findBillingBlockOnDeletion(db: AppDatabase, userId: string): Promise<BillingBlock | null>;
  deleteAccountForUser(db: AppDatabase, input: { userId: string }): Promise<AccountDeletionResult>;
}

export interface AccountAccessDeps {
  db: AppDatabase;
  billing: AccountBillingPort;
  account: AccountDeletionPort;
}

export interface AccountStatusBody {
  /** False only while a subscription that can still bill is attached. */
  canDelete: boolean;
  blockedBy: "active-subscription" | null;
  subscription: { planId: string; status: string; currentPeriodEnd: string } | null;
}

function signInRequired() {
  return Response.json({ error: "Sign in to manage your account." }, { status: 401, headers: NO_STORE });
}

function unavailable() {
  return Response.json({ error: "Account settings are unavailable right now." }, { status: 503, headers: NO_STORE });
}

const BLOCKED_MESSAGE =
  "Cancel your subscription first, then delete your account. We will not close an account while a subscription can still charge it.";

/**
 * GET /api/account.
 *
 * Tells the interface what deleting would do *before* anything irreversible is
 * offered. A signed-in visitor with no local account, and one whose account is
 * already deleted, both get the same "nothing is blocking you" answer: there is
 * nothing to reveal in either case.
 */
export async function buildAccountStatusResponse(
  request: Request,
  loadDeps: () => Promise<AccountAccessDeps>,
): Promise<Response> {
  const user = resolveChatGPTUserFromHeaders(request);
  if (!user) return signInRequired();

  try {
    const { db, billing, account } = await loadDeps();
    const userId = await billing.findUserIdByExternalSubject(db, user.userId);
    if (!userId) {
      return Response.json({ canDelete: true, blockedBy: null, subscription: null } satisfies AccountStatusBody, { headers: JSON_HEADERS });
    }

    const block = await account.findBillingBlockOnDeletion(db, userId);
    return Response.json({
      canDelete: block === null,
      blockedBy: block ? "active-subscription" : null,
      subscription: block
        ? { planId: block.planId, status: block.status, currentPeriodEnd: block.currentPeriodEnd.toISOString() }
        : null,
    } satisfies AccountStatusBody, { headers: JSON_HEADERS });
  } catch {
    return unavailable();
  }
}

/**
 * DELETE /api/account.
 *
 * The DELETE verb carries the same weight it does on /api/history/{id}: a
 * cross-site form can only issue GET or POST, and a cross-site `fetch` with
 * this method is stopped by the CORS preflight, so no third-party page can
 * close a signed-in customer's account by navigation alone.
 *
 * Idempotent. A second request from an already-deleted account is a 200 with
 * the same body as the first — never an error, and never a different shape
 * that would let anyone distinguish "there was an account here" from "there
 * never was one". Deletion replaces the external identity subject, so the same
 * person signing in afterwards is simply a new, empty account.
 *
 * A subscription that can still bill is refused with 409 rather than silently
 * cancelled; see db/account-deletion-repository.ts's findBillingBlockOnDeletion
 * for why, and app/history/page.tsx for the copy that says so before the
 * customer confirms.
 */
export async function buildAccountDeleteResponse(
  request: Request,
  loadDeps: () => Promise<AccountAccessDeps>,
): Promise<Response> {
  const user = resolveChatGPTUserFromHeaders(request);
  if (!user) return signInRequired();

  try {
    const { db, billing, account } = await loadDeps();
    const userId = await billing.findUserIdByExternalSubject(db, user.userId);
    // No local account: nothing is stored under this identity, so the request
    // is already satisfied. Saying so is not a leak — the caller is the only
    // person the answer is about.
    if (!userId) return Response.json({ deleted: true }, { headers: JSON_HEADERS });

    const result = await account.deleteAccountForUser(db, { userId });
    if (result.outcome === "blocked-by-subscription") {
      return Response.json({ error: BLOCKED_MESSAGE, reason: "active-subscription" }, { status: 409, headers: NO_STORE });
    }
    return Response.json({ deleted: true }, { headers: JSON_HEADERS });
  } catch {
    // Never report a deletion that may not have happened.
    return unavailable();
  }
}
