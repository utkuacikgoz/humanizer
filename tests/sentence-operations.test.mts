// M3-03 — sentence restore/regeneration.
//
// The acceptance criterion is a set of properties about money, authorization
// and repetition ("Sentence operations preserve protected content, verify new
// candidates, debit only successful newly generated words under documented
// policy, and are idempotent"), so these drive the exact function
// app/api/history/[id]/sentence/route.ts delegates to, against a real SQLite
// database built from the shipped migrations.
import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import * as auth from "../db/auth-repository";
import * as billing from "../db/billing-repository";
import * as history from "../db/history-repository";
import * as revisions from "../db/revision-repository";
import { persistHumanizationJob } from "../db/repository";
import * as schema from "../db/schema";
import { describePaidUsage } from "../src/lib/paid-usage";
import { countWords } from "../src/lib/humanization/text";
import {
  protectedValuesSurvive,
  regenerateSentence,
  segmentSentences,
} from "../src/lib/humanization/sentence-regeneration";
import {
  MAX_REGENERATIONS_PER_JOB,
  MAX_REGENERATIONS_PER_SENTENCE,
  buildSentenceOperationResponse,
  reservationFor,
  type SentenceOperationBody,
} from "../src/lib/sentence-operations";
import type { SentenceRegenerationDeps } from "../src/lib/humanization/sentence-regeneration";
import { createTestDatabase } from "./helpers/sqlite-db.mjs";
import { sessionHeaders, signIn } from "./helpers/session.mjs";
import type { AppDatabase } from "../db/repository";

const PROTECTED = ["Dr. Elena Marsh", "42%", "2024", "$1.2 million", "Acme Corp."];

const ORIGINAL =
  "Dr. Elena Marsh reported that revenue grew 42% in 2024. "
  + "In today's fast-paced world, the team will leverage a robust solution to drive value at scale for Acme Corp. "
  + "The board approved $1.2 million for the next phase.";

/** The stored rewrite the customer is looking at when they ask for one sentence again. */
const REWRITE =
  "Dr. Elena Marsh reported that revenue grew 42% in 2024. "
  + "The team will leverage a robust solution to drive value at scale for Acme Corp. "
  + "The board approved $1.2 million for the next phase.";

/** Index 1 of REWRITE: the sentence every test below asks to change. */
const TARGET_INDEX = 1;

function jobInput(original: string, result: string) {
  return {
    mode: "natural" as const,
    clientFingerprint: `client-${crypto.randomUUID()}`,
    idempotencyKey: crypto.randomUUID(),
    contentFingerprint: "content-fp",
    inputWordCount: countWords(original),
    successfulWordCount: countWords(result),
    pipelineVersion: 1,
    original,
    result,
    protectedContent: [
      { id: "p1", kind: "person", normalizedValue: "Dr. Elena Marsh", start: 0, end: 15 },
    ],
    previewProjection: {
      preview: "Dr. Elena Marsh reported that revenue grew 42% in 2024.",
      hiddenWordCount: 20,
      issuesImproved: 3,
      naturalness: "Strong" as const,
      meaningPreservation: "High" as const,
      protectedItems: PROTECTED,
    },
  };
}

async function digestOf(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function grantEntitlement(db: AppDatabase, userId: string, subscriptionId: string) {
  await billing.upsertSubscriptionFromStripe(db, {
    userId,
    stripeCustomerId: `cus_${userId}`,
    stripeSubscriptionId: subscriptionId,
    planId: "starter",
    catalogVersion: 1,
    status: "active",
    currentPeriodStart: new Date(Date.now() - 1_000),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    cancelAtPeriodEnd: false,
    lastStripeEventId: "evt_seed",
  });
}

/** An owner with an entitled, owned rewrite, plus an equally entitled stranger. */
async function scenario(original = ORIGINAL, rewrite = REWRITE) {
  const db = await createTestDatabase();
  const job = await persistHumanizationJob(db, jobInput(original, rewrite));

  const owner = await billing.getOrCreateUserByExternalSubject(db, { externalSubject: "owner", email: null });
  const stranger = await billing.getOrCreateUserByExternalSubject(db, { externalSubject: "stranger", email: null });
  await signIn(db, "owner");
  await signIn(db, "stranger");

  await billing.claimJobForUser(db, { capabilityDigest: await digestOf(job.capabilityToken), userId: owner.userId });
  await grantEntitlement(db, owner.userId, "sub_owner");
  await grantEntitlement(db, stranger.userId, "sub_stranger");

  return { db, jobId: job.jobId, owner, stranger };
}

function deps(db: AppDatabase, engine?: SentenceRegenerationDeps) {
  return async () => ({ db, billing, history, revisions, auth, engine });
}

interface OperationOptions {
  subject?: string;
  key?: string;
  action?: "regenerate" | "restore";
  sentenceIndex?: number;
  engine?: SentenceRegenerationDeps;
}

function operate(db: AppDatabase, jobId: string, options: OperationOptions = {}) {
  const key = options.key ?? "sentence-op-0001";
  return buildSentenceOperationResponse(
    new Request(`http://localhost/api/history/${jobId}/sentence`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": key,
        ...sessionHeaders(options.subject ?? "owner"),
      },
      body: JSON.stringify({
        sentenceIndex: options.sentenceIndex ?? TARGET_INDEX,
        action: options.action ?? "regenerate",
      }),
    }),
    jobId,
    deps(db, options.engine),
  );
}

