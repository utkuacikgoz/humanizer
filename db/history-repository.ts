// M3-01 authorized history: list, detail metadata, and soft-delete for the
// jobs one authenticated user owns.
//
// Same driver-agnostic shape as db/repository.ts and db/billing-repository.ts:
// only `drizzle-orm/sqlite-core`'s generic BaseSQLiteDatabase is imported, so
// tests/history-access.test.mts drives these exact functions against real
// SQLite under plain Node.
//
// The single authorization invariant every function here keeps: `userId` is
// always the server-derived owner id resolved from trusted identity headers,
// and it is always part of the WHERE clause. No caller-supplied filter, id
// list, or ordering reaches a query — the only client input accepted anywhere
// below is one job id, and it is re-checked against `owner_user_id` before it
// selects anything.
import { and, desc, eq, isNull } from "drizzle-orm";
import * as schema from "./schema";
import type { JobState, WritingModeValue } from "./schema";
import type { AppDatabase, PreviewProjection } from "./repository";
import { recordDeletionAudit } from "./deletion-audit";
import { voidRevisionsForJob } from "./revision-repository";

const { deletionJobs, humanizationJobs, jobPayloads, protectedItems } = schema;

/** Bounded so a large account cannot turn one list request into an unbounded D1 scan. */
export const HISTORY_PAGE_SIZE = 50;

/**
 * Metadata only. Deliberately has no `result` field of any kind: the full
 * rewrite lives in job_payloads.resultRef and is released only by
 * db/billing-repository.ts's getUnlockedResult, under an entitlement check
 * this list never performs. The projection fields below are the same ones an
 * anonymous visitor is already shown before paying (docs/ARCHITECTURE.md's
 * "approved for display" preview projection), so surfacing them to the owner
 * crosses no boundary D-004 protects.
 */
export interface HistoryEntry {
  jobId: string;
  mode: WritingModeValue;
  state: JobState;
  createdAt: string;
  inputWordCount: number;
  successfulWordCount: number | null;
  preview: string;
  hiddenWordCount: number;
  issuesImproved: number;
  naturalness: "Strong" | "Good";
  meaningPreservation: "High" | "Review needed";
  protectedItems: string[];
}

function readProjection(raw: string | null): PreviewProjection | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PreviewProjection;
  } catch {
    // A malformed projection is a corrupt row, not content to guess at.
    return null;
  }
}

const HISTORY_COLUMNS = {
  jobId: humanizationJobs.id,
  mode: humanizationJobs.mode,
  state: humanizationJobs.state,
  createdAt: humanizationJobs.createdAt,
  inputWordCount: humanizationJobs.inputWordCount,
  successfulWordCount: humanizationJobs.successfulWordCount,
  previewProjection: jobPayloads.previewProjection,
} as const;

type HistoryRow = {
  jobId: string;
  mode: WritingModeValue;
  state: JobState;
  createdAt: Date;
  inputWordCount: number;
  successfulWordCount: number | null;
  previewProjection: string | null;
};

function toEntry(row: HistoryRow): HistoryEntry | null {
  const projection = readProjection(row.previewProjection);
  if (!projection) return null;
  return {
    jobId: row.jobId,
    mode: row.mode,
    state: row.state,
    createdAt: row.createdAt.toISOString(),
    inputWordCount: row.inputWordCount,
    successfulWordCount: row.successfulWordCount,
    preview: projection.preview,
    hiddenWordCount: projection.hiddenWordCount,
    issuesImproved: projection.issuesImproved,
    naturalness: projection.naturalness,
    meaningPreservation: projection.meaningPreservation,
    protectedItems: projection.protectedItems,
  };
}

/**
 * Every row this returns is owned by `userId`. A job whose `owner_user_id`
 * is NULL (still anonymous) never matches `eq(...)` in SQL, so unclaimed work
 * is unreachable here by construction rather than by a filter that could be
 * dropped. A soft-deleted item is excluded by the same `purged_at IS NULL`
 * predicate the payload purge writes, so deletion takes effect on this path
 * without a second "is it deleted" flag to keep in sync.
 */
export async function listHistoryForUser(db: AppDatabase, userId: string): Promise<HistoryEntry[]> {
  if (!userId) return [];

  const rows = await db
    .select(HISTORY_COLUMNS)
    .from(humanizationJobs)
    .innerJoin(jobPayloads, eq(jobPayloads.jobId, humanizationJobs.id))
    .where(and(eq(humanizationJobs.ownerUserId, userId), isNull(jobPayloads.purgedAt)))
    .orderBy(desc(humanizationJobs.createdAt))
    .limit(HISTORY_PAGE_SIZE);

  return rows.map(toEntry).filter((entry): entry is HistoryEntry => entry !== null);
}

