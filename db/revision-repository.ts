// M3-03 sentence operations: the revision chain for one owned rewrite, and
// the attempt/idempotency/debit record for each sentence operation applied to
// it.
//
// Driver-agnostic in the same way as db/history-repository.ts — only
// `drizzle-orm/sqlite-core`'s generic BaseSQLiteDatabase is imported — so
// tests/sentence-operations.test.mts drives these exact functions against
// real SQLite under plain Node.
//
// Two invariants shape every write below:
//
//   1. **No read-then-write decides anything.** The revision sequence is
//      computed inside the INSERT (`MAX(sequence) + 1` as a subquery), the
//      seed revision's "only if this job has none" test lives in the INSERT's
//      WHERE, and the attempt claim and its settlement are both decided on
//      D1's `meta.changes`. A re-read cannot distinguish "I won" from
//      "someone wrote an identical value".
//   2. **Ownership is never inferred here.** Every function takes an already
//      server-derived owner id; src/lib/sentence-operations.ts establishes it
//      with the same getUnlockedResult check /api/result uses, before any of
//      this runs.
import { and, desc, eq, ne, sql } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDatabase } from "./repository";
import type { SentenceOperationKind, SentenceOperationOutcome } from "./schema";

const { resultRevisions, sentenceOperations } = schema;

/** Mirrors D1Result.meta.changes; see db/history-repository.ts's copy. */
function rowsChanged(result: unknown): number {
  const changes = (result as { meta?: { changes?: number } } | undefined)?.meta?.changes;
  return typeof changes === "number" ? changes : 0;
}

export interface RevisionHead {
  revisionId: string;
  sequence: number;
  /** The complete current rewrite text this revision represents. */
  text: string;
}

/**
 * The job's current text, or null when the chain has not been seeded yet.
 *
 * `sequence` is a per-job unique integer assigned by the database, so the
 * newest revision is `MAX(sequence)` — not the newest `created_at`, which two
 * writes in the same millisecond can tie and which would then make "current"
 * ambiguous.
 */
export async function getRevisionHead(db: AppDatabase, jobId: string): Promise<RevisionHead | null> {
  if (!jobId) return null;
  const [row] = await db
    .select({ revisionId: resultRevisions.id, sequence: resultRevisions.sequence, text: resultRevisions.resultRef })
    .from(resultRevisions)
    .where(eq(resultRevisions.jobId, jobId))
    .orderBy(desc(resultRevisions.sequence))
    .limit(1);
  return row ?? null;
}

async function insertRevision(
  db: AppDatabase,
  input: {
    jobId: string;
    parentRevisionId: string | null;
    revisionType: "original" | "sentence_regeneration" | "manual_edit" | "restore";
    text: string;
    successfulWordCount: number;
    sentenceIndex: number | null;
    /** When set, the row is written only if the job has no revisions at all. */
    onlyIfFirst?: boolean;
  },
): Promise<string | null> {
  const revisionId = crypto.randomUUID();
  const guard = input.onlyIfFirst
    ? sql`where not exists (select 1 from result_revisions where job_id = ${input.jobId})`
    : sql``;

  const result = await db.run(sql`
    insert into result_revisions
      (id, job_id, parent_revision_id, revision_type, sequence, sentence_index,
       result_ref, successful_word_count, created_at)
    select
      ${revisionId}, ${input.jobId}, ${input.parentRevisionId}, ${input.revisionType},
      (select coalesce(max(sequence), 0) + 1 from result_revisions where job_id = ${input.jobId}),
      ${input.sentenceIndex}, ${input.text}, ${input.successfulWordCount}, ${Date.now()}
    ${guard}
  `);

  return rowsChanged(result) === 1 ? revisionId : null;
}

/**
 * Returns the job's current revision, seeding the chain from the stored
 * rewrite the first time a sentence operation touches this job.
 *
 * The seed row is the `original` revision: the rewrite exactly as the
 * pipeline produced it, kept as an immutable audit record so that appending
 * an edited version later never overwrites what was originally delivered.
 * Seeding is a guarded insert rather than an "if empty then write", so two
 * concurrent first operations cannot both seed.
 */
export async function ensureRevisionHead(
  db: AppDatabase,
  input: { jobId: string; currentText: string; wordCount: number },
): Promise<RevisionHead | null> {
  const existing = await getRevisionHead(db, input.jobId);
  if (existing) return existing;

  await insertRevision(db, {
    jobId: input.jobId,
    parentRevisionId: null,
    revisionType: "original",
    text: input.currentText,
    successfulWordCount: input.wordCount,
    sentenceIndex: null,
    onlyIfFirst: true,
  });

  // Re-read rather than trusting the insert's return: if the guard refused
  // because a concurrent operation seeded first, that other row is the head.
  return getRevisionHead(db, input.jobId);
}

/**
 * Appends a derived revision and makes it the text every read path serves.
 *
 * Both writes matter and neither replaces the other: the revision row is the
 * audit trail M3-02's "no mutation without an explicit derived revision"
 * requires, and `job_payloads.result_ref` is what /api/result and
 * /api/history/{id} actually return, so a customer who refreshes sees the
 * sentence they just changed. `source_ref` — their original submitted text —
 * is never touched by any of this.
 */
export async function appendRevision(
  db: AppDatabase,
  input: {
    jobId: string;
    parentRevisionId: string;
    revisionType: "sentence_regeneration" | "manual_edit" | "restore";
    text: string;
    successfulWordCount: number;
    sentenceIndex: number;
  },
): Promise<string | null> {
  const revisionId = await insertRevision(db, { ...input, onlyIfFirst: false });
  if (!revisionId) return null;

  await db.run(sql`
    update job_payloads
    set result_ref = ${input.text}
    where job_id = ${input.jobId} and purged_at is null
  `);

  return revisionId;
}