async function body(response: Response): Promise<SentenceOperationBody> {
  return (await response.json()) as SentenceOperationBody;
}

async function consumedWords(db: AppDatabase, userId: string): Promise<number> {
  const usage = await describePaidUsage(db, userId);
  assert.ok(usage, "the seeded account should have an active entitlement");
  return usage.consumed;
}

/** A provider whose candidate drops the protected company name from the sentence. */
const damagingEngine: SentenceRegenerationDeps = {
  humanizationProvider: {
    name: "test-damaging",
    async rewrite() {
      return {
        text: "The team will use a reliable approach to help across the organization.",
        estimatedTokens: 0,
        estimatedCostUsd: 0,
      };
    },
  },
};

// ---------------------------------------------------------------------
// Segmentation: an index has to name the text it appears to name
// ---------------------------------------------------------------------

test("sentence segmentation keeps abbreviations whole and never drops text", () => {
  const sentences = segmentSentences(REWRITE);
  assert.equal(sentences.length, 3);
  assert.ok(sentences[0].text.startsWith("Dr. Elena Marsh"), "a title must not end a sentence");
  assert.ok(sentences[1].text.endsWith("for Acme Corp."), "a trailing abbreviation before a capital does end one");
  assert.ok(sentences[2].text.includes("$1.2 million"), "a decimal must not split, and must not vanish");

  // Totality: every non-space character of the document is inside some sentence.
  const covered = sentences.map((sentence) => REWRITE.slice(sentence.start, sentence.end)).join("");
  assert.equal(covered.replace(/\s+/g, ""), REWRITE.replace(/\s+/g, ""));
});

// ---------------------------------------------------------------------
// Protected content survives, and candidates are verified
// ---------------------------------------------------------------------

test("a regenerated sentence preserves every protected value in the document", async () => {
  const { db, jobId } = await scenario();

  const result = await body(await operate(db, jobId));
  assert.equal(result.outcome, "applied");
  assert.ok(result.result, "an applied operation returns the whole rewrite");
  for (const value of PROTECTED) {
    assert.ok(result.result.includes(value), `protected value ${value} disappeared`);
  }
  assert.notEqual(result.sentence, segmentSentences(REWRITE)[TARGET_INDEX].text);
  assert.ok(result.sentence?.includes("Acme Corp."), "protected content inside the target sentence must survive");
});

test("the engine refuses a candidate that drops protected content", async () => {
  const outcome = await regenerateSentence(
    { text: REWRITE, sentenceIndex: TARGET_INDEX, mode: "natural", protectedValues: PROTECTED },
    damagingEngine,
  );
  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.status === "rejected" ? outcome.reason : null, "verification-failed");
});

test("protectedValuesSurvive counts occurrences, not mere presence", () => {
  assert.equal(protectedValuesSurvive("42% then 42%", "42% then 42%", ["42%"]), true);
  assert.equal(protectedValuesSurvive("42% then 42%", "42% only", ["42%"]), false);
  assert.equal(protectedValuesSurvive("nothing here", "nothing here", ["42%"]), true);
});

// ---------------------------------------------------------------------
// Debit policy
// ---------------------------------------------------------------------

test("a rejected candidate is not returned and charges nothing", async () => {
  const { db, jobId, owner } = await scenario();
  assert.equal(await consumedWords(db, owner.userId), 0);

  const response = await operate(db, jobId, { engine: damagingEngine });
  assert.equal(response.status, 422);

  const result = await body(response);
  assert.equal(result.outcome, "rejected");
  assert.equal(result.chargedWords, 0);
  assert.equal(result.result, undefined, "a rejected candidate must never reach the response");
  assert.equal(await consumedWords(db, owner.userId), 0);

  // The reservation was released, not merely never committed.
  const entries = await db.select().from(schema.usageEntries);
  assert.deepEqual(entries.map((entry) => entry.entryType).sort(), ["release", "reservation"]);
});

