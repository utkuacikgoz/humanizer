// M3-03: the access, debit and idempotency decisions for one sentence
// operation on a rewrite the customer already owns.
//
// Extracted from app/api/history/[id]/sentence/route.ts so every branch below
// is driven directly, against a real SQLite database, from
// tests/sentence-operations.test.mts. The route keeps only the lazy
// `db/index` import that needs the Workers runtime; this module must stay
// free of `cloudflare:workers`, `next/headers` and `next/navigation`.
//
// How the acceptance criteria are met, stated where the code is:
//
//   * **Server-owned.** The caller is resolved by resolveSessionUser from a
//     session row (src/lib/identity.ts). Authority to touch a job is
//     established by exactly the pair src/lib/history-access.ts's detail path
//     uses — findHistoryEntryForUser for ownership and a live payload, then
//     getUnlockedResult for ownership plus an active entitlement. Neither is
//     re-implemented here, so a stranger cannot reach another account's
//     sentence for the same reason they cannot read that account's rewrite.
//   * **Protected content survives, and candidates are verified.** Delegated
//     to src/lib/humanization/sentence-regeneration.ts, which returns nothing
//     for a candidate that failed. A rejected candidate is never in a
//     response body and never reaches a revision row.
//   * **Debit.** A successful new candidate commits exactly its own word
//     count. Every other outcome — rejected, unchanged, restored, out of
//     range, over a cap — releases the whole reservation, so the debit is
//     zero. See docs/MONETIZATION.md, "Sentence operations".
//   * **Idempotent.** One operation key names one attempt, in two ledgers at
//     once: `usage_entries.operation_key` (which makes a second reserve a
//     replay and a second commit a no-op) and `sentence_operations.operation_key`
//     (which makes the retry return the first attempt's stored answer rather
//     than generating a second candidate).
//   * **Bounded.** Regeneration attempts are capped per sentence and per job,
//     counted from attempts rather than successes.
import { countWords } from "@/src/lib/humanization/text";
import {
  regenerateSentence,
  restoreSentence,
  sentenceAt,
  sentenceCount,
} from "@/src/lib/humanization/sentence-regeneration";
import type { SentenceRegenerationDeps } from "@/src/lib/humanization/sentence-regeneration";
import { isCrossSiteRequest, once, resolveSessionUser, type SessionPort } from "@/src/lib/identity";
import { isJobIdShape } from "@/src/lib/result-access";
import {
  describePaidUsage,
  releasePaidUsage,
  reserveSentenceUsage,
  type PaidUsageReservation,
  type PaidUsageState,
} from "@/src/lib/paid-usage";
import { commitUsage } from "../../db/usage-ledger";
import type { AppDatabase } from "../../db/repository";
import type { UnlockedResult } from "../../db/billing-repository";
import type { HistoryEntry } from "../../db/history-repository";
import type { SentenceOperationKind, SentenceOperationOutcome, WritingModeValue } from "../../db/schema";
import type { RevisionHead, SentenceOperationRecord } from "../../db/revision-repository";

/**
 * How many times one sentence may be regenerated, and how many regenerations
 * one rewrite may accumulate in total.
 *
 * These bound *attempts*, not successes: a candidate that fails verification
 * still spends a slot. Counting successes instead would leave a free,
 * unmetered generation loop for anyone whose sentence the engine cannot
 * improve — the exact case where a customer is most likely to keep pressing.
 * The per-job cap exists on top because a long document has many sentences,
 * and a per-sentence cap alone bounds nothing at document scale.
 */
export const MAX_REGENERATIONS_PER_SENTENCE = 3;
export const MAX_REGENERATIONS_PER_JOB = 20;

/**
 * Headroom over the target sentence, reserved before the candidate exists.
 *
 * A reservation has to be made before generation, because that is what stops
 * two concurrent operations from overspending one allowance; but the amount
 * actually charged is the candidate's own word count, which is not known yet.
 * So this reserves a bound and the commit releases the difference. Twice the
 * sentence plus eight words comfortably covers a rewrite that expands; a
 * candidate somehow longer than that is charged at the reservation, which is
 * the direction that favours the customer.
 */
