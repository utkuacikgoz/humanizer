// M2 billing/identity persistence (M2-01, M2-05, M2-06, M2-08). Same
// driver-agnostic design as db/repository.ts: depends only on
// drizzle-orm/sqlite-core's generic BaseSQLiteDatabase, so it's directly
// unit-testable against real SQLite without Miniflare — see
// tests/billing-repository.test.mts.
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import * as schema from "./schema";
import type { SubscriptionStatus } from "./schema";
import type { AppDatabase } from "./repository";

const { users, anonymousSessions, humanizationJobs, subscriptions, stripeEvents } = schema;

export interface UserRecord {
  userId: string;
  isNew: boolean;
}

/** Read-only lookup — does not create a row. For checks (e.g. "is this unlocked?") where a never-checked-out visitor shouldn't get a user row just for asking. */
export async function findUserIdByExternalSubject(db: AppDatabase, externalSubject: string): Promise<string | null> {
  const [row] = await db.select().from(users).where(eq(users.externalSubject, externalSubject)).limit(1);
  return row?.id ?? null;
}

/**
 * Upserts a user by their trusted external identity subject. A neither
 * client-supplied nor guessable email/user ID is ever accepted as proof
 * of ownership — only the platform-verified subject from
 * app/chatgpt-auth.ts, resolved server-side before this is called.
 */
export async function getOrCreateUserByExternalSubject(
  db: AppDatabase,
  input: { externalSubject: string; email: string | null },
): Promise<UserRecord> {
  const existing = await db.select().from(users).where(eq(users.externalSubject, input.externalSubject)).limit(1);
  if (existing[0]) return { userId: existing[0].id, isNew: false };

  const userId = crypto.randomUUID();
  try {
    await db.insert(users).values({
      id: userId,
      externalSubject: input.externalSubject,
      contactEmail: input.email,
      createdAt: new Date(),
    });
    return { userId, isNew: true };
  } catch {
    // Lost a race against a concurrent first sign-in for the same
    // subject (unique index on external_subject) — the row now exists;
    // recover by reading it rather than treating this as a real failure.
    const [row] = await db.select().from(users).where(eq(users.externalSubject, input.externalSubject)).limit(1);
    if (!row) throw new Error("Failed to create or recover user record.");
    return { userId: row.id, isNew: false };
  }
}

/**
 * Reads the D1Result-shaped `.meta.changes` (Cloudflare D1's real
 * response shape for a write) off a raw update/insert result. The
 * sqlite-proxy test harness (tests/helpers/sqlite-db.mts) deliberately
 * mirrors this exact shape so this reads identically in tests and
 * against the real D1 driver, despite AppDatabase erasing the run-result
 * generic to `any` for driver-agnosticism.
 */
function rowsChanged(result: unknown): number {
  const changes = (result as { meta?: { changes?: number } } | undefined)?.meta?.changes;
  return typeof changes === "number" ? changes : 0;
}

/**
 * Single-use claim transaction (M2-01/D-005): binds an anonymous job to
 * an authenticated user, exactly once. A guarded UPDATE (`consumed_at IS
 * NULL AND expires_at > now`) only ever reports 1 row changed to the
 * caller whose write actually applied — SQLite serializes concurrent
 * writers at the engine level, so exactly one of two racing claims can
 * ever see changes === 1 for the same row. An earlier version of this
 * function tried to detect the winner by comparing a freshly-read
 * `consumed_at` timestamp against the value it had just written; that is
 * unsound; two calls within the same millisecond (routine under
 * concurrency, not just a test artifact) can write the identical
 * millisecond value and both wrongly conclude they won. Caught by
 * tests/billing-repository.test.mts's concurrent-claim test.
 * Idempotent for retries by the SAME user (e.g. checkout succeeded in
 * claiming the job but then failed at the Stripe API call — a network
 * blip, not a security event): if the capability was already consumed
 * and the job it pointed to is already owned by this same userId, this
 * returns that jobId again rather than null, so a legitimate retry isn't
 * permanently locked out just because the one-time capability was
 * already spent on an earlier, failed attempt. Revealing "you already
 * own this" to the same authenticated caller who already owns it is not
 * an oracle leak; it would be if revealed to anyone else, so this still
 * returns null uniformly for every other case: unknown digest, expired-
 * and-never-claimed, or claimed by a *different* user (docs/SECURITY.md
 * enumeration-oracle control).
 */