test("a successful candidate charges exactly its own words", async () => {
  const { db, jobId, owner } = await scenario();

  const result = await body(await operate(db, jobId));
  assert.equal(result.outcome, "applied");
  assert.ok(result.sentence);
  assert.equal(result.chargedWords, countWords(result.sentence));
  assert.equal(await consumedWords(db, owner.userId), result.chargedWords);

  // The reservation is headroom taken before the candidate existed; the
  // commit is the candidate, and the difference goes back.
  const target = segmentSentences(REWRITE)[TARGET_INDEX].text;
  assert.ok(reservationFor(target) > result.chargedWords);
  const [commit] = await db
    .select()
    .from(schema.usageEntries)
    .where(eq(schema.usageEntries.entryType, "commit"));
  assert.equal(commit.successfulWords, result.chargedWords);
});

test("a candidate the engine cannot improve on charges nothing", async () => {
  const { db, jobId, owner } = await scenario();

  const first = await body(await operate(db, jobId, { key: "sentence-op-0001" }));
  assert.equal(first.outcome, "applied");
  const chargedOnce = await consumedWords(db, owner.userId);

  const second = await body(await operate(db, jobId, { key: "sentence-op-0002" }));
  assert.equal(second.outcome, "unchanged");
  assert.equal(second.chargedWords, 0);
  assert.equal(await consumedWords(db, owner.userId), chargedOnce);
});

// ---------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------

test("a retry under the same operation key returns the same result and charges once", async () => {
  const { db, jobId, owner } = await scenario();

  const first = await body(await operate(db, jobId, { key: "sentence-retry-01" }));
  assert.equal(first.outcome, "applied");
  assert.equal(first.replayed, false);
  const chargedOnce = await consumedWords(db, owner.userId);
  assert.equal(chargedOnce, first.chargedWords);

  const retry = await body(await operate(db, jobId, { key: "sentence-retry-01" }));
  assert.equal(retry.replayed, true);
  assert.equal(retry.outcome, first.outcome);
  assert.equal(retry.result, first.result);
  assert.equal(retry.sentence, first.sentence);
  assert.equal(retry.chargedWords, first.chargedWords);
  assert.equal(await consumedWords(db, owner.userId), chargedOnce);

  // One attempt row, one commit row: the retry generated nothing.
  const operations = await db.select().from(schema.sentenceOperations);
  assert.equal(operations.length, 1);
  const commits = await db
    .select()
    .from(schema.usageEntries)
    .where(eq(schema.usageEntries.entryType, "commit"));
  assert.equal(commits.length, 1);
});

test("reusing an operation key for a different sentence is refused, not silently recharged", async () => {
  const { db, jobId, owner } = await scenario();

  await operate(db, jobId, { key: "sentence-reuse-01" });
  const charged = await consumedWords(db, owner.userId);

  const response = await operate(db, jobId, { key: "sentence-reuse-01", sentenceIndex: 2 });
  assert.equal(response.status, 409);
  assert.equal(await consumedWords(db, owner.userId), charged);
});

// ---------------------------------------------------------------------
// Restore is free
// ---------------------------------------------------------------------

test("restoring the original sentence costs nothing and returns the customer's own words", async () => {
  const { db, jobId, owner } = await scenario();

  const regenerated = await body(await operate(db, jobId, { key: "sentence-restore-a" }));
  assert.equal(regenerated.outcome, "applied");
  const chargedForRegeneration = await consumedWords(db, owner.userId);

  const restored = await body(await operate(db, jobId, {
    key: "sentence-restore-b",
    action: "restore",
  }));
  assert.equal(restored.outcome, "applied");
  assert.equal(restored.chargedWords, 0);
  assert.equal(restored.sentence, segmentSentences(ORIGINAL)[TARGET_INDEX].text);
  assert.equal(await consumedWords(db, owner.userId), chargedForRegeneration);

  // A restore takes no reservation at all, so it cannot leave one behind.
  const entries = await db.select().from(schema.usageEntries);
  assert.ok(entries.every((entry) => !entry.operationKey.endsWith("sentence-restore-b")));
});

test("a restore does not spend a regeneration allowance", async () => {
  const { db, jobId } = await scenario();

  const restored = await body(await operate(db, jobId, { key: "restore-only-01", action: "restore" }));
  assert.equal(restored.outcome, "applied");
  assert.equal(restored.regenerationsUsedForSentence, 0);
  assert.equal(restored.regenerationsUsedForJob, 0);
});