export function reservationFor(sentence: string): number {
  return Math.max(1, countWords(sentence) * 2 + 8);
}

/** Bounds one operation's engine time the way /api/humanize bounds a rewrite's. */
const MAX_PROCESSING_MS = 5_000;

const NO_STORE = { "cache-control": "no-store" } as const;
const JSON_HEADERS = { ...NO_STORE, "x-content-type-options": "nosniff" } as const;

const IDEMPOTENCY_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/;

export interface SentenceOperationPorts {
  findHistoryEntryForUser(db: AppDatabase, input: { userId: string; jobId: string }): Promise<HistoryEntry | null>;
  getUnlockedResult(db: AppDatabase, input: { userId: string; jobId: string }): Promise<UnlockedResult | null>;
}

export interface RevisionPort {
  getRevisionHead(db: AppDatabase, jobId: string): Promise<RevisionHead | null>;
  ensureRevisionHead(db: AppDatabase, input: { jobId: string; currentText: string; wordCount: number }): Promise<RevisionHead | null>;
  appendRevision(db: AppDatabase, input: {
    jobId: string;
    parentRevisionId: string;
    revisionType: "sentence_regeneration" | "manual_edit" | "restore";
    text: string;
    successfulWordCount: number;
    sentenceIndex: number;
  }): Promise<string | null>;
  findRevisionText(db: AppDatabase, revisionId: string): Promise<string | null>;
  findSentenceOperation(db: AppDatabase, operationKey: string): Promise<SentenceOperationRecord | null>;
  claimSentenceOperation(db: AppDatabase, input: {
    jobId: string;
    ownerUserId: string;
    operationKey: string;
    sentenceIndex: number;
    kind: SentenceOperationKind;
  }): Promise<boolean>;
  settleSentenceOperation(db: AppDatabase, input: {
    operationKey: string;
    outcome: Exclude<SentenceOperationOutcome, "pending">;
    chargedWords: number;
    revisionId: string | null;
  }): Promise<boolean>;
  countSentenceRegenerations(db: AppDatabase, input: { jobId: string; sentenceIndex?: number }): Promise<number>;
}

export interface SentenceOperationDeps {
  db: AppDatabase;
  billing: Pick<SentenceOperationPorts, "getUnlockedResult">;
  history: Pick<SentenceOperationPorts, "findHistoryEntryForUser">;
  revisions: RevisionPort;
  auth: SessionPort;
  /** Test seam for the engine only; production always uses the real providers. */
  engine?: SentenceRegenerationDeps;
}

export interface SentenceOperationBody {
  jobId: string;
  sentenceIndex: number;
  kind: SentenceOperationKind;
  outcome: "applied" | "unchanged" | "rejected";
  /** The complete rewrite after this operation. Absent when nothing changed. */
  result?: string;
  /** The sentence as it now reads. Absent for a rejected operation. */
  sentence?: string;
  /** Words this operation debited. Zero for anything but an applied regeneration. */
  chargedWords: number;
  /** True when this response replays a previously completed operation. */
  replayed: boolean;
  regenerationsUsedForSentence: number;
  regenerationsUsedForJob: number;
  usage?: PaidUsageState;
}

function error(message: string, status: number, extra: Record<string, unknown> = {}) {
  return Response.json({ error: message, ...extra }, { status, headers: NO_STORE });
}

function notFound() {
  return Response.json({ error: "Rewrite not found." }, { status: 404, headers: NO_STORE });
}

function unavailable() {
  return Response.json(
    { error: "Sentence editing is unavailable right now. Nothing was charged." },
    { status: 503, headers: { ...NO_STORE, "retry-after": "2" } },
  );
}

/**
 * A rejected operation is a 422, matching /api/humanize's "we could not
 * verify this" outcome, and everything else is a 200. The status is derived
 * from the stored outcome and nothing else, so a replay of an operation
 * answers with the status its first attempt did.
 */
function renderBody(body: SentenceOperationBody): Response {
  return Response.json(body, { status: body.outcome === "rejected" ? 422 : 200, headers: JSON_HEADERS });
}