/**
 * The text one revision holds, or null when it does not exist. An empty
 * string is a real answer: it is what a purge leaves behind, and the caller
 * must treat it as "this text is gone", never as "no revision".
 */
export async function findRevisionText(db: AppDatabase, revisionId: string): Promise<string | null> {
  if (!revisionId) return null;
  const [row] = await db
    .select({ text: resultRevisions.resultRef })
    .from(resultRevisions)
    .where(eq(resultRevisions.id, revisionId))
    .limit(1);
  return row?.text ?? null;
}

export interface SentenceOperationRecord {
  operationKey: string;
  jobId: string;
  sentenceIndex: number;
  kind: SentenceOperationKind;
  outcome: SentenceOperationOutcome;
  chargedWords: number;
  revisionId: string | null;
}

export async function findSentenceOperation(
  db: AppDatabase,
  operationKey: string,
): Promise<SentenceOperationRecord | null> {
  if (!operationKey) return null;
  const [row] = await db
    .select({
      operationKey: sentenceOperations.operationKey,
      jobId: sentenceOperations.jobId,
      sentenceIndex: sentenceOperations.sentenceIndex,
      kind: sentenceOperations.kind,
      outcome: sentenceOperations.outcome,
      chargedWords: sentenceOperations.chargedWords,
      revisionId: sentenceOperations.revisionId,
    })
    .from(sentenceOperations)
    .where(eq(sentenceOperations.operationKey, operationKey))
    .limit(1);
  return row ?? null;
}

/**
 * Claims one attempt. False means this operation key already exists, i.e.
 * this is a retry: the caller must read the first attempt's record and return
 * its outcome rather than generating a second candidate.
 *
 * The claim is written *before* anything is generated, on purpose. It is what
 * makes the caps in src/lib/sentence-operations.ts bound generation instead of
 * only bounding successes — a candidate that fails verification still leaves
 * its row, so a caller cannot spin the engine for free by asking for
 * regenerations that never pass.
 */
export async function claimSentenceOperation(
  db: AppDatabase,
  input: {
    jobId: string;
    ownerUserId: string;
    operationKey: string;
    sentenceIndex: number;
    kind: SentenceOperationKind;
  },
  now = new Date(),
): Promise<boolean> {
  const result = await db.run(sql`
    insert or ignore into sentence_operations
      (id, job_id, owner_user_id, operation_key, sentence_index, kind, outcome,
       charged_words, revision_id, created_at, updated_at)
    values (
      ${crypto.randomUUID()}, ${input.jobId}, ${input.ownerUserId}, ${input.operationKey},
      ${input.sentenceIndex}, ${input.kind}, 'pending', 0, null, ${now.getTime()}, ${now.getTime()}
    )
  `);
  return rowsChanged(result) === 1;
}

/**
 * Records what the claimed attempt actually did. Guarded on `outcome =
 * 'pending'`, so a settled operation can never be rewritten into a different
 * answer — which is the other half of the idempotency guarantee: the retry
 * reads a record that cannot have moved under it.
 */
export async function settleSentenceOperation(
  db: AppDatabase,
  input: {
    operationKey: string;
    outcome: Exclude<SentenceOperationOutcome, "pending">;
    chargedWords: number;
    revisionId: string | null;
  },
  now = new Date(),
): Promise<boolean> {
  const result = await db.run(sql`
    update sentence_operations
    set outcome = ${input.outcome},
        charged_words = ${input.chargedWords},
        revision_id = ${input.revisionId},
        updated_at = ${now.getTime()}
    where operation_key = ${input.operationKey} and outcome = 'pending'
  `);
  return rowsChanged(result) === 1;
}

/**
 * Regeneration attempts recorded for this job, optionally for one sentence.
 *
 * Counts attempts of kind `regenerate` whatever their outcome. Restores are
 * excluded because they generate nothing: a restore can only ever produce
 * text the customer already submitted, so bounding them would limit undo
 * without limiting cost.
 */
export async function countSentenceRegenerations(
  db: AppDatabase,
  input: { jobId: string; sentenceIndex?: number },
): Promise<number> {
  const scope = input.sentenceIndex === undefined
    ? eq(sentenceOperations.jobId, input.jobId)
    : and(eq(sentenceOperations.jobId, input.jobId), eq(sentenceOperations.sentenceIndex, input.sentenceIndex));

  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sentenceOperations)
    .where(and(scope, eq(sentenceOperations.kind, "regenerate")));
  return Number(row?.count ?? 0);
}

/**
 * Voids the text held in this job's revision chain.
 *
 * Called inline by db/history-repository.ts's delete so a revision cannot
 * outlive the payload it was derived from — src/lib/purge-worker.ts runs the
 * identical statement when it propagates the same deletion, and both are
 * guarded on `result_ref <> ''` so repeating either changes nothing.
 * `sentence_operations` needs no such pass: it holds an index, an outcome code
 * and two counts, and never any customer writing.
 */
export async function voidRevisionsForJob(db: AppDatabase, jobId: string): Promise<number> {
  const result = await db
    .update(resultRevisions)
    .set({ resultRef: "" })
    .where(and(eq(resultRevisions.jobId, jobId), ne(resultRevisions.resultRef, "")));
  return rowsChanged(result);
}