/**
 * One owned, not-yet-deleted entry, or null. Carries the same ownership and
 * `purged_at IS NULL` predicates as the list — not a filter over the list's
 * bounded page, which would make an older job unreachable by id.
 */
export async function findHistoryEntryForUser(
  db: AppDatabase,
  input: { userId: string; jobId: string },
): Promise<HistoryEntry | null> {
  if (!input.userId || !input.jobId) return null;

  const [row] = await db
    .select(HISTORY_COLUMNS)
    .from(humanizationJobs)
    .innerJoin(jobPayloads, eq(jobPayloads.jobId, humanizationJobs.id))
    .where(and(
      eq(humanizationJobs.id, input.jobId),
      eq(humanizationJobs.ownerUserId, input.userId),
      isNull(jobPayloads.purgedAt),
    ))
    .limit(1);

  return row ? toEntry(row) : null;
}

export type HistoryDeletionOutcome = "deleted" | "already-deleted" | "not-found";

/**
 * Soft-delete (M3-01) that is also the first half of the purge workflow
 * M3-05 completes.
 *
 * "Inaccessible" here means the text is gone, not hidden: the payload refs
 * are voided in the same statement that stamps `purged_at`, which is exactly
 * what db/repository.ts's anonymous retention sweep does, and what
 * getUnlockedResult already treats as "not found". Leaving the row readable
 * while the UI claimed it was deleted is the "Deletion failure — UI says
 * deleted while payload remains" threat in docs/SECURITY.md.
 *
 * Idempotent by construction. The guarded UPDATE's `purged_at IS NULL`
 * predicate is decided on D1's `meta.changes` rather than by re-reading the
 * row, so a second delete cannot double-enqueue a deletion job and two
 * concurrent deletes cannot both claim to have won. Repeating a delete
 * returns success, never an error and never a different shape.
 *
 * Not gated on an active entitlement: a customer whose subscription lapsed
 * must still be able to erase their own writing. Ownership alone is the
 * correct authority for destroying your own data; entitlement is the
 * authority for *reading* it, and that check stays on the detail path.
 */
export async function deleteHistoryEntryForUser(
  db: AppDatabase,
  input: { userId: string; jobId: string },
  now = new Date(),
): Promise<HistoryDeletionOutcome> {
  if (!input.userId || !input.jobId) return "not-found";

  const [job] = await db
    .select({ id: humanizationJobs.id })
    .from(humanizationJobs)
    .where(and(eq(humanizationJobs.id, input.jobId), eq(humanizationJobs.ownerUserId, input.userId)))
    .limit(1);
  // Someone else's job, an unclaimed job, and a job that never existed all
  // land here identically — the caller cannot tell them apart.
  if (!job) return "not-found";

  const voided = await db
    .update(jobPayloads)
    .set({ sourceRef: "", resultRef: null, previewProjection: null, purgedAt: now })
    .where(and(eq(jobPayloads.jobId, job.id), isNull(jobPayloads.purgedAt)));

  if (rowsChanged(voided) !== 1) return "already-deleted";

  await db
    .update(protectedItems)
    .set({ valueRef: null, purgedAt: now })
    .where(and(eq(protectedItems.jobId, job.id), isNull(protectedItems.purgedAt)));

  // M3-03 added a second place a job's text can live: every sentence
  // operation appends a `result_revisions` row holding the full rewrite as it
  // read after that change. Voiding it here rather than only in the purge
  // worker keeps the promise this function already makes — that the text is
  // gone at the moment of deletion, not when a worker next runs.
  await voidRevisionsForJob(db, job.id);

  // The tombstone this write leaves is what M3-05's purge worker picks up to
  // propagate the deletion to every other store/processor. It records the
  // subject, the scope and the authority it was made under, never any of the
  // text that was removed.
  const deletionJobId = crypto.randomUUID();
  await db.insert(deletionJobs).values({
    id: deletionJobId,
    subjectType: "job",
    subjectId: job.id,
    scope: "history_item",
    requestedByUserId: input.userId,
    requestedAt: now,
    status: "pending",
    processorStatus: "{}",
    attempts: 0,
  });

  await recordDeletionAudit(db, {
    deletionJobId,
    subjectType: "job",
    subjectId: job.id,
    scope: "history_item",
    actorUserId: input.userId,
    event: "requested",
    detail: { payloadsVoided: 1 },
  }, now);

  return "deleted";
}

/**
 * D1's real write result carries rows-affected at `meta.changes`; the
 * sqlite-proxy test harness mirrors that shape deliberately. Re-reading the
 * row instead cannot distinguish "my write applied" from "someone else wrote
 * the same value" — a mistake this repository has already made twice.
 */
function rowsChanged(result: unknown): number {
  const changes = (result as { meta?: { changes?: number } } | undefined)?.meta?.changes;
  return typeof changes === "number" ? changes : 0;
}
