// Persistence for M1-09 ("Persist anonymous job and preview capability").
//
// This module is deliberately driver-agnostic: it depends only on
// `drizzle-orm/sqlite-core`'s generic `BaseSQLiteDatabase` type, not on
// `drizzle-orm/d1` or `cloudflare:workers`. That keeps it importable (and
// unit-testable against a plain SQLite file) from a normal Node test run —
// see tests/repository.test.mts — while `db/index.ts`'s `getDb()` is the
// only place that touches the real Cloudflare D1 binding.
//
// Persistence here is best-effort: callers (see app/api/humanize/route.ts)
// wrap these calls and continue serving the in-memory result if the D1
// binding is unavailable (e.g. under `npm test`, which runs the route
// handler directly under plain Node rather than through the Workers
// runtime). A crash mid-write leaves an orphaned job row rather than
// nothing; these are sequential inserts, not a D1 `batch()`/transaction.
// Revisit that before this path gates real money movement in M2.
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import * as schema from "./schema";
import type { JobState, WritingModeValue } from "./schema";

const { anonymousSessions, humanizationJobs, jobPayloads, protectedItems } = schema;

// The full schema generic must match what `getDb()` (db/index.ts) and the
// sqlite-proxy test harness both construct their drizzle instance with —
// `typeof schema` — so either one is structurally assignable here. Only
// the run-result generic (D1Result vs. SqliteRemoteResult) is erased.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AppDatabase = BaseSQLiteDatabase<"async", any, typeof schema>;

const DEFAULT_CAPABILITY_TTL_MS = 24 * 60 * 60 * 1000; // 24h, per D-P01's proposed default (pending ratification).
const CAPABILITY_TOKEN_BYTES = 32; // 256 bits of entropy.

/** Fields already derived and approved for display before payment. Never includes full result text. */
export interface PreviewProjection {
  preview: string;
  hiddenWordCount: number;
  issuesImproved: number;
  naturalness: "Strong" | "Good";
  meaningPreservation: "High" | "Review needed";
  protectedItems: string[];
}

export interface PersistProtectedItem {
  id: string;
  kind: string;
  normalizedValue: string;
  start: number;
  end: number;
}

export interface PersistJobInput {
  mode: WritingModeValue;
  /** Already-hashed request-guard client signal; never a raw IP/cookie. */
  clientFingerprint: string;
  idempotencyKey: string;
  /** Already-hashed fingerprint of the normalized text + mode. */
  contentFingerprint: string;
  inputWordCount: number;
  successfulWordCount: number;
  pipelineVersion: number;
  original: string;
  result: string;
  protectedContent: PersistProtectedItem[];
  previewProjection: PreviewProjection;
  capabilityTtlMs?: number;
  /**
   * Server-derived owner. Present only for a rewrite an entitled account
   * produced for itself (M3-02); never anything a client sent. Setting it
   * makes the owner the job's access principal, which is why no anonymous
   * capability is minted alongside it — see the invariant on
   * db/schema.ts's humanizationJobs.
   */
  ownerUserId?: string;
}

export interface PersistedJob {
  jobId: string;
  capabilityToken: string;
  capabilityExpiresAt: Date;
}

/**
 * What an owned write returns. There is deliberately no capability field to
 * read, so no caller can accidentally hand an anonymous capability to an
 * owned job's owner.
 */
export interface PersistedOwnedJob {
  jobId: string;
  /**
   * False when this owner already had a job row for this idempotency key, so
   * nothing was written and `jobId` names no row. A retried request lands
   * here instead of producing a second history entry.
   */
  recorded: boolean;
}

export interface RedeemedPreview {
  jobId: string;
  mode: WritingModeValue;
  state: JobState;
  /**
   * The original submitted text (job_payloads.sourceRef). Distinct from
   * job_payloads.resultRef (the full rewrite), which this function never
   * reads or returns: the user already holds their own original text, so
   * echoing it back crosses no confidentiality boundary D-004 protects.
   */
  original: string;
  projection: PreviewProjection;
  capabilityExpiresAt: Date;
}

async function randomCapabilityToken(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(CAPABILITY_TOKEN_BYTES));
  return base64UrlEncode(bytes);
}

