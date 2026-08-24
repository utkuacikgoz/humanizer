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
  const entitlement = await getActiveEntitlement(db, userId);
  if (!entitlement) return { kind: "not-entitled" };

  const plan = pricingConfig.plans[entitlement.planId as keyof typeof pricingConfig.plans];
  if (!plan || plan.availability !== "active") return { kind: "not-entitled" };
  const operationKey = `humanize:${userId}:${input.idempotencyKey}`;
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