// ---------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------

test("the per-sentence cap refuses regeneration beyond the bound", async () => {
  const { db, jobId, owner } = await scenario();

  for (let attempt = 1; attempt <= MAX_REGENERATIONS_PER_SENTENCE; attempt += 1) {
    const response = await operate(db, jobId, { key: `sentence-cap-00${attempt}` });
    assert.ok(response.status === 200 || response.status === 422, `attempt ${attempt} should be allowed`);
  }
  const chargedBefore = await consumedWords(db, owner.userId);

  const refused = await operate(db, jobId, { key: "sentence-cap-over" });
  assert.equal(refused.status, 429);
  assert.equal((await refused.json() as { limit?: string }).limit, "sentence");
  assert.equal(await consumedWords(db, owner.userId), chargedBefore, "a refused request charges nothing");
});

test("the per-job cap refuses regeneration beyond the bound", async () => {
  const filler = Array.from(
    { length: 12 },
    (_, index) => `Team ${index} will leverage a robust solution to drive value at scale.`,
  ).join(" ");
  const { db, jobId, owner } = await scenario(filler, filler);

  let attempts = 0;
  let sentenceIndex = 0;
  while (attempts < MAX_REGENERATIONS_PER_JOB) {
    for (let n = 0; n < MAX_REGENERATIONS_PER_SENTENCE && attempts < MAX_REGENERATIONS_PER_JOB; n += 1) {
      const response = await operate(db, jobId, { key: `job-cap-${attempts.toString().padStart(4, "0")}`, sentenceIndex });
      assert.notEqual(response.status, 429, `attempt ${attempts} should be within both caps`);
      attempts += 1;
    }
    sentenceIndex += 1;
  }
  const chargedBefore = await consumedWords(db, owner.userId);

  // A sentence with regenerations still to spare, on a job that has none.
  const refused = await operate(db, jobId, { key: "job-cap-over-01", sentenceIndex: sentenceIndex });
  assert.equal(refused.status, 429);
  assert.equal((await refused.json() as { limit?: string }).limit, "job");
  assert.equal(await consumedWords(db, owner.userId), chargedBefore);
});

// ---------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------

test("another entitled user cannot regenerate someone else's sentence", async () => {
  const { db, jobId, stranger } = await scenario();

  const response = await operate(db, jobId, { subject: "stranger", key: "stranger-op-001" });
  assert.equal(response.status, 404);
  assert.equal(await consumedWords(db, stranger.userId), 0);
  assert.equal((await db.select().from(schema.sentenceOperations)).length, 0);
  assert.equal((await db.select().from(schema.resultRevisions)).length, 0);
});

test("a signed-out caller is asked to sign in and changes nothing", async () => {
  const { db, jobId } = await scenario();

  const response = await buildSentenceOperationResponse(
    new Request(`http://localhost/api/history/${jobId}/sentence`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-idempotency-key": "anonymous-001" },
      body: JSON.stringify({ sentenceIndex: TARGET_INDEX, action: "regenerate" }),
    }),
    jobId,
    deps(db),
  );
  assert.equal(response.status, 401);
  assert.equal((await db.select().from(schema.sentenceOperations)).length, 0);
});

test("an owner without an active entitlement cannot spend one", async () => {
  const { db, jobId, owner } = await scenario();
  await db
    .update(schema.subscriptions)
    .set({ status: "canceled" })
    .where(eq(schema.subscriptions.userId, owner.userId));

  const response = await operate(db, jobId, { key: "lapsed-owner-001" });
  assert.equal(response.status, 404);
  assert.equal((await response.json() as { locked?: boolean }).locked, true);
  assert.equal((await db.select().from(schema.sentenceOperations)).length, 0);
});

// ---------------------------------------------------------------------
// The revision a sentence operation writes is deleted with the rewrite
// ---------------------------------------------------------------------

test("deleting the rewrite voids the text held in its revisions", async () => {
  const { db, jobId, owner } = await scenario();

  const applied = await body(await operate(db, jobId, { key: "delete-me-0001" }));
  assert.equal(applied.outcome, "applied");
  const before = await db.select().from(schema.resultRevisions);
  assert.ok(before.length >= 2, "an applied operation leaves an original and a derived revision");
  assert.ok(before.some((revision) => revision.resultRef.includes("Acme Corp.")));

  assert.equal(await history.deleteHistoryEntryForUser(db, { userId: owner.userId, jobId }), "deleted");

  const after = await db.select().from(schema.resultRevisions);
  assert.ok(after.every((revision) => revision.resultRef === ""), "no revision may outlive the payload it came from");
});