interface ParsedRequest {
  sentenceIndex: number;
  kind: SentenceOperationKind;
  idempotencyKey: string;
}

async function parse(request: Request): Promise<ParsedRequest | Response> {
  // SameSite=Lax already withholds the session cookie from a cross-site POST;
  // this is the second control, and the JSON content type is a third — a
  // cross-site HTML form cannot send one.
  if (isCrossSiteRequest(request)) return error("This request did not come from Ownword.", 403);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return error("Send the request as JSON.", 415);
  }

  const idempotencyKey = request.headers.get("x-idempotency-key")?.trim() ?? "";
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
    return error("Send a valid x-idempotency-key with each sentence request.", 400);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return error("The request body is not valid JSON.", 400);
  }
  if (!payload || typeof payload !== "object") return error("The request body is not valid JSON.", 400);

  const { sentenceIndex, action } = payload as { sentenceIndex?: unknown; action?: unknown };
  if (typeof sentenceIndex !== "number" || !Number.isInteger(sentenceIndex) || sentenceIndex < 0 || sentenceIndex > 5_000) {
    return error("Choose a sentence to change.", 400);
  }
  if (action !== "regenerate" && action !== "restore") return error("Choose a valid sentence action.", 400);

  return { sentenceIndex, kind: action, idempotencyKey };
}

/**
 * The operation key both ledgers share.
 *
 * Built from the server-derived user id and job id plus the client's
 * idempotency key, so one customer's key can never name another customer's
 * operation and a key is scoped to the rewrite it was used on. The sentence
 * index and the action are deliberately NOT in the key: reusing one key for a
 * different sentence must be refused as the mistake it is, not silently
 * treated as a new operation that charges again.
 */
export function sentenceOperationKey(input: { userId: string; jobId: string; idempotencyKey: string }): string {
  return `sentence:${input.userId}:${input.jobId}:${input.idempotencyKey}`;
}

/**
 * POST /api/history/{id}/sentence.
 *
 * Body: `{ "sentenceIndex": number, "action": "regenerate" | "restore" }`,
 * plus an `x-idempotency-key` header. Nothing else in the request is read; in
 * particular no word count, price, allowance or user id is accepted from the
 * client.
 */
export async function buildSentenceOperationResponse(
  request: Request,
  jobId: string,
  loadDeps: () => Promise<SentenceOperationDeps>,
): Promise<Response> {
  if (!isJobIdShape(jobId)) return notFound();
  const parsed = await parse(request);
  if (parsed instanceof Response) return parsed;

  const deps = once(loadDeps);
  let userId: string;
  try {
    const user = await resolveSessionUser(request, deps);
    if (!user) return error("Sign in to change this rewrite.", 401);
    userId = user.userId;
  } catch {
    return unavailable();
  }

  try {
    return await runSentenceOperation(await deps(), { userId, jobId, ...parsed });
  } catch {
    // Includes the D1 binding being unavailable. Never log the error object:
    // a D1/driver error can carry the bound statement parameters, which in
    // this application means the customer's writing.
    return unavailable();
  }
}

