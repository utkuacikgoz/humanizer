// D-006 / M2-07: turns the usage ledger into an actually-enforced allowance
// on the generation path.
//
// The 50,000-word Starter cap is stated at the point of sale
// (src/lib/subscription-disclosure.ts). Until this existed it was advertised
// and enforced nowhere — the ledger was correct but nothing called it, which
// is the gap D-015 recorded.
//
// Who is metered: a signed-in customer with an active entitlement. Anonymous
// previews are the top of the funnel and are governed by the per-client
// PreviewRequestGuard instead, not by a subscription allowance nobody bought.
// A signed-in visitor without a subscription is treated the same as anonymous
// here — there is no allowance to draw down.
//
// Everything that touches D1 or `cloudflare:workers` is lazily imported, so a
// plain-Node test can import a route that calls this without the Workers
// runtime resolving (the pattern in app/api/checkout/route.ts).
import { pricingConfig } from "@/src/config/pricing";
import { resolveChatGPTUserFromHeaders } from "@/src/lib/chatgpt-identity";

export type QuotaDecision =
  /** No subscription allowance applies to this caller. */
  | { metered: false }
  /** Capacity is held; the caller MUST settle it exactly once. */
  | { metered: true; admitted: true; settle: (successfulWords: number) => Promise<void> }
  /** Over the allowance — a hard stop. */
  | { metered: true; admitted: false; allowance: number; remaining: number; periodEnd: Date };

function planAllowance(planId: string): number | null {
  const plan = (pricingConfig.plans as Record<string, { wordLimit?: number } | undefined>)[planId];
  return typeof plan?.wordLimit === "number" ? plan.wordLimit : null;
}

/**
 * Reserves `words` against the caller's remaining allowance.
 *
 * On success the caller must call `settle(successfulWords)` — with 0 if the
 * attempt failed — so held capacity is released. Failing to settle leaks the
 * reservation until the period rolls over, so settle from a `finally`.
 *
 * Fails OPEN, deliberately. If identity, the database, or the entitlement
 * lookup is unavailable, this returns `{ metered: false }` and the rewrite
 * proceeds. Quota is a billing control, not a security boundary: a customer
 * who paid should not lose a rewrite because a metering read failed, and the
 * ledger's own admission check remains the thing that cannot be raced.
 */
export async function reserveQuota(request: Request, words: number): Promise<QuotaDecision> {
  const user = resolveChatGPTUserFromHeaders(request);
  if (!user || words <= 0) return { metered: false };

  try {
    const [{ getDb }, billing, ledger] = await Promise.all([
      import("../../db/index"),
      import("../../db/billing-repository"),
      import("../../db/usage-ledger"),
    ]);
    const db = getDb();

    const userId = await billing.findUserIdByExternalSubject(db, user.userId);
    if (!userId) return { metered: false };

    const entitlement = await billing.getActiveEntitlement(db, userId);
    if (!entitlement) return { metered: false };

    const allowance = planAllowance(entitlement.planId);
    if (allowance === null) return { metered: false };

    const operationKey = `humanize:${crypto.randomUUID()}`;
    const reservation = await ledger.reserveUsage(db, {
      userId,
      operationKey,
      words,
      periodStart: entitlement.currentPeriodStart,
      allowance,
    });

    if (!reservation.admitted) {
      return {
        metered: true,
        admitted: false,
        allowance: reservation.allowance,
        remaining: reservation.remaining,
        periodEnd: entitlement.currentPeriodEnd,
      };
    }

    return {
      metered: true,
      admitted: true,
      settle: async (successfulWords: number) => {
        try {
          if (successfulWords > 0) await ledger.commitUsage(db, { operationKey, successfulWords });
          else await ledger.releaseUsage(db, operationKey);
        } catch {
          // Never let settlement failure surface as a failed rewrite. The
          // reservation expires with the billing period at worst.
        }
      },
    };
  } catch {
    return { metered: false };
  }
}

/** The words a submission will draw down — counted before the attempt runs. */
export function billableWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
