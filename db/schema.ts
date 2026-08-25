// D1/Drizzle schema for the humanizer conceptual data model described in
// docs/ARCHITECTURE.md (M0-04). Exact column names may still change, but the
// invariants below must not: a job has exactly one access principal, no
// payment/quota authority is ever forgeable from a client, and full result
// text is only reachable through job_payloads, never inlined onto a job row.
//
// This schema is drafted ahead of the persistence work in M1-09; the
// synchronous in-memory pipeline (src/lib/humanization/pipeline.ts) does not
// yet write through these tables.
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Mirrors src/lib/humanization/types.ts WritingMode without importing app
// code into the schema module.
export const WRITING_MODES = ["natural", "professional", "academic", "casual"] as const;
export type WritingModeValue = (typeof WRITING_MODES)[number];

// docs/ARCHITECTURE.md pipeline state machine:
// received -> validated -> analyzed -> protected -> rewriting -> verifying
// -> evaluating -> succeeded | retryable_failed | terminal_failed
export const JOB_STATES = [
  "received",
  "validated",
  "analyzed",
  "protected",
  "rewriting",
  "verifying",
  "evaluating",
  "succeeded",
  "retryable_failed",
  "terminal_failed",
] as const;
export type JobState = (typeof JOB_STATES)[number];

export const PROTECTED_ITEM_KINDS = [
  "person",
  "company",
  "product",
  "date",
  "number",
  "percentage",
  "currency",
  "quotation",
  "citation",
  "url",
  "technical-term",
  "code",
  "reference",
] as const;

export const PLAN_IDS = ["starter", "pro"] as const;

