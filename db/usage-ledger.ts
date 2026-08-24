// M2-07: append-only usage ledger with concurrency-safe admission control.
//
// D-006 requires that a plan's word allowance is actually enforced, and
// D-013 deferred this until it could be made provably safe — a
// `reserveUsage()` that races under concurrent requests looks like the
// control D-006 demands without being one, which is worse than shipping
// nothing. Two real races were found in this repository's claim transaction
// before it was correct, both from the same mistake: deciding admission by
// reading, then writing.
//
// So admission here is ONE statement. The guarded `INSERT ... SELECT ...
// WHERE` re-evaluates the balance inside the same write that records the
// reservation, and SQLite/D1 serializes writes, so two concurrent callers
// cannot both observe room for the last word. Success is decided by
// rows-affected, never by re-reading and comparing — a re-read cannot
// distinguish "I won" from "someone else wrote an identical value".
//
// Ledger shape (db/schema.ts): every row is an immutable event.
//   reservation  holds capacity while an attempt runs
//   release      returns capacity an attempt did not use
//   commit       records the words that actually succeeded
//   adjustment   manual correction, out of band
//
// Consumed balance is SUM(reservation) - SUM(release) - SUM(adjustment
// credits). Committing a partial success releases the difference, so a
// customer is only ever charged for words that actually came back — the
// "never charge quota for failed attempts or internal retries" guardrail in
// README.md is enforced by construction rather than by remembering to.
import { and, eq, gt, sql } from "drizzle-orm";
import type { AppDatabase } from "./repository";
import * as schema from "./schema";

const { usageEntries } = schema;

/** Mirrors D1Result.meta.changes; see db/billing-repository.ts's copy. */
function rowsChanged(result: unknown): number {
  const changes = (result as { meta?: { changes?: number } } | undefined)?.meta?.changes;
  return typeof changes === "number" ? changes : 0;
}

export interface ReserveInput {
  userId: string;
  /** Stable per attempt. Replaying it is a no-op, not a second charge. */
  operationKey: string;
  words: number;
  periodStart: Date;
  allowance: number;
  subscriptionId?: string | null;
  jobId?: string | null;
}

export type ReserveResult =
  | { admitted: true; replayed: boolean }
  | { admitted: false; consumed: number; allowance: number; remaining: number };

/**
 * Reserves `words` against the user's allowance for the period, or refuses.
 *
 * Concurrency-safe by construction: the balance check lives in the WHERE of
 * the insert, so it is evaluated under the same write lock that commits the
 * row. Callers must treat `admitted: false` as a hard stop.
 */
export async function reserveUsage(db: AppDatabase, input: ReserveInput): Promise<ReserveResult> {
  if (!Number.isInteger(input.words) || input.words <= 0) {
    throw new Error("reserveUsage requires a positive whole number of words.");
  }

  const id = crypto.randomUUID();
  const periodStart = input.periodStart.getTime();

  const result = await db.run(sql`
    insert into usage_entries
      (id, user_id, subscription_id, period_start, operation_key, entry_type,
       attempted_words, successful_words, job_id, created_at)
    select
      ${id}, ${input.userId}, ${input.subscriptionId ?? null}, ${periodStart},
      ${input.operationKey}, 'reservation', ${input.words}, 0, ${input.jobId ?? null},
      ${Date.now()}
    where (
      select coalesce(sum(
        case entry_type
          when 'reservation' then attempted_words
          when 'release' then -attempted_words
          when 'adjustment' then -attempted_words
          else 0
        end
      ), 0)
      from usage_entries
      where user_id = ${input.userId} and period_start = ${periodStart}
    ) + ${input.words} <= ${input.allowance}
    and not exists (
      select 1 from usage_entries
      where operation_key = ${input.operationKey} and entry_type = 'reservation'
    )
  `);

  if (rowsChanged(result) === 1) return { admitted: true, replayed: false };

  // Either the allowance is exhausted or this exact attempt already holds a
  // reservation. Distinguishing them is a read, but only after the write has
  // already decided — no admission depends on what we find here.
  const [existing] = await db
    .select()
    .from(usageEntries)
    .where(and(eq(usageEntries.operationKey, input.operationKey), eq(usageEntries.entryType, "reservation")))
    .limit(1);
  if (existing) return { admitted: true, replayed: true };

  const consumed = await getConsumedWords(db, input.userId, input.periodStart);
  return { admitted: false, consumed, allowance: input.allowance, remaining: Math.max(0, input.allowance - consumed) };
}