async function runSentenceOperation(
  deps: SentenceOperationDeps,
  input: ParsedRequest & { userId: string; jobId: string },
): Promise<Response> {
  const { db, billing, history, revisions } = deps;
  const { userId, jobId, sentenceIndex, kind } = input;
  const operationKey = sentenceOperationKey({ userId, jobId, idempotencyKey: input.idempotencyKey });

  // Ownership, deletion state, and the writing mode this job was produced in.
  const entry = await history.findHistoryEntryForUser(db, { userId, jobId });
  if (!entry) return notFound();
  // Ownership again, this time with the active-entitlement requirement. A
  // lapsed subscriber owns their rewrite and may delete it, but may not spend
  // an allowance they no longer have.
  const unlocked = await billing.getUnlockedResult(db, { userId, jobId });
  if (!unlocked) return Response.json({ error: "Rewrite not found.", locked: true }, { status: 404, headers: NO_STORE });

  // --- Idempotent replay -------------------------------------------------
  const existing = await revisions.findSentenceOperation(db, operationKey);
  if (existing) {
    if (existing.sentenceIndex !== sentenceIndex || existing.kind !== kind) {
      return error("That idempotency key was already used for a different change.", 409);
    }
    if (existing.outcome === "pending") {
      return error("That change is still being applied. Try again in a moment.", 409, { pending: true });
    }
    return renderBody(await describe(deps, { userId, jobId, record: existing, replayed: true }));
  }

  // --- Bounds ------------------------------------------------------------
  const [usedForSentence, usedForJob] = await Promise.all([
    revisions.countSentenceRegenerations(db, { jobId, sentenceIndex }),
    revisions.countSentenceRegenerations(db, { jobId }),
  ]);
  if (kind === "regenerate") {
    if (usedForSentence >= MAX_REGENERATIONS_PER_SENTENCE) {
      return error(
        `Each sentence can be regenerated ${MAX_REGENERATIONS_PER_SENTENCE} times, and this one has had them. Nothing was charged.`,
        429,
        { limit: "sentence", regenerationsUsedForSentence: usedForSentence, regenerationsUsedForJob: usedForJob },
      );
    }
    if (usedForJob >= MAX_REGENERATIONS_PER_JOB) {
      return error(
        `Up to ${MAX_REGENERATIONS_PER_JOB} sentences can be regenerated in one rewrite, and this one has had them. Nothing was charged.`,
        429,
        { limit: "job", regenerationsUsedForSentence: usedForSentence, regenerationsUsedForJob: usedForJob },
      );
    }
  }

  // --- The text this operation starts from -------------------------------
  const head = await revisions.ensureRevisionHead(db, {
    jobId,
    currentText: unlocked.result,
    wordCount: entry.successfulWordCount ?? countWords(unlocked.result),
  });
  if (!head) return unavailable();
  const currentText = head.text;
  const target = sentenceAt(currentText, sentenceIndex);
  if (!target) {
    return error(`This rewrite has ${sentenceCount(currentText)} sentences.`, 404, { sentenceCount: sentenceCount(currentText) });
  }

  // --- Restore: free, and it generates nothing ---------------------------
  if (kind === "restore") {
    if (!await revisions.claimSentenceOperation(db, { jobId, ownerUserId: userId, operationKey, sentenceIndex, kind })) {
      return error("That change is already being applied. Try again in a moment.", 409, { pending: true });
    }
    const restored = restoreSentence({ text: currentText, original: unlocked.original, sentenceIndex });
    const revisionId = restored.status === "applied"
      ? await revisions.appendRevision(db, {
          jobId,
          parentRevisionId: head.revisionId,
          revisionType: "restore",
          text: restored.text,
          successfulWordCount: 0,
          sentenceIndex,
        })
      : null;
    const outcome = restored.status === "applied" && !revisionId ? "rejected" : restored.status;
    await revisions.settleSentenceOperation(db, { operationKey, outcome, chargedWords: 0, revisionId });
    return renderBody(await describe(deps, {
      userId,
      jobId,
      record: { operationKey, jobId, sentenceIndex, kind, outcome, chargedWords: 0, revisionId },
      replayed: false,
    }));
  }

  // --- Regenerate: reserve, claim, generate, settle -----------------------
  //
  // The reservation is taken before the attempt row so that a customer who is
  // out of allowance is refused without spending one of their regenerations
  // on a sentence the engine never looked at. The ledger's own replay
  // semantics make a re-reserve under the same key harmless.
  const admission = await reserveSentenceUsage(db, { userId, operationKey, words: reservationFor(target.text) });
  if (admission.kind === "not-entitled") {
    return Response.json({ error: "Rewrite not found.", locked: true }, { status: 404, headers: NO_STORE });
  }
  if (admission.kind === "quota-exceeded") {
    return error("You have used this month's word allowance.", 429, {
      limit: "allowance",
      usage: {
        consumed: admission.consumed,
        allowance: admission.allowance,
        remaining: admission.remaining,
        periodEnd: admission.periodEnd.toISOString(),
      },
    });
  }
  const reservation: PaidUsageReservation = admission.reservation;

  if (!await revisions.claimSentenceOperation(db, { jobId, ownerUserId: userId, operationKey, sentenceIndex, kind })) {
    // Another request holding the same key claimed it first; this one has
    // generated nothing, so it owes nothing and must not settle the row.
    return error("That change is already being applied. Try again in a moment.", 409, { pending: true });
  }

  let outcome: "applied" | "unchanged" | "rejected" = "rejected";
  let chargedWords = 0;
  let revisionId: string | null = null;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Sentence deadline exceeded.", "TimeoutError")),
    MAX_PROCESSING_MS,
  );
  try {
    const regenerated = await regenerateSentence({
      text: currentText,
      sentenceIndex,
      mode: entry.mode as WritingModeValue,
      protectedValues: unlocked.protectedItems,
      signal: controller.signal,
    }, deps.engine);

    if (regenerated.status === "applied") {
      revisionId = await revisions.appendRevision(db, {
        jobId,
        parentRevisionId: head.revisionId,
        revisionType: "sentence_regeneration",
        text: regenerated.text,
        successfulWordCount: regenerated.words,
        sentenceIndex,
      });
      // The revision write is not best-effort here, unlike the history write
      // on /api/humanize: this IS the deliverable, and a customer must not be
      // charged for a new sentence that was not stored.
      if (revisionId) {
        outcome = "applied";
        chargedWords = regenerated.words;
      }
    } else if (regenerated.status === "unchanged") {
      outcome = "unchanged";
    }
  } catch {
    // Timeout, abort, or a provider that threw past its own guard. Nothing
    // verified, so nothing is charged and nothing is returned.
    outcome = "rejected";
  } finally {
    clearTimeout(timeout);
  }

  if (outcome === "applied") {
    // Commit exactly the candidate's words; the ledger releases the rest of
    // the reservation in the same call.
    await commitUsage(db, { operationKey: reservation.operationKey, successfulWords: chargedWords });
  } else {
    await releasePaidUsage(db, reservation);
  }
  await revisions.settleSentenceOperation(db, { operationKey, outcome, chargedWords, revisionId });

  return renderBody(await describe(deps, {
    userId,
    jobId,
    record: { operationKey, jobId, sentenceIndex, kind, outcome, chargedWords, revisionId },
    replayed: false,
  }));
}

