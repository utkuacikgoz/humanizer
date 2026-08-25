// M3-05 purge worker: the half of the deletion workflow that runs after the
// customer has already been told "deleted".
//
// What this is NOT: it is not where the erasure happens. db/history-repository
// and db/account-deletion-repository void the source, result, projection and
// protected-item references inside the request that accepts the deletion, so
// the text is gone before the response is written. This worker drains the
// `deletion_jobs` queue those writes leave behind and propagates the deletion
// outward — re-applying the void to anything that was added since (a payload
// row written by an in-flight request that raced the delete), and calling each
// registered store/processor that holds a copy.
//
// Today the only store holding customer writing is D1: `.openai/hosting.json`
// has no R2 bucket, no third-party AI provider receives text (/privacy states
// this), Stripe holds billing records only, and nothing writes the analytics
// outbox. So the processor registry ships empty and the built-in D1
// propagation is the whole job. The registry is a parameter rather than a
// hardcoded list precisely so that adding an object store later is a
// registration, not a rewrite of the deletion path.
//
// This module must stay free of `cloudflare:workers`, `next/headers` and
// `next/navigation` imports so tests/purge-worker.test.mts can drive it under
// plain Node; worker/index.ts is the only place that binds it to D1.
import { and, asc, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";
import * as schema from "../../db/schema";
import type { AppDatabase } from "../../db/repository";
import { purgeExpiredAnonymousPayloads } from "../../db/repository";
import { recordDeletionAudit } from "../../db/deletion-audit";

const { deletionJobs, humanizationJobs, jobPayloads, protectedItems, resultRevisions, users } = schema;

/** How many queued deletions one drain may claim. Bounded so a scheduled run cannot become an unbounded D1 scan. */
export const DELETION_DRAIN_BATCH = 20;

/** Owned jobs propagated per pass for one account deletion; more than this leaves the queue row pending for the next pass. */
export const ACCOUNT_PROPAGATION_BATCH = 200;

/** A claim is held this long. A worker that dies mid-job leaves the row reclaimable rather than wedged. */
export const DELETION_LEASE_MS = 5 * 60 * 1000;

/**
 * A job that keeps failing is parked as `failed` after this many attempts
 * rather than retried forever. Parked is a state a human investigates; it is
 * never reported to the customer as success.
 */
export const MAX_DELETION_ATTEMPTS = 5;

/**
 * The window published to customers in app/privacy/page.tsx. Erasure of the
 * text itself is immediate; this is the outer bound for propagation to
 * everywhere else, including the provider's short-term point-in-time restore
 * window. The hourly schedule in vite.config.ts means the queue normally
 * drains in minutes; the published number is the promise, not the target.
 */
export const DELETION_PROPAGATION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface DeletionSubject {
  subjectType: "user" | "job";
  subjectId: string;
  scope: "history_item" | "full_account";
}

/**
 * A store or processor outside D1 that holds a copy of something deleted.
 * `purge` must be idempotent: it is called again on every retry, and a
 * successful call is remembered so a retry does not repeat it.
 */
export interface DeletionProcessor {
  /** Short, stable, code-shaped name; it is written to the audit trail. */
  name: string;
  supports?(subject: DeletionSubject): boolean;
  purge(subject: DeletionSubject): Promise<void>;
}

export interface DrainOptions {
  now?: Date;
  batchSize?: number;
  processors?: readonly DeletionProcessor[];
}

export interface DrainSummary {
  claimed: number;
  completed: number;
  /** Claimed, incomplete, and left pending for a later pass — a failure or more work than one pass allows. */
  deferred: number;
  /** Exhausted their retry budget and were parked as `failed`. */
  parked: number;
  /** Candidates another concurrent drain claimed first. */
  contended: number;
}

function rowsChanged(result: unknown): number {
  const changes = (result as { meta?: { changes?: number } } | undefined)?.meta?.changes;
  return typeof changes === "number" ? changes : 0;
}

function readProcessorStatus(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const statuses: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") statuses[key] = value;
    }
    return statuses;
  } catch {
    return {};
  }
}

/**
 * Voids every text-bearing reference for one job, again. Idempotent by
 * construction: each statement is guarded on the tombstone it writes, so a
 * second pass changes nothing and reports zero.
 */
async function propagateJobDeletion(db: AppDatabase, jobId: string, now: Date): Promise<number> {
  const voided = await db.update(jobPayloads)
    .set({ sourceRef: "", resultRef: null, previewProjection: null, purgedAt: now })
    .where(and(eq(jobPayloads.jobId, jobId), isNull(jobPayloads.purgedAt)));

  await db.update(protectedItems)
    .set({ valueRef: null, purgedAt: now })
    .where(and(eq(protectedItems.jobId, jobId), isNull(protectedItems.purgedAt)));

  await db.update(resultRevisions)
    .set({ resultRef: "" })
    .where(and(eq(resultRevisions.jobId, jobId), ne(resultRevisions.resultRef, "")));

  return rowsChanged(voided);
}