async function digestCapabilityToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashValue(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * D1's real write result carries rows-affected at `meta.changes`; the
 * sqlite-proxy test harness mirrors that shape deliberately. See the copies
 * in db/usage-ledger.ts and db/history-repository.ts.
 */
function rowsChanged(result: unknown): number {
  const changes = (result as { meta?: { changes?: number } } | undefined)?.meta?.changes;
  return typeof changes === "number" ? changes : 0;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Persists a succeeded humanization job, its restricted payload, its
 * extracted protected-content hashes, and issues a fresh anonymous preview
 * capability tied to exactly that job. Only called for `succeeded` jobs —
 * D-007 means a failed/unverified candidate is never written here.
 */
/**
 * SEC-06 / D-011. Anonymous drafts are kept for a bounded window and then
 * removed — /privacy states 30 days, and nothing was enforcing it: every
 * job_payloads row had purged_at NULL with no purge writer anywhere.
 *
 * Deliberately opportunistic rather than a scheduled job: it runs on the
 * write path, needs no cron trigger or new infrastructure, and the bound is
 * small so it never turns one preview into an expensive request. A row that
 * survives a pass is simply collected on a later one.
 *
 * Only unclaimed anonymous work is eligible. A job with an owner has been
 * paid for and is out of scope here.
 */
export const ANONYMOUS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PURGE_BATCH = 25;

export async function purgeExpiredAnonymousPayloads(db: AppDatabase, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ANONYMOUS_RETENTION_MS);
  const stale = await db
    .select({ id: jobPayloads.id, jobId: jobPayloads.jobId })
    .from(jobPayloads)
    .innerJoin(humanizationJobs, eq(humanizationJobs.id, jobPayloads.jobId))
    .where(and(isNull(jobPayloads.purgedAt), isNull(humanizationJobs.ownerUserId), lt(jobPayloads.createdAt, cutoff)))
    .limit(PURGE_BATCH);

  let purged = 0;
  for (const row of stale) {
    // Drop the text, keep the row as a tombstone: purged_at is the record
    // that this content was removed rather than never stored.
    await db.update(jobPayloads)
      .set({ sourceRef: "", resultRef: null, previewProjection: null, purgedAt: now })
      .where(eq(jobPayloads.id, row.id));
    await db.update(protectedItems)
      .set({ valueRef: null, purgedAt: now })
      .where(and(eq(protectedItems.jobId, row.jobId), isNull(protectedItems.purgedAt)));
    purged += 1;
  }
  return purged;
}

export async function persistHumanizationJob(
  db: AppDatabase,
  input: PersistJobInput & { ownerUserId: string },
): Promise<PersistedOwnedJob>;
export async function persistHumanizationJob(
  db: AppDatabase,
  input: PersistJobInput & { ownerUserId?: undefined },
): Promise<PersistedJob>;
export async function persistHumanizationJob(
  db: AppDatabase,
  input: PersistJobInput,
): Promise<PersistedJob | PersistedOwnedJob> {
  const now = new Date();
  const jobId = crypto.randomUUID();
  const capabilityToken = await randomCapabilityToken();
  const capabilityDigest = await digestCapabilityToken(capabilityToken);
  const capabilityExpiresAt = new Date(now.getTime() + (input.capabilityTtlMs ?? DEFAULT_CAPABILITY_TTL_MS));

  if (input.ownerUserId) {
    // M3-02 idempotency, decided by rows-affected on one guarded statement.
    //
    // (owner_user_id, idempotency_key) is exactly the identity of the paid
    // usage operation this rewrite was charged under — src/lib/paid-usage.ts
    // builds its operation key as `humanize:${userId}:${idempotencyKey}` from
    // the same two values — so a retry of that operation cannot write a
    // second history row. The NOT EXISTS is evaluated inside the same write
    // that inserts, and SQLite/D1 serializes writes, so two concurrent
    // retries cannot both find nothing and both insert. Deciding this by
    // reading first and then inserting would be the race db/usage-ledger.ts's
    // header describes; a re-read afterwards cannot tell "I wrote it" from
    // "someone else wrote an identical row" either.
    //
    // Raw SQL because drizzle's insert builder has no INSERT ... SELECT ...
    // WHERE form; the column list must stay in step with the values below.
    const guarded = await db.run(sql`
      insert into humanization_jobs
        (id, owner_user_id, mode, state, client_fingerprint, idempotency_key,
         content_fingerprint, input_word_count, successful_word_count,
         pipeline_version, created_at, updated_at)
      select
        ${jobId}, ${input.ownerUserId}, ${input.mode}, 'succeeded', ${input.clientFingerprint},
        ${input.idempotencyKey}, ${input.contentFingerprint}, ${input.inputWordCount},
        ${input.successfulWordCount}, ${input.pipelineVersion}, ${now.getTime()}, ${now.getTime()}
      where not exists (
        select 1 from humanization_jobs
        where owner_user_id = ${input.ownerUserId} and idempotency_key = ${input.idempotencyKey}
      )
    `);
    if (rowsChanged(guarded) !== 1) return { jobId, recorded: false };
  } else {
    await db.insert(humanizationJobs).values({
      id: jobId,
      mode: input.mode,
      state: "succeeded",
      clientFingerprint: input.clientFingerprint,
      idempotencyKey: input.idempotencyKey,
      contentFingerprint: input.contentFingerprint,
      inputWordCount: input.inputWordCount,
      successfulWordCount: input.successfulWordCount,
      pipelineVersion: input.pipelineVersion,
      createdAt: now,
      updatedAt: now,
    });
  }

  await db.insert(jobPayloads).values({
    id: crypto.randomUUID(),
    jobId,
    sourceRef: input.original,
    resultRef: input.result,
    previewProjection: JSON.stringify(input.previewProjection),
    createdAt: now,
  });

  if (input.protectedContent.length) {
    await db.insert(protectedItems).values(
      await Promise.all(input.protectedContent.map(async (item) => ({
        id: crypto.randomUUID(),
        jobId,
        itemKey: item.id,
        kind: item.kind,
        sourceSpanStart: item.start,
        sourceSpanEnd: item.end,
        valueHash: await hashValue(item.normalizedValue),
        verificationStatus: "preserved" as const,
        createdAt: now,
      }))),
    );
  }

  // A job has exactly one access principal (db/schema.ts). An owned job's
  // principal is its owner, so no anonymous session is written for it: the
  // two together would be a second, unrevoked way into the same rewrite,
  // and the capability's raw token would have nowhere legitimate to go.
  if (!input.ownerUserId) {
    await db.insert(anonymousSessions).values({
      id: crypto.randomUUID(),
      jobId,
      capabilityDigest,
      createdAt: now,
      expiresAt: capabilityExpiresAt,
    });
  }

  // Best-effort retention sweep; a failure here must never fail the preview.
  // It only ever touches unowned work, so an owned write does not shorten
  // anyone's paid history by running it.
  try { await purgeExpiredAnonymousPayloads(db); } catch { /* retention is opportunistic */ }

  if (input.ownerUserId) return { jobId, recorded: true };
  return { jobId, capabilityToken, capabilityExpiresAt };
}

/**
 * Redeems a raw capability token for its preview projection. Never
 * consumes/rotates the session — that happens only in the M2-01 claim
 * transaction when a job is linked to an authenticated payer. Returns
 * `null` for an unknown, expired, or already-claimed capability; callers
 * must not distinguish those cases in the response (see the Job IDOR /
 * enumeration-oracle control in docs/SECURITY.md).
 */
export async function redeemPreviewCapability(db: AppDatabase, rawToken: string): Promise<RedeemedPreview | null> {
  if (!rawToken) return null;
  const capabilityDigest = await digestCapabilityToken(rawToken);

  const [session] = await db
    .select()
    .from(anonymousSessions)
    .where(eq(anonymousSessions.capabilityDigest, capabilityDigest))
    .limit(1);
  if (!session || session.consumedAt || session.expiresAt.getTime() <= Date.now()) return null;

  const [job] = await db.select().from(humanizationJobs).where(eq(humanizationJobs.id, session.jobId)).limit(1);
  if (!job || job.state !== "succeeded") return null;

  const [payload] = await db.select().from(jobPayloads).where(eq(jobPayloads.jobId, job.id)).limit(1);
  if (!payload?.previewProjection) return null;

  return {
    jobId: job.id,
    mode: job.mode,
    state: job.state,
    original: payload.sourceRef,
    projection: JSON.parse(payload.previewProjection) as PreviewProjection,
    capabilityExpiresAt: session.expiresAt,
  };
}
