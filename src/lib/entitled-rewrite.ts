// Completing one entitled (paid) humanization: commit usage, then record the
// rewrite in the owner's history (M3-01 persistence).
//
// Before this module existed, an entitled request returned the whole rewrite
// and wrote no job row at all — `owner_user_id` was only ever set by
// db/billing-repository.ts's claimJobForUser during checkout. A subscriber's
// day-to-day rewrites therefore never reached /history, which made the paid
// history surface honest but empty. Everything a paid rewrite needs after the
// pipeline succeeds lives here so it is directly testable under plain Node:
// this module must stay free of `cloudflare:workers`, `next/headers` and
// `next/navigation` (app/api/humanize/route.ts keeps the lazy `db/index`
// import that needs the Workers runtime).
//
// Two rules shape the code below, and neither is a style preference:
//
//   1. Persistence is a convenience, never part of the paid guarantee. The
//      customer has already been charged for words that came back; if the
//      history write fails, they still get their complete rewrite and the
//      ledger is left exactly as committed. We do not release, re-charge, or
//      500 over a history row.
//   2. A retried request must not produce a second history row. The guard is
//      the identity the ledger operation key is already built from — the
//      owner plus the request's idempotency key — enforced inside the single
//      guarded INSERT in db/repository.ts and decided on rows-affected, never
//      on a read-then-write.
import { projectPreview } from "@/src/lib/preview-projection";
import { countWords } from "@/src/lib/humanization/text";
import { commitPaidUsage } from "@/src/lib/paid-usage";
import type { PaidUsageReservation } from "@/src/lib/paid-usage";
import { claimOperationForJob } from "../../db/usage-ledger";
import { persistHumanizationJob } from "../../db/repository";
import type { AppDatabase, PersistJobAttribution, PersistJobInput, PersistProtectedItem, PersistedOwnedJob, PreviewProjection } from "../../db/repository";
import type { WritingModeValue } from "../../db/schema";

/** The already-derived, approved-for-display evidence for one rewrite. */
export interface EntitledRewriteEvidence {
  issuesImproved: number;
  naturalness: "Strong" | "Good";
  meaningPreservation: "High" | "Review needed";
  protectedItems: string[];
}

export interface EntitledRewriteInput {
  mode: WritingModeValue;
  /** Already-hashed request-guard client signal; never a raw IP/cookie. */
  clientFingerprint: string;
  idempotencyKey: string;
  contentFingerprint: string;
  pipelineVersion: number;
  original: string;
  result: string;
  inputWordCount: number;
  successfulWordCount: number;
  protectedContent: PersistProtectedItem[];
  evidence: EntitledRewriteEvidence;
  /** Which provider and model produced this, and what it cost. Content-free. */
  attribution?: PersistJobAttribution;
}

/** Exactly what /api/humanize returns for an entitled rewrite. */
export interface EntitledRewritePayload {
  original: string;
  result: string;
  paid: true;
  issuesImproved: number;
  naturalness: "Strong" | "Good";
  meaningPreservation: "High" | "Review needed";
  protectedItems: string[];
  usage: { consumed: number; allowance: number; remaining: number; periodEnd: string; paidUseCount: number };
}

/**
 * Seams for tests only. Production always uses the real writer; the injected
 * one exists so a payload-write failure can be proven not to cost the
 * customer their rewrite.
 */
export interface EntitledRewriteDeps {
  persistJob?: (db: AppDatabase, input: PersistJobInput & { ownerUserId: string }) => Promise<PersistedOwnedJob>;
  linkOperation?: (db: AppDatabase, input: { operationKey: string; jobId: string }) => Promise<boolean>;
  /** Content-free notice that history persistence did not happen. */
  onPersistenceSkipped?: (reason: "already-recorded" | "write-failed") => void;
}

/** Words of the rewrite shown in a history list row when nothing was withheld. */
const OWNED_PREVIEW_WORDS = 40;

