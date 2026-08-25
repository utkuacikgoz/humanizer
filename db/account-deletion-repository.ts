// M3-05 self-service account deletion.
//
// Same driver-agnostic shape as db/history-repository.ts: only
// `drizzle-orm/sqlite-core`'s generic BaseSQLiteDatabase is reachable from
// here, so tests/account-deletion.test.mts drives these exact functions
// against real SQLite under plain Node.
//
// The authorization invariant is the one M3-01 already keeps: `userId` is
// always the server-derived owner id resolved from the trusted identity
// headers. Nothing a client sends selects whose account is deleted — the only
// input this module accepts is that id.
import { and, eq, isNull, sql } from "drizzle-orm";
import * as schema from "./schema";
import type { SubscriptionStatus } from "./schema";
import type { AppDatabase } from "./repository";
import { recordDeletionAudit } from "./deletion-audit";

const { deletionJobs, jobPayloads, protectedItems, resultRevisions, subscriptions, users } = schema;

/**
 * D1's real write result carries rows-affected at `meta.changes`; the
 * sqlite-proxy test harness mirrors that shape deliberately. Re-reading a row
 * cannot distinguish "my write applied" from "someone else wrote the same
 * value", which is what makes this the only sound way to decide a race.
 */
function rowsChanged(result: unknown): number {
  const changes = (result as { meta?: { changes?: number } } | undefined)?.meta?.changes;
  return typeof changes === "number" ? changes : 0;
}

export interface BillingBlock {
  planId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
}

/**
 * D-018: an account with a subscription that would keep billing cannot be
 * deleted until that subscription is cancelled.
 *
 * The alternative — cancel the subscription as a side effect of deletion — was
 * rejected. Cancelling immediately destroys paid time the customer already
 * bought, with no refund path in this codebase; cancelling at period end
 * leaves an "already deleted" account still being charged, which is the exact
 * harm this rule exists to prevent; and either variant means a Stripe call in
 * the middle of an irreversible local erasure, where a network failure leaves
 * the two systems disagreeing about whether the customer is still a customer.
 * Refusing is the only option whose failure mode is "nothing happened".
 *
 * It is deliberately the narrowest refusal that works: it fires only while a
 * subscription can still produce a charge. A subscription already set to
 * cancel at period end will not bill again, so it does not block deletion even
 * though it still confers access; neither does `canceled`, `past_due`,
 * `unpaid`, `paused`, or no subscription at all. Cancellation itself is one
 * click away in the Stripe Billing Portal (src/components/manage-billing.tsx),
 * and the interface says all of this before the customer confirms — an
 * unexplained refusal would be the obstructed-cancellation dark pattern
 * docs/MONETIZATION.md forbids.
 */
export async function findBillingBlockOnDeletion(db: AppDatabase, userId: string): Promise<BillingBlock | null> {
  if (!userId) return null;
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  const blocking = rows.find((row) => (row.status === "active" || row.status === "trialing") && !row.cancelAtPeriodEnd);
  if (!blocking) return null;
  return { planId: blocking.planId, status: blocking.status, currentPeriodEnd: blocking.currentPeriodEnd };
}

export type AccountDeletionOutcome = "deleted" | "already-deleted" | "blocked-by-subscription";

export interface AccountDeletionResult {
  outcome: AccountDeletionOutcome;
  /** Owned payloads voided by this call. A count, never anything about their content. */
  payloadsVoided: number;
  deletionJobId: string | null;
}