export async function claimJobForUser(
  db: AppDatabase,
  input: { capabilityDigest: string; userId: string },
): Promise<{ jobId: string } | null> {
  const claimedAt = new Date();
  const updateResult = await db
    .update(anonymousSessions)
    .set({ consumedAt: claimedAt })
    .where(and(
      eq(anonymousSessions.capabilityDigest, input.capabilityDigest),
      isNull(anonymousSessions.consumedAt),
      gt(anonymousSessions.expiresAt, claimedAt),
    ));

  if (rowsChanged(updateResult) !== 1) {
    const [existingSession] = await db.select().from(anonymousSessions).where(eq(anonymousSessions.capabilityDigest, input.capabilityDigest)).limit(1);
    if (!existingSession?.consumedAt) return null;
    const [existingJob] = await db.select().from(humanizationJobs).where(eq(humanizationJobs.id, existingSession.jobId)).limit(1);
    return existingJob?.ownerUserId === input.userId ? { jobId: existingJob.id } : null;
  }

  const [session] = await db
    .select()
    .from(anonymousSessions)
    .where(eq(anonymousSessions.capabilityDigest, input.capabilityDigest))
    .limit(1);
  if (!session) return null;

  await db.update(humanizationJobs).set({ ownerUserId: input.userId, updatedAt: claimedAt }).where(eq(humanizationJobs.id, session.jobId));
  return { jobId: session.jobId };
}

/**
 * A permanently-failing event stops being retried after this many
 * attempts (acknowledged and left `failed` for manual investigation)
 * rather than retried forever — each attempt re-fetches from the Stripe
 * API, so an unbounded retry loop is a real, if low-severity, cost.
 */
const MAX_STRIPE_EVENT_ATTEMPTS = 5;

/**
 * Webhook inbox insert (M2-05). `stripe_events.id` (the Stripe event ID
 * itself) is the primary key and the replay defense per the inbox
 * pattern in docs/MONETIZATION.md — but a duplicate INSERT is not
 * automatically a duplicate to skip. Stripe retries a webhook delivery
 * specifically when the previous attempt returned a non-2xx (see
 * app/api/webhooks/stripe/route.ts's 500 on processing failure); if
 * every repeat delivery were treated as "already handled," a genuinely
 * transient failure would only ever get one attempt, and returning 500
 * to ask for a retry would be a no-op. This distinguishes: a event
 * already successfully processed (skip, true duplicate), one still
 * within its retry budget (reprocess), and one that has exhausted it
 * (stop retrying, but the failure stays recorded).
 */
export async function recordStripeEvent(
  db: AppDatabase,
  input: { eventId: string; eventType: string; objectId: string | null; stripeCreatedAt: Date },
): Promise<"new" | "retry" | "already-processed" | "attempts-exhausted"> {
  try {
    await db.insert(stripeEvents).values({
      id: input.eventId,
      eventType: input.eventType,
      objectId: input.objectId,
      stripeCreatedAt: input.stripeCreatedAt,
      processingStatus: "pending",
      processingAttempts: 0,
      receivedAt: new Date(),
    });
    return "new";
  } catch {
    const [existing] = await db.select().from(stripeEvents).where(eq(stripeEvents.id, input.eventId)).limit(1);
    if (!existing) return "new"; // insert conflicted but the row is gone — fail open rather than silently drop a real event
    if (existing.processingStatus === "processed") return "already-processed";
    if (existing.processingAttempts >= MAX_STRIPE_EVENT_ATTEMPTS) return "attempts-exhausted";
    return "retry";
  }
}

export async function markStripeEventOutcome(db: AppDatabase, eventId: string, status: "processed" | "failed") {
  const [event] = await db.select().from(stripeEvents).where(eq(stripeEvents.id, eventId)).limit(1);
  await db.update(stripeEvents).set({
    processingStatus: status,
    processingAttempts: (event?.processingAttempts ?? 0) + 1,
    processedAt: new Date(),
  }).where(eq(stripeEvents.id, eventId));
}

export interface SubscriptionProjection {
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  planId: string;
  catalogVersion: number;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  lastStripeEventId: string | null;
}

/**
 * Idempotent-by-object-ID projector (M2-06). The caller must have
 * re-fetched the authoritative current subscription object from the
 * Stripe API before calling this — never project a webhook payload's
 * embedded object directly, since delivery order is not guaranteed
 * (docs/MONETIZATION.md: "fetch current Stripe object state when an
 * older event could overwrite newer state"). Because this always
 * receives Stripe's current truth, last-write-wins here is correct
 * regardless of which event triggered the call.
 */
export async function upsertSubscriptionFromStripe(db: AppDatabase, input: SubscriptionProjection): Promise<void> {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, input.stripeSubscriptionId))
    .limit(1);

  if (existing) {
    await db.update(subscriptions).set({ ...input, updatedAt: now }).where(eq(subscriptions.id, existing.id));
  } else {
    await db.insert(subscriptions).values({ id: crypto.randomUUID(), ...input, createdAt: now, updatedAt: now });
  }
}

const ACTIVE_ENTITLEMENT_STATUSES: ReadonlySet<SubscriptionStatus> = new Set(["active", "trialing"]);