/**
 * Records how many words actually succeeded and returns the rest.
 *
 * A failed or partially-failed attempt must never leave capacity held: the
 * difference between what was reserved and what succeeded is released here.
 */
export async function commitUsage(
  db: AppDatabase,
  input: { operationKey: string; successfulWords: number },
): Promise<void> {
  const [reservation] = await db
    .select()
    .from(usageEntries)
    .where(and(eq(usageEntries.operationKey, input.operationKey), eq(usageEntries.entryType, "reservation")))
    .limit(1);
  if (!reservation) throw new Error(`No reservation to commit for operation ${input.operationKey}.`);

  const successful = Math.max(0, Math.min(input.successfulWords, reservation.attemptedWords));
  const unused = reservation.attemptedWords - successful;

  // Both inserts are guarded by the (operation_key, entry_type) unique index,
  // so a retried commit is a no-op rather than a double release.
  await insertOnce(db, reservation, "commit", { attemptedWords: reservation.attemptedWords, successfulWords: successful });
  if (unused > 0) {
    await insertOnce(db, reservation, "release", { attemptedWords: unused, successfulWords: 0 });
  }
}

/** Returns the whole reservation — the attempt produced nothing billable. */
export async function releaseUsage(db: AppDatabase, operationKey: string): Promise<void> {
  const [reservation] = await db
    .select()
    .from(usageEntries)
    .where(and(eq(usageEntries.operationKey, operationKey), eq(usageEntries.entryType, "reservation")))
    .limit(1);
  if (!reservation) return;
  await insertOnce(db, reservation, "release", { attemptedWords: reservation.attemptedWords, successfulWords: 0 });
}

async function insertOnce(
  db: AppDatabase,
  reservation: typeof usageEntries.$inferSelect,
  entryType: "commit" | "release",
  words: { attemptedWords: number; successfulWords: number },
): Promise<void> {
  await db.run(sql`
    insert or ignore into usage_entries
      (id, user_id, subscription_id, period_start, operation_key, entry_type,
       attempted_words, successful_words, job_id, created_at)
    values (
      ${crypto.randomUUID()}, ${reservation.userId}, ${reservation.subscriptionId}, ${reservation.periodStart.getTime()},
      ${reservation.operationKey}, ${entryType}, ${words.attemptedWords}, ${words.successfulWords},
      ${reservation.jobId}, ${Date.now()}
    )
  `);
}

/** Words currently counted against the allowance for this period. */
export async function getConsumedWords(db: AppDatabase, userId: string, periodStart: Date): Promise<number> {
  const [row] = await db
    .select({
      consumed: sql<number>`coalesce(sum(
        case ${usageEntries.entryType}
          when 'reservation' then ${usageEntries.attemptedWords}
          when 'release' then -${usageEntries.attemptedWords}
          when 'adjustment' then -${usageEntries.attemptedWords}
          else 0
        end
      ), 0)`,
    })
    .from(usageEntries)
    .where(and(eq(usageEntries.userId, userId), eq(usageEntries.periodStart, periodStart)));
  return Number(row?.consumed ?? 0);
}

/** Durable paid-use ordinal across billing periods and browser sessions. */
export async function getSuccessfulPaidUseCount(db: AppDatabase, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(usageEntries)
    .where(and(
      eq(usageEntries.userId, userId),
      eq(usageEntries.entryType, "commit"),
      gt(usageEntries.successfulWords, 0),
    ));
  return Number(row?.count ?? 0);
}