/**
 * Builds the response body from the stored record, for a first attempt and a
 * replay alike, so a retry cannot differ from the answer it is repeating.
 * The allowance figures are read from the ledger rather than carried out of a
 * reservation, for the same reason.
 */
async function describe(
  deps: SentenceOperationDeps,
  input: { userId: string; jobId: string; record: SentenceOperationRecord; replayed: boolean },
): Promise<SentenceOperationBody> {
  const { db, revisions } = deps;
  const { record } = input;
  const outcome = record.outcome === "pending" ? "rejected" : record.outcome;

  const [text, usage, usedForSentence, usedForJob] = await Promise.all([
    record.revisionId ? revisions.findRevisionText(db, record.revisionId) : Promise.resolve(null),
    describePaidUsage(db, input.userId),
    revisions.countSentenceRegenerations(db, { jobId: input.jobId, sentenceIndex: record.sentenceIndex }),
    revisions.countSentenceRegenerations(db, { jobId: input.jobId }),
  ]);

  const sentence = text ? sentenceAt(text, record.sentenceIndex)?.text : undefined;
  return {
    jobId: input.jobId,
    sentenceIndex: record.sentenceIndex,
    kind: record.kind,
    outcome,
    // An empty string is what a purge leaves in a revision, so it is reported
    // as "no text" rather than as an empty rewrite.
    ...(text ? { result: text, sentence } : {}),
    chargedWords: record.chargedWords,
    replayed: input.replayed,
    regenerationsUsedForSentence: usedForSentence,
    regenerationsUsedForJob: usedForJob,
    ...(usage ? { usage } : {}),
  };
}