/**
 * The list-row projection stored for an owned job.
 *
 * For an owned job this is not a paywall decision — the owner already holds
 * the full text, and db/history-repository.ts only ever renders these fields
 * in a list. It is still a truncated projection rather than the whole
 * rewrite, because the full result belongs in job_payloads.resultRef alone
 * (db/schema.ts) and the detail path releases it under its own entitlement
 * check. `projectPreview` is reused where it applies so a history row reads
 * like the preview the same rewrite would have produced; a rewrite too short
 * for a sentence-boundary split falls back to a word cap rather than being
 * stored with no projection at all, which would make the item invisible in
 * history (see history-repository's `toEntry`).
 */
export function ownedPreviewProjection(resultText: string, evidence: EntitledRewriteEvidence): PreviewProjection {
  const split = projectPreview(resultText);
  if (split.paywallable) {
    return { preview: split.preview, hiddenWordCount: split.hiddenWordCount, ...evidence };
  }
  const words = resultText.trim().split(/\s+/).filter(Boolean);
  const visible = words.slice(0, OWNED_PREVIEW_WORDS);
  return {
    preview: visible.join(" "),
    hiddenWordCount: Math.max(0, countWords(resultText) - visible.length),
    ...evidence,
  };
}

/**
 * Best-effort owned persistence. Returns the job id when a history row was
 * written, or null when one already exists for this operation or the write
 * failed. Never throws.
 */
async function recordOwnedJob(
  db: AppDatabase,
  reservation: PaidUsageReservation,
  input: EntitledRewriteInput,
  deps: EntitledRewriteDeps,
): Promise<string | null> {
  const persistJob = deps.persistJob ?? persistHumanizationJob;
  const linkOperation = deps.linkOperation ?? claimOperationForJob;

  try {
    const persisted = await persistJob(db, {
      // Server-derived, from the entitlement the reservation was made
      // against. Nothing here comes from the request body or a header the
      // client controls.
      ownerUserId: reservation.userId,
      mode: input.mode,
      clientFingerprint: input.clientFingerprint,
      idempotencyKey: input.idempotencyKey,
      contentFingerprint: input.contentFingerprint,
      inputWordCount: input.inputWordCount,
      successfulWordCount: input.successfulWordCount,
      pipelineVersion: input.pipelineVersion,
      original: input.original,
      result: input.result,
      protectedContent: input.protectedContent,
      previewProjection: ownedPreviewProjection(input.result, input.evidence),
      ...(input.attribution ? { attribution: input.attribution } : {}),
    });

    // The guarded insert refused: this owner already has a row for this
    // idempotency key, i.e. the same operation. A retry reaching here is the
    // expected outcome, not a failure.
    if (!persisted.recorded) {
      deps.onPersistenceSkipped?.("already-recorded");
      return null;
    }

    // Bookkeeping only, and last because of the foreign key: point the
    // operation's commit ledger row at the history row it produced. Losing
    // this attach changes nothing the customer can see.
    await linkOperation(db, { operationKey: reservation.operationKey, jobId: persisted.jobId });
    return persisted.jobId;
  } catch {
    // Deliberately reported without the error object. D1/driver errors can
    // carry bound statement parameters — the customer's source and result
    // text — in their message/cause chain, and logging those would violate
    // the no-sensitive-logging control in docs/SECURITY.md. The reason code
    // is enough to alert on.
    deps.onPersistenceSkipped?.("write-failed");
    return null;
  }
}

/**
 * Commits the usage for a succeeded entitled rewrite, records it in the
 * owner's history, and returns the complete rewrite.
 *
 * Only the commit can fail this function. It is awaited outside the
 * persistence try/catch on purpose: a ledger commit that does not land is a
 * billing-correctness problem the caller must handle (it releases the
 * reservation and reports an error), whereas a history row that does not
 * land is not.
 */
export async function completeEntitledRewrite(
  db: AppDatabase,
  reservation: PaidUsageReservation,
  input: EntitledRewriteInput,
  deps: EntitledRewriteDeps = {},
): Promise<EntitledRewritePayload> {
  const usage = await commitPaidUsage(db, reservation, input.successfulWordCount);
  await recordOwnedJob(db, reservation, input, deps);
  return {
    original: input.original,
    result: input.result,
    paid: true,
    ...input.evidence,
    usage,
  };
}