// Mirrors Stripe's actual subscription status vocabulary faithfully
// (docs/MONETIZATION.md: "Internal statuses are explicit; raw Stripe
// status strings are adapted at the boundary" — that adaptation is
// *access-policy* interpretation of each status, e.g. which ones count
// as an active entitlement, not lossy renaming/collapsing at storage
// time). `incomplete`/`paused` are real Stripe statuses beyond the five
// docs/MONETIZATION.md's "Proposed policy pending D-P03" enumerates.
export const SUBSCRIPTION_STATUSES = [
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

const id = (columnName: string) => text(columnName).primaryKey();
const createdAt = (columnName = "created_at") =>
  integer(columnName, { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch('subsec') * 1000)`);

// `sql` templates bind an interpolated array as one parameter, not a SQL
// list, so CHECK ... IN (...) constraints build their literal list here.
const sqlEnumList = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(", "));

/**
 * Privacy-safe, fixed-window counters for anonymous preview admission. The
 * client key is an HMAC of Cloudflare's trusted connecting IP, never the raw
 * address. A unique, short-lived admission token couples each counter update
 * to its request-row write inside one transactional D1 batch.
 */
export const previewGuardWindows = sqliteTable("preview_guard_windows", {
  clientKey: text("client_key").notNull(),
  windowStart: integer("window_start").notNull(),
  requestCount: integer("request_count").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
  admissionToken: text("admission_token"),
}, (t) => [
  primaryKey({ columns: [t.clientKey, t.windowStart] }),
  index("preview_guard_windows_start_idx").on(t.windowStart),
  check("preview_guard_windows_count_check", sql`${t.requestCount} >= 0`),
]);

/**
 * Distributed idempotency and active-work leases. Keys/fingerprints are HMACs;
 * the short-lived replay payload is AES-GCM ciphertext. No raw IP or customer
 * writing is queryable from this table.
 */
export const previewGuardRequests = sqliteTable("preview_guard_requests", {
  requestKey: text("request_key").primaryKey(),
  clientKey: text("client_key").notNull(),
  fingerprint: text("fingerprint").notNull(),
  windowStart: integer("window_start").notNull(),
  status: text("status").notNull(),
  // Fencing token prevents an expired/stale Worker from completing a lease
  // that a newer Worker has already reclaimed.
  leaseToken: text("lease_token").notNull(),
  leaseExpiresAt: integer("lease_expires_at").notNull(),
  responseCiphertext: text("response_ciphertext"),
  responseIv: text("response_iv"),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  index("preview_guard_requests_client_active_idx").on(t.clientKey, t.status, t.leaseExpiresAt),
  index("preview_guard_requests_expires_idx").on(t.expiresAt),
  check("preview_guard_requests_status_check", sql`${t.status} in ('active', 'succeeded', 'failed')`),
]);

/** Trusted external identity subject; contact/legal display data only. */
export const users = sqliteTable("users", {
  id: id("id"),
  externalSubject: text("external_subject").notNull(),
  contactEmail: text("contact_email"),
  createdAt: createdAt(),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
}, (t) => [uniqueIndex("users_external_subject_idx").on(t.externalSubject)]);

/**
 * A high-entropy anonymous preview capability tied to exactly one job.
 * Only a one-way digest of the raw token is ever stored.
 */
export const anonymousSessions = sqliteTable("anonymous_sessions", {
  id: id("id"),
  jobId: text("job_id").notNull().references(() => humanizationJobs.id),
  capabilityDigest: text("capability_digest").notNull(),
  createdAt: createdAt(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  // Set once during the single-use claim transaction; a consumed session no
  // longer authorizes anonymous preview access.
  consumedAt: integer("consumed_at", { mode: "timestamp_ms" }),
  abuseCount: integer("abuse_count").notNull().default(0),
}, (t) => [
  uniqueIndex("anonymous_sessions_job_id_idx").on(t.jobId),
  uniqueIndex("anonymous_sessions_capability_digest_idx").on(t.capabilityDigest),
]);

/**
 * A job's access principal is exactly one of: an unconsumed row in
 * anonymous_sessions, or ownerUserId here. The claim transaction (M2-01)
 * must set ownerUserId and consume the anonymous session atomically.
 */
export const humanizationJobs = sqliteTable("humanization_jobs", {
  id: id("id"),
  ownerUserId: text("owner_user_id").references(() => users.id),
  mode: text("mode").notNull().$type<WritingModeValue>(),
  state: text("state").notNull().default("received").$type<JobState>(),
  // Hash of the request-guard client signal (never a raw IP/cookie).
  clientFingerprint: text("client_fingerprint").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  // Hash of normalized text + mode; matches PreviewRequestGuard's replay fingerprint.
  contentFingerprint: text("content_fingerprint").notNull(),
  inputWordCount: integer("input_word_count").notNull(),
  successfulWordCount: integer("successful_word_count"),
  pipelineVersion: integer("pipeline_version").notNull(),
  terminalErrorClass: text("terminal_error_class"),
  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [
  // Idempotent replay is scoped per observed client, matching
  // src/lib/preview-request-guard.ts's `${clientId}:${idempotencyKey}` key.
  uniqueIndex("humanization_jobs_client_idempotency_idx").on(t.clientFingerprint, t.idempotencyKey),
  index("humanization_jobs_owner_idx").on(t.ownerUserId),
  check("humanization_jobs_mode_check", sql`${t.mode} in (${sqlEnumList(WRITING_MODES)})`),
  check("humanization_jobs_state_check", sql`${t.state} in (${sqlEnumList(JOB_STATES)})`),
]);

/**
 * Restricted-content payload storage, isolated from queryable job metadata.
 * `sourceRef`/`resultRef` hold ciphertext or an object-storage key depending
 * on the D-P04 storage-separation decision; resultRef is set only once the
 * job succeeds. Full result text lives ONLY here — never inline it onto
 * humanization_jobs or any other queryable row.
 * `previewProjection` is different in kind: a small JSON blob of the
 * already-derived, approved-for-display preview fields (naturalness label,
 * meaning-preservation label, improvement count, truncated preview text).
 * It is safe to return from a preview-capability response; resultRef never is.
 */
export const jobPayloads = sqliteTable("job_payloads", {
  id: id("id"),
  jobId: text("job_id").notNull().references(() => humanizationJobs.id),
  sourceRef: text("source_ref").notNull(),
  resultRef: text("result_ref"),
  previewProjection: text("preview_projection"),
  encryptionKeyId: text("encryption_key_id"),
  purgedAt: integer("purged_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("job_payloads_job_id_idx").on(t.jobId)]);

export const protectedItems = sqliteTable("protected_items", {
  id: id("id"),
  jobId: text("job_id").notNull().references(() => humanizationJobs.id),
  // Stable extraction ID, e.g. ProtectedContent.id from src/lib/humanization/types.ts.
  itemKey: text("item_key").notNull(),
  kind: text("kind").notNull(),
  sourceSpanStart: integer("source_span_start").notNull(),
  sourceSpanEnd: integer("source_span_end").notNull(),
  valueHash: text("value_hash").notNull(),
  // Only populated when exact round-trip reconstruction requires it; a
  // securely stored reference, never plaintext inlined elsewhere.
  valueRef: text("value_ref"),
  verificationStatus: text("verification_status").notNull().default("pending"),
  // Mirrors job_payloads.purgedAt so a deletion job has one tombstone story
  // to tell for every table that can hold a "securely stored reference".
  purgedAt: integer("purged_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("protected_items_job_item_idx").on(t.jobId, t.itemKey),
  check("protected_items_kind_check", sql`${t.kind} in (${sqlEnumList(PROTECTED_ITEM_KINDS)})`),
  check(
    "protected_items_verification_status_check",
    sql`${t.verificationStatus} in ('pending', 'preserved', 'altered', 'missing')`,
  ),
]);

/** One row per stage attempt (extraction/analysis/rewrite/verification/evaluation section). */
export const jobAttempts = sqliteTable("job_attempts", {
  id: id("id"),
  jobId: text("job_id").notNull().references(() => humanizationJobs.id),
  stage: text("stage").notNull(),
  sectionKey: text("section_key"),
  attemptNumber: integer("attempt_number").notNull(),
  status: text("status").notNull(),
  providerName: text("provider_name"),
  providerModel: text("provider_model"),
  promptVersion: text("prompt_version"),
  tokensUsed: integer("tokens_used"),
  costUsd: real("cost_usd"),
  latencyMs: integer("latency_ms"),
  // Non-sensitive failure code only; never raw provider error text.
  failureCode: text("failure_code"),
  createdAt: createdAt(),
}, (t) => [
  index("job_attempts_job_id_idx").on(t.jobId),
  check("job_attempts_stage_check", sql`${t.stage} in ('extraction', 'analysis', 'rewrite', 'verification', 'evaluation')`),
  check("job_attempts_status_check", sql`${t.status} in ('succeeded', 'failed', 'aborted')`),
]);

/**
 * Immutable successful output versions; edits/regenerations branch from a
 * parent. `resultRef` carries the same guarantee as job_payloads.resultRef —
 * ciphertext or an object-storage key, never inline plaintext restricted
 * content.
 */
export const resultRevisions = sqliteTable("result_revisions", {
  id: id("id"),
  jobId: text("job_id").notNull().references(() => humanizationJobs.id),
  parentRevisionId: text("parent_revision_id"),
  revisionType: text("revision_type").notNull(),
  resultRef: text("result_ref").notNull(),
  successfulWordCount: integer("successful_word_count").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [
  index("result_revisions_job_id_idx").on(t.jobId),
  check(
    "result_revisions_type_check",
    sql`${t.revisionType} in ('original', 'sentence_regeneration', 'manual_edit', 'restore')`,
  ),
]);

/** Local projection of a Stripe subscription; raw Stripe status is adapted at the boundary. */
export const subscriptions = sqliteTable("subscriptions", {
  id: id("id"),
  userId: text("user_id").notNull().references(() => users.id),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  stripeSubscriptionId: text("stripe_subscription_id").notNull(),
  planId: text("plan_id").notNull(),
  catalogVersion: integer("catalog_version").notNull(),
  status: text("status").notNull().$type<SubscriptionStatus>(),
  currentPeriodStart: integer("current_period_start", { mode: "timestamp_ms" }).notNull(),
  currentPeriodEnd: integer("current_period_end", { mode: "timestamp_ms" }).notNull(),
  cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" }).notNull().default(false),
  // Last processed Stripe event ID/created ordering anchor, to resist out-of-order webhook delivery.
  lastStripeEventId: text("last_stripe_event_id"),
  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [
  uniqueIndex("subscriptions_stripe_subscription_id_idx").on(t.stripeSubscriptionId),
  index("subscriptions_user_id_idx").on(t.userId),
  check("subscriptions_plan_id_check", sql`${t.planId} in (${sqlEnumList(PLAN_IDS)})`),
  check("subscriptions_status_check", sql`${t.status} in (${sqlEnumList(SUBSCRIPTION_STATUSES)})`),
]);

/** Webhook inbox: event.id uniqueness is the primary replay defense. */
export const stripeEvents = sqliteTable("stripe_events", {
  id: text("id").primaryKey(), // Stripe event.id itself.
  eventType: text("event_type").notNull(),
  objectId: text("object_id"),
  stripeCreatedAt: integer("stripe_created_at", { mode: "timestamp_ms" }).notNull(),
  processingStatus: text("processing_status").notNull().default("pending"),
  processingAttempts: integer("processing_attempts").notNull().default(0),
  receivedAt: createdAt("received_at"),
  processedAt: integer("processed_at", { mode: "timestamp_ms" }),
}, (t) => [
  index("stripe_events_object_id_idx").on(t.objectId),
  check(
    "stripe_events_processing_status_check",
    sql`${t.processingStatus} in ('pending', 'processed', 'failed', 'ignored')`,
  ),
]);

/**
 * Append-only usage ledger. `operationKey` identifies one customer
 * operation; a reservation, its eventual commit, and any release share the
 * same key but are distinct rows distinguished by `entryType`; a replay with
 * the same key and entryType returns the prior row instead of double-writing.
 */
export const usageEntries = sqliteTable("usage_entries", {
  id: id("id"),
  userId: text("user_id").notNull().references(() => users.id),
  subscriptionId: text("subscription_id").references(() => subscriptions.id),
  periodStart: integer("period_start", { mode: "timestamp_ms" }).notNull(),
  operationKey: text("operation_key").notNull(),
  entryType: text("entry_type").notNull(),
  attemptedWords: integer("attempted_words").notNull().default(0),
  successfulWords: integer("successful_words").notNull().default(0),
  jobId: text("job_id").references(() => humanizationJobs.id),
  // Required for entryType = 'adjustment'.
  reason: text("reason"),
  actor: text("actor"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("usage_entries_operation_key_type_idx").on(t.operationKey, t.entryType),
  index("usage_entries_user_period_idx").on(t.userId, t.periodStart),
  check(
    "usage_entries_entry_type_check",
    sql`${t.entryType} in ('reservation', 'commit', 'release', 'adjustment')`,
  ),
]);

/** Content-free funnel events staged for delivery to the analytics vendor. */
export const analyticsOutbox = sqliteTable("analytics_outbox", {
  id: id("id"),
  eventName: text("event_name").notNull(),
  eventVersion: integer("event_version").notNull(),
  actorId: text("actor_id"),
  jobId: text("job_id"),
  // JSON string; writers must apply the versioned property allowlist before insert.
  properties: text("properties").notNull().default("{}"),
  occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
  deliveryStatus: text("delivery_status").notNull().default("pending"),
  deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
  deliveryAttempts: integer("delivery_attempts").notNull().default(0),
}, (t) => [
  index("analytics_outbox_delivery_status_idx").on(t.deliveryStatus),
  check(
    "analytics_outbox_delivery_status_check",
    sql`${t.deliveryStatus} in ('pending', 'delivered', 'failed')`,
  ),
]);

/**
 * Tracks propagation of a deletion request across every store/processor.
 *
 * The queue does not hold the erasure itself: db/history-repository.ts voids
 * the text in the same request that accepts the deletion. A row here is the
 * propagation tombstone the M3-05 purge worker drains, and it carries no
 * customer writing of any kind — only the subject, the scope, the authority,
 * and retry bookkeeping.
 */
export const deletionJobs = sqliteTable("deletion_jobs", {
  id: id("id"),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  scope: text("scope").notNull(),
  /** The server-derived user id whose authority the deletion was made under. */
  requestedByUserId: text("requested_by_user_id"),
  requestedAt: createdAt("requested_at"),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  // JSON string keyed by store/processor name -> propagation status.
  processorStatus: text("processor_status").notNull().default("{}"),
  status: text("status").notNull().default("pending"),
  /** Bounded retry budget; a job that exhausts it is parked as `failed`. */
  attempts: integer("attempts").notNull().default(0),
  /**
   * Claim lease. A worker that dies mid-job leaves `in_progress` behind; the
   * lease is what lets a later drain reclaim it instead of the row wedging
   * the queue forever.
   */
  leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp_ms" }),
  /**
   * Short, self-generated failure code (e.g. `processor:r2`). Never a driver
   * or provider error object: a D1 error can carry the bound statement
   * parameters, which for this application means the customer's writing.
   */
  failureCode: text("failure_code"),
}, (t) => [
  index("deletion_jobs_subject_idx").on(t.subjectId),
  index("deletion_jobs_status_idx").on(t.status, t.requestedAt),
  check("deletion_jobs_subject_type_check", sql`${t.subjectType} in ('user', 'job')`),
  check("deletion_jobs_scope_check", sql`${t.scope} in ('history_item', 'full_account')`),
  check(
    "deletion_jobs_status_check",
    sql`${t.status} in ('pending', 'in_progress', 'completed', 'failed')`,
  ),
]);

export const DELETION_AUDIT_EVENTS = [
  "requested",
  "claimed",
  "propagated",
  "completed",
  "retry_scheduled",
  "parked",
] as const;
export type DeletionAuditEvent = (typeof DELETION_AUDIT_EVENTS)[number];

/**
 * The deletion audit trail (M3-05): what was deleted, when, and under whose
 * authority.
 *
 * Every column here is deliberately incapable of holding customer writing.
 * `detail` is a JSON string written only by db/deletion-audit.ts, which
 * accepts counts, booleans and self-generated codes and nothing else, because
 * an audit record that quotes even a fragment of a deleted draft — or a hash
 * of one, which confirms a guess at a short phrase — would defeat the
 * deletion it is evidence of.
 */
export const deletionAuditEvents = sqliteTable("deletion_audit_events", {
  id: id("id"),
  deletionJobId: text("deletion_job_id"),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  scope: text("scope").notNull(),
  /** Whose authority: the server-derived user id, never a client-supplied one. */
  actorUserId: text("actor_user_id"),
  event: text("event").notNull().$type<DeletionAuditEvent>(),
  /** Store/processor this event is about, when it is about one. */
  processor: text("processor"),
  detail: text("detail").notNull().default("{}"),
  occurredAt: createdAt("occurred_at"),
}, (t) => [
  index("deletion_audit_events_subject_idx").on(t.subjectId),
  index("deletion_audit_events_job_idx").on(t.deletionJobId),
  check("deletion_audit_events_subject_type_check", sql`${t.subjectType} in ('user', 'job')`),
  check("deletion_audit_events_scope_check", sql`${t.scope} in ('history_item', 'full_account')`),
  check("deletion_audit_events_event_check", sql`${t.event} in (${sqlEnumList(DELETION_AUDIT_EVENTS)})`),
]);

/**
 * Email magic-link sign-in (M4-01).
 *
 * The raw link token is NEVER stored: only `tokenDigest`, a SHA-256 of the
 * 256-bit random token. A read of this table therefore cannot be replayed
 * into a sign-in, and a redemption is decided by comparing digests rather
 * than by string-comparing a secret read back out of storage.
 *
 * `consumedAt` is the single-use stamp. It is set by a guarded UPDATE whose
 * WHERE clause carries the "not yet consumed, not yet expired" test, so the
 * decision is made by the database's own serialization of writers
 * (`meta.changes === 1`), never by a read followed by a write.
 *
 * The target address is stored in the clear because the link has to be
 * mailed somewhere and the account is created from it on first successful
 * sign-in. Nothing else about the person is here.
 */
export const authMagicLinkTokens = sqliteTable("auth_magic_link_tokens", {
  id: id("id"),
  tokenDigest: text("token_digest").notNull(),
  /** Normalized (trimmed, lowercased) address — the same form users.externalSubject is built from. */
  email: text("email").notNull(),
  createdAt: createdAt(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  consumedAt: integer("consumed_at", { mode: "timestamp_ms" }),
  /** Redemption attempts seen for this digest, successful or not. Bounded evidence of link-guessing, never a token. */
  attemptCount: integer("attempt_count").notNull().default(0),
}, (t) => [
  uniqueIndex("auth_magic_link_tokens_digest_idx").on(t.tokenDigest),
  index("auth_magic_link_tokens_email_idx").on(t.email),
  index("auth_magic_link_tokens_expires_idx").on(t.expiresAt),
  check("auth_magic_link_tokens_attempt_check", sql`${t.attemptCount} >= 0`),
]);

/**
 * Server-side session records. As with the link token, only a digest of the
 * session id the browser holds is stored, so a database read yields nothing
 * that can be presented as a cookie.
 *
 * `expiresAt` is what actually ends a session: the cookie's own Max-Age is a
 * client-side convenience a client can ignore, so every lookup re-checks the
 * server-side expiry (and the owning user's `deletedAt`) before resolving an
 * identity.
 */
export const authSessions = sqliteTable("auth_sessions", {
  id: id("id"),
  sessionDigest: text("session_digest").notNull(),
  userId: text("user_id").notNull().references(() => users.id),
  createdAt: createdAt(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [
  uniqueIndex("auth_sessions_digest_idx").on(t.sessionDigest),
  index("auth_sessions_user_idx").on(t.userId),
  index("auth_sessions_expires_idx").on(t.expiresAt),
]);

/**
 * Fixed-window counters bounding magic-link issuance, deliberately the same
 * shape as preview_guard_windows: a guarded upsert whose WHERE clause holds
 * the limit, so admission is decided by rows-affected on one statement rather
 * than by a read-then-write that two concurrent requests can both pass.
 *
 * `bucketKey` is a one-way digest of what is being limited (an address, or a
 * client signal), never the address or the IP itself.
 */
export const authRateLimits = sqliteTable("auth_rate_limits", {
  bucketKey: text("bucket_key").notNull(),
  windowStart: integer("window_start").notNull(),
  requestCount: integer("request_count").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.bucketKey, t.windowStart] }),
  index("auth_rate_limits_window_idx").on(t.windowStart),
  check("auth_rate_limits_count_check", sql`${t.requestCount} >= 0`),
]);