/**
 * Propagates an account deletion across the owner's jobs, a bounded page at a
 * time. Returns `false` when the page filled, meaning more work remains and
 * the queue row must stay pending rather than being marked complete.
 */
async function propagateAccountDeletion(
  db: AppDatabase,
  userId: string,
  now: Date,
): Promise<{ complete: boolean; payloadsVoided: number }> {
  // Belt and braces: the request path already tombstoned the account. If a
  // crash landed between the erasure and the tombstone, this re-applies it.
  await db.update(users).set({ deletedAt: now, contactEmail: null }).where(and(eq(users.id, userId), isNull(users.deletedAt)));

  const pending = await db
    .select({ id: humanizationJobs.id })
    .from(humanizationJobs)
    .innerJoin(jobPayloads, eq(jobPayloads.jobId, humanizationJobs.id))
    .where(and(eq(humanizationJobs.ownerUserId, userId), isNull(jobPayloads.purgedAt)))
    .limit(ACCOUNT_PROPAGATION_BATCH);

  let payloadsVoided = 0;
  for (const job of pending) {
    payloadsVoided += await propagateJobDeletion(db, job.id, now);
  }
  return { complete: pending.length < ACCOUNT_PROPAGATION_BATCH, payloadsVoided };
}

/**
 * Drains queued deletions.
 *
 * Concurrency. Two drains running at once (two cron firings overlapping, a
 * scheduled run overlapping a manual one) must never both process the same
 * row. The candidate SELECT is a hint, not a decision: every row is then taken
 * by a compare-and-set UPDATE whose WHERE names the exact `attempts` value the
 * candidate was read at, and the winner is decided on `meta.changes === 1`.
 * SQLite/D1 serialize writers, so of two workers holding the same candidate
 * exactly one sees 1 and the other sees 0 and moves on. Deciding this by
 * reading the row back would not work: a re-read cannot distinguish "I claimed
 * it" from "someone else claimed it a millisecond ago", which is the same
 * unsound pattern db/billing-repository.ts documents on claimJobForUser.
 *
 * Re-entrancy. A completed job is never a candidate, so re-running a drain
 * over already-drained work is a no-op. A claimed job whose worker died is
 * reclaimed once its lease expires. Every propagation step is guarded on the
 * tombstone it writes, so re-running one changes nothing.
 *
 * Failure isolation. Each job is attempted inside its own try/catch: one bad
 * job cannot abort the batch. Nothing derived from the caught error is stored
 * or logged — a D1 error object can carry the bound parameters of the failing
 * statement, which in this application means the customer's source and result
 * text. Only a code this module wrote itself is recorded.
 */
