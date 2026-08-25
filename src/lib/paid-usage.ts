import { pricingConfig } from "@/src/config/pricing";
import type { AppDatabase } from "../../db/repository";
import { findUserIdByExternalSubject, getActiveEntitlement } from "../../db/billing-repository";
import { commitUsage, getConsumedWords, getSuccessfulPaidUseCount, releaseUsage, reserveUsage } from "../../db/usage-ledger";

export type PaidUsageReservation = {
  userId: string;
  operationKey: string;
  periodStart: Date;
  periodEnd: Date;
  allowance: number;
  subscriptionId: string;
};

export type PaidUsageAdmission =
  | { kind: "not-entitled" }
  | { kind: "quota-exceeded"; consumed: number; allowance: number; remaining: number; periodEnd: Date }
  | { kind: "reserved"; reservation: PaidUsageReservation };

export async function reservePaidUsage(
  db: AppDatabase,
  input: { externalSubject: string; idempotencyKey: string; words: number },
): Promise<PaidUsageAdmission> {
  const userId = await findUserIdByExternalSubject(db, input.externalSubject);
  if (!userId) return { kind: "not-entitled" };
  return reserveForUser(db, { userId, operationKey: `humanize:${userId}:${input.idempotencyKey}`, words: input.words });
}

/**
 * M3-03. One sentence operation's reservation.
 *
 * Same ledger, same admission rules, same replay semantics as a whole
 * rewrite's — only the operation key's namespace differs, so a sentence
 * operation and the rewrite it edits can never collide on a key while both
 * still draw from the one allowance the plan grants.
 *
 * Takes an already server-derived user id rather than an external subject:
 * the caller established this account's ownership of the job and its active
 * entitlement before getting here, and re-deriving the id from a subject
 * would add a second place identity is decided.
 */
export function reserveSentenceUsage(
  db: AppDatabase,
  input: { userId: string; operationKey: string; words: number },
): Promise<PaidUsageAdmission> {
  return reserveForUser(db, input);
}

async function reserveForUser(
  db: AppDatabase,
  input: { userId: string; operationKey: string; words: number },
): Promise<PaidUsageAdmission> {
  const { userId, operationKey } = input;
  const entitlement = await getActiveEntitlement(db, userId);
  if (!entitlement) return { kind: "not-entitled" };

  const plan = pricingConfig.plans[entitlement.planId as keyof typeof pricingConfig.plans];
  if (!plan || plan.availability !== "active") return { kind: "not-entitled" };
  const admission = await reserveUsage(db, {
    userId,
    subscriptionId: entitlement.subscriptionId,
    operationKey,
    words: input.words,
    periodStart: entitlement.currentPeriodStart,
    allowance: plan.wordLimit,
  });
  if (!admission.admitted) {
    return { kind: "quota-exceeded", ...admission, periodEnd: entitlement.currentPeriodEnd };
  }
  return {
    kind: "reserved",
    reservation: {
      userId,
      operationKey,
      periodStart: entitlement.currentPeriodStart,
      periodEnd: entitlement.currentPeriodEnd,
      allowance: plan.wordLimit,
      subscriptionId: entitlement.subscriptionId,
    },
  };
}

export async function commitPaidUsage(db: AppDatabase, reservation: PaidUsageReservation, successfulWords: number) {
  await commitUsage(db, { operationKey: reservation.operationKey, successfulWords });
  const consumed = await getConsumedWords(db, reservation.userId, reservation.periodStart);
  const paidUseCount = await getSuccessfulPaidUseCount(db, reservation.userId);
  return {
    consumed,
    allowance: reservation.allowance,
    remaining: Math.max(0, reservation.allowance - consumed),
    periodEnd: reservation.periodEnd.toISOString(),
    paidUseCount,
  };
}

export function releasePaidUsage(db: AppDatabase, reservation: PaidUsageReservation) {
  return releaseUsage(db, reservation.operationKey);
}

export type PaidUsageState = {
  consumed: number;
  allowance: number;
  remaining: number;
  periodEnd: string;
  paidUseCount: number;
};

/**
 * The account's allowance state right now, read straight from the ledger.
 *
 * M3-03 uses this instead of the numbers a reservation carries, so that the
 * response to a retried sentence operation — which holds no reservation of
 * its own, having generated nothing — is identical to the response the first
 * attempt returned. Null means there is no active entitlement to describe.
 */
export async function describePaidUsage(db: AppDatabase, userId: string): Promise<PaidUsageState | null> {
  const entitlement = await getActiveEntitlement(db, userId);
  if (!entitlement) return null;
  const plan = pricingConfig.plans[entitlement.planId as keyof typeof pricingConfig.plans];
  if (!plan) return null;

  const consumed = await getConsumedWords(db, userId, entitlement.currentPeriodStart);
  const paidUseCount = await getSuccessfulPaidUseCount(db, userId);
  return {
    consumed,
    allowance: plan.wordLimit,
    remaining: Math.max(0, plan.wordLimit - consumed),
    periodEnd: entitlement.currentPeriodEnd.toISOString(),
    paidUseCount,
  };
}