/**
 * Irreversible account deletion.
 *
 * Order matters. The text is voided first, because voiding is idempotent and
 * safe to repeat, and a crash halfway through must never leave writing behind
 * with the account already marked deleted. The account tombstone is written
 * second, as a guarded UPDATE decided on rows-affected, so exactly one caller
 * out of any number of concurrent requests enqueues propagation and stamps the
 * audit trail.
 *
 * What is destroyed: every owned job's source, result, preview projection and
 * protected-item references; any stored result revision reference; the
 * contact email; and the external identity subject, which is replaced with a
 * one-way tombstone value. That last part is what makes deletion stick — the
 * subject is the only key a returning sign-in could match, so replacing it
 * means the same person signing in afterwards starts a genuinely new, empty
 * account instead of silently resurrecting the deleted one.
 *
 * What is kept: `humanization_jobs` metadata rows (word counts and hashed
 * fingerprints, no writing, and the foreign-key target for the usage ledger),
 * the usage entries themselves, and the subscription/Stripe references that
 * tax and accounting law require us to retain — which /privacy already states.
 * None of it can resurrect any writing: the payload rows it points at have
 * been voided, and the retained columns never held text in the first place.
 */
export async function deleteAccountForUser(
  db: AppDatabase,
  input: { userId: string },
  now = new Date(),
): Promise<AccountDeletionResult> {
  const empty: AccountDeletionResult = { outcome: "already-deleted", payloadsVoided: 0, deletionJobId: null };
  if (!input.userId) return empty;

  const [account] = await db.select({ id: users.id, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!account || account.deletedAt) return empty;

  const block = await findBillingBlockOnDeletion(db, input.userId);
  if (block) return { outcome: "blocked-by-subscription", payloadsVoided: 0, deletionJobId: null };

  const ownedJobIds = sql`(select ${schema.humanizationJobs.id} from ${schema.humanizationJobs} where ${schema.humanizationJobs.ownerUserId} = ${input.userId})`;

  const voided = await db.update(jobPayloads)
    .set({ sourceRef: "", resultRef: null, previewProjection: null, purgedAt: now })
    .where(and(isNull(jobPayloads.purgedAt), sql`${jobPayloads.jobId} in ${ownedJobIds}`));
  const payloadsVoided = rowsChanged(voided);

  await db.update(protectedItems)
    .set({ valueRef: null, purgedAt: now })
    .where(and(isNull(protectedItems.purgedAt), sql`${protectedItems.jobId} in ${ownedJobIds}`));

  // `result_revisions.result_ref` is NOT NULL, so it is emptied rather than
  // nulled — the same "keep the row, drop the reference" tombstone the payload
  // purge writes. Nothing writes this table yet; voiding it now means adding a
  // writer later cannot silently reintroduce text that survives deletion.
  await db.update(resultRevisions)
    .set({ resultRef: "" })
    .where(sql`${resultRevisions.jobId} in ${ownedJobIds}`);

  const tombstoned = await db.update(users)
    .set({ deletedAt: now, contactEmail: null, externalSubject: `deleted:${crypto.randomUUID()}` })
    .where(and(eq(users.id, input.userId), isNull(users.deletedAt)));
  // Lost the race to a concurrent deletion of the same account. The erasure
  // above still applied and was idempotent; the winner owns the audit trail.
  if (rowsChanged(tombstoned) !== 1) return empty;

  const deletionJobId = crypto.randomUUID();
  await db.insert(deletionJobs).values({
    id: deletionJobId,
    subjectType: "user",
    subjectId: input.userId,
    scope: "full_account",
    requestedByUserId: input.userId,
    requestedAt: now,
    status: "pending",
    processorStatus: "{}",
    attempts: 0,
  });

  await recordDeletionAudit(db, {
    deletionJobId,
    subjectType: "user",
    subjectId: input.userId,
    scope: "full_account",
    actorUserId: input.userId,
    event: "requested",
    detail: { payloadsVoided },
  }, now);

  return { outcome: "deleted", payloadsVoided, deletionJobId };
}

/** True once the account has been tombstoned. Used only to answer idempotently. */
export async function isAccountDeleted(db: AppDatabase, userId: string): Promise<boolean> {
  if (!userId) return true;
  const [row] = await db.select({ deletedAt: users.deletedAt }).from(users).where(eq(users.id, userId)).limit(1);
  return !row || row.deletedAt !== null;
}