export interface Entitlement {
  planId: string;
  status: SubscriptionStatus;
  /** Period boundaries scope the usage ledger's allowance (M2-07). */
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  stripeCustomerId: string;
}

/**
 * A subscription the customer has already scheduled to end, whose final
 * period has now elapsed, confers nothing — even if the local projection
 * still says `active`.
 *
 * This closes a real entitlement-drift hole rather than a hypothetical
 * one. Access ends at `current_period_end` for a cancel-at-period-end
 * subscription (docs/MONETIZATION.md: "keep access through
 * `current_period_end` only when Stripe indicates cancellation at period
 * end; then block new paid work"), but the local projection only learns
 * that the period actually elapsed when Stripe's final
 * `customer.subscription.deleted` webhook arrives and is processed
 * successfully. That delivery can fail: db/billing-repository.ts's own
 * MAX_STRIPE_EVENT_ATTEMPTS deliberately stops retrying a permanently
 * failing event, at which point the row would sit at `active` forever and
 * keep unlocking paid content indefinitely, for free. Deriving the expiry
 * from data the webhook already delivered makes the check independent of
 * any *later* webhook arriving at all.
 *
 * Deliberately narrow: it fires only when `cancelAtPeriodEnd` is set, so a
 * normally-renewing subscription is never locked out by a slow renewal
 * webhook (its `cancel_at_period_end` is false, and Stripe advances the
 * period on renewal). A broader "any elapsed period is stale" rule would
 * trade this leak for a false lockout of paying customers, which is why
 * general projection staleness belongs to the periodic Stripe
 * reconciliation job (docs/MONETIZATION.md), not to this read path.
 */
function isExpiredCancellation(row: { cancelAtPeriodEnd: boolean; currentPeriodEnd: Date }, now: number): boolean {
  return row.cancelAtPeriodEnd && row.currentPeriodEnd.getTime() <= now;
}

/**
 * Server-authoritative entitlement lookup (M2-08). Only ever driven by
 * the local subscription projection updated from verified webhooks —
 * never by a client-supplied plan/status, a Checkout redirect, or a
 * cached frontend value (D-006).
 */
export async function getActiveEntitlement(db: AppDatabase, userId: string): Promise<Entitlement | null> {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).orderBy(desc(subscriptions.updatedAt));
  const now = Date.now();
  const active = rows.find((row) => ACTIVE_ENTITLEMENT_STATUSES.has(row.status) && !isExpiredCancellation(row, now));
  if (!active) return null;
  return { planId: active.planId, status: active.status, currentPeriodStart: active.currentPeriodStart, currentPeriodEnd: active.currentPeriodEnd, stripeCustomerId: active.stripeCustomerId };
}

/** Returns the authenticated user's Stripe customer ID, if any subscription row exists for them. */
export async function getStripeCustomerId(db: AppDatabase, userId: string): Promise<string | null> {
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).orderBy(desc(subscriptions.updatedAt)).limit(1);
  return row?.stripeCustomerId ?? null;
}

export interface UnlockedResult {
  original: string;
  result: string;
}

/**
 * Server-authoritative unlock (M2-08): the full rewrite text is returned
 * only when BOTH factors hold — the caller owns the job (set once, by
 * claimJobForUser) AND currently holds an active entitlement. Ownership
 * alone (a lapsed subscriber who once claimed a job) is not sufficient;
 * D-P03's exact grace-period policy for a lapsed-but-recent subscription
 * is still a proposed, unresolved decision (docs/DECISIONS.md) — this
 * implements the strict interpretation (active/trialing only) as the
 * safe default until that's ratified, not the lenient one.
 *
 * A purged payload is treated as gone, not as content to serve: once a
 * deletion job tombstones a row (`job_payloads.purged_at`), telling the
 * user it is deleted while this path still returns the text would be the
 * "Deletion failure — UI says deleted while payload remains" threat in
 * docs/SECURITY.md. The purge worker itself is M3-05; this read path is
 * made purge-aware now so that landing it cannot leave a window where
 * tombstoned content is still readable.
 */
export async function getUnlockedResult(db: AppDatabase, input: { userId: string; jobId: string }): Promise<UnlockedResult | null> {
  const entitlement = await getActiveEntitlement(db, input.userId);
  if (!entitlement) return null;

  const [job] = await db.select().from(humanizationJobs).where(eq(humanizationJobs.id, input.jobId)).limit(1);
  if (!job || job.ownerUserId !== input.userId || job.state !== "succeeded") return null;

  const [payload] = await db.select().from(schema.jobPayloads).where(eq(schema.jobPayloads.jobId, job.id)).limit(1);
  if (!payload?.resultRef || payload.purgedAt) return null;

  return { original: payload.sourceRef, result: payload.resultRef };
}
