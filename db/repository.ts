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
import { eq } from "drizzle-orm";
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
}

export interface PersistedJob {
  jobId: string;
  capabilityToken: string;
  capabilityExpiresAt: Date;
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
export async function persistHumanizationJob(db: AppDatabase, input: PersistJobInput): Promise<PersistedJob> {
  const now = new Date();
  const jobId = crypto.randomUUID();
  const capabilityToken = await randomCapabilityToken();
  const capabilityDigest = await digestCapabilityToken(capabilityToken);
  const capabilityExpiresAt = new Date(now.getTime() + (input.capabilityTtlMs ?? DEFAULT_CAPABILITY_TTL_MS));

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

  await db.insert(anonymousSessions).values({
    id: crypto.randomUUID(),
    jobId,
    capabilityDigest,
    createdAt: now,
    expiresAt: capabilityExpiresAt,
  });

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