export async function drainDeletionJobs(db: AppDatabase, options: DrainOptions = {}): Promise<DrainSummary> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? DELETION_DRAIN_BATCH;
  const processors = options.processors ?? [];
  const summary: DrainSummary = { claimed: 0, completed: 0, deferred: 0, parked: 0, contended: 0 };

  const candidates = await db
    .select({
      id: deletionJobs.id,
      subjectType: deletionJobs.subjectType,
      subjectId: deletionJobs.subjectId,
      scope: deletionJobs.scope,
      attempts: deletionJobs.attempts,
      processorStatus: deletionJobs.processorStatus,
      requestedByUserId: deletionJobs.requestedByUserId,
    })
    .from(deletionJobs)
    .where(and(
      inArray(deletionJobs.status, ["pending", "in_progress"]),
      lt(deletionJobs.attempts, MAX_DELETION_ATTEMPTS),
      or(eq(deletionJobs.status, "pending"), lt(deletionJobs.leaseExpiresAt, now)),
    ))
    .orderBy(asc(deletionJobs.requestedAt))
    .limit(batchSize);

  for (const candidate of candidates) {
    const subject: DeletionSubject = {
      subjectType: candidate.subjectType as DeletionSubject["subjectType"],
      subjectId: candidate.subjectId,
      scope: candidate.scope as DeletionSubject["scope"],
    };
    const attempt = candidate.attempts + 1;

    const claim = await db.update(deletionJobs)
      .set({ status: "in_progress", attempts: attempt, leaseExpiresAt: new Date(now.getTime() + DELETION_LEASE_MS), failureCode: null })
      .where(and(
        eq(deletionJobs.id, candidate.id),
        eq(deletionJobs.attempts, candidate.attempts),
        or(eq(deletionJobs.status, "pending"), lt(deletionJobs.leaseExpiresAt, now)),
      ));
    if (rowsChanged(claim) !== 1) {
      summary.contended += 1;
      continue;
    }
    summary.claimed += 1;

    const statuses = readProcessorStatus(candidate.processorStatus);
    let failureCode: string | null = null;
    let complete = true;
    let payloadsVoided = 0;

    try {
      await recordDeletionAudit(db, {
        deletionJobId: candidate.id,
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        scope: subject.scope,
        actorUserId: candidate.requestedByUserId,
        event: "claimed",
        detail: { attempt },
      }, now);

      if (subject.scope === "full_account") {
        const result = await propagateAccountDeletion(db, subject.subjectId, now);
        complete = result.complete;
        payloadsVoided = result.payloadsVoided;
      } else {
        payloadsVoided = await propagateJobDeletion(db, subject.subjectId, now);
      }
      statuses.primary_store = "completed";

      for (const processor of processors) {
        if (statuses[processor.name] === "completed") continue;
        if (processor.supports && !processor.supports(subject)) {
          statuses[processor.name] = "unsupported";
          continue;
        }
        try {
          await processor.purge(subject);
          statuses[processor.name] = "completed";
        } catch {
          // The error object never leaves this block: only our own code.
          statuses[processor.name] = "failed";
          failureCode = `processor:${processor.name}`.slice(0, 64);
          break;
        }
        await recordDeletionAudit(db, {
          deletionJobId: candidate.id,
          subjectType: subject.subjectType,
          subjectId: subject.subjectId,
          scope: subject.scope,
          actorUserId: candidate.requestedByUserId,
          event: "propagated",
          processor: processor.name,
          detail: { attempt },
        }, now);
      }
    } catch {
      failureCode = "primary_store";
      statuses.primary_store = "failed";
    }

    const processorStatus = JSON.stringify(statuses);

    if (!failureCode && complete) {
      await db.update(deletionJobs)
        .set({ status: "completed", completedAt: now, processorStatus, leaseExpiresAt: null, failureCode: null })
        .where(and(eq(deletionJobs.id, candidate.id), eq(deletionJobs.status, "in_progress")));
      await recordDeletionAudit(db, {
        deletionJobId: candidate.id,
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        scope: subject.scope,
        actorUserId: candidate.requestedByUserId,
        event: "completed",
        detail: { attempt, payloadsVoided },
      }, now);
      summary.completed += 1;
      continue;
    }

    // A job that has burned its whole budget is parked rather than retried
    // forever. Only a real failure parks: an incomplete-but-healthy account
    // pass (more owned jobs than one page) is always rescheduled.
    const parked = failureCode !== null && attempt >= MAX_DELETION_ATTEMPTS;
    await db.update(deletionJobs)
      .set({ status: parked ? "failed" : "pending", processorStatus, leaseExpiresAt: null, failureCode })
      .where(and(eq(deletionJobs.id, candidate.id), eq(deletionJobs.status, "in_progress")));
    await recordDeletionAudit(db, {
      deletionJobId: candidate.id,
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      scope: subject.scope,
      actorUserId: candidate.requestedByUserId,
      event: parked ? "parked" : "retry_scheduled",
      detail: { attempt, ...(failureCode ? { failureCode } : {}) },
    }, now);
    if (parked) summary.parked += 1;
    else summary.deferred += 1;
  }

  return summary;
}

export interface ScheduledPurgeSummary {
  deletions: DrainSummary;
  anonymousPayloadsPurged: number;
}

/**
 * One scheduled pass: drain the deletion queue, then age out unclaimed
 * anonymous payloads.
 *
 * The anonymous sweep is also called opportunistically from
 * db/repository.ts's persist path, which is not enough on its own — a service
 * with no traffic never sweeps, and /privacy promises 30 days regardless of
 * whether anyone is writing. Running it here makes the published window hold
 * on an idle day too. It is bounded per pass and only ever touches unowned
 * work, so it can never shorten a paying customer's history.
 *
 * Neither half can fail the other, and neither logs a caught error object.
 */
export async function runScheduledPurge(db: AppDatabase, options: DrainOptions = {}): Promise<ScheduledPurgeSummary> {
  const now = options.now ?? new Date();
  let deletions: DrainSummary = { claimed: 0, completed: 0, deferred: 0, parked: 0, contended: 0 };
  try {
    deletions = await drainDeletionJobs(db, { ...options, now });
  } catch {
    // Swallowed deliberately: the anonymous sweep below is independent work
    // and must still run. The queue row stays claimable on the next pass.
  }

  let anonymousPayloadsPurged = 0;
  try {
    anonymousPayloadsPurged = await purgeExpiredAnonymousPayloads(db, now);
  } catch {
    // Retention is opportunistic; a later pass collects what this one missed.
  }

  return { deletions, anonymousPayloadsPurged };
}
