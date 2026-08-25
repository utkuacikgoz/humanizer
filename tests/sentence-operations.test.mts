// M3-03 — sentence restore and regeneration.
//
// The acceptance criteria are behavioural properties, not shapes: "preserve
// protected content, verify new candidates, debit only successful newly
// generated words under documented policy, and are idempotent". So these
// drive the exact function app/api/history/[id]/sentence/route.ts delegates
// to, against a real SQLite database and a real ledger, rather than a
// re-implementation of either.
//
// The engine is injected only where a test needs a deterministic candidate.
// The default path runs the real provider chain, so a change that breaks
// verification fails here rather than passing against a stub.
import assert from "node:assert/strict";
import test from "node:test";
import * as auth from "../db/auth-repository";
import * as billing from "../db/billing-repository";
import * as history from "../db/history-repository";
import * as revisions from "../db/revision-repository";
import { persistHumanizationJob } from "../db/repository";
import { getConsumedWords } from "../db/usage-ledger";
import * as schema from "../db/schema";
import { segmentSentences } from "../src/lib/humanization/sentence-regeneration";
import {
  buildSentenceOperationResponse,
  MAX_REGENERATIONS_PER_JOB,
  MAX_REGENERATIONS_PER_SENTENCE,
  type SentenceOperationBody,
} from "../src/lib/sentence-operations";
import { createTestDatabase } from "./helpers/sqlite-db.mjs";
import { sessionHeaders, signIn } from "./helpers/session.mjs";
import type { AppDatabase } from "../db/repository";

// Three sentences, one protected person in the middle one. The middle
// sentence is the target throughout: regenerating it must never lose the name.
const RESULT =
  "The team shipped the release on schedule. " +
  "Dr. Elena Marsh reviewed the findings and it is important to note that the results were robust. " +
  "The board approved the next phase.";
const ORIGINAL =
  "The team shipped the release on schedule. " +
  "Dr. Elena Marsh reviewed the findings, and it is important to note that the results were, in fact, robust. " +
  "The board approved the next phase.";
const PROTECTED = "Dr. Elena Marsh";
const TARGET = 1;

async function digestOf(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function jobInput() {
  return {
    mode: "natural" as const,
    clientFingerprint: `client-${crypto.randomUUID()}`,
    idempotencyKey: crypto.randomUUID(),
    contentFingerprint: "content-fp",
    inputWordCount: 40,
    successfulWordCount: 38,
    pipelineVersion: 1,
    original: ORIGINAL,
    result: RESULT,
    protectedContent: [
      { id: "p1", kind: "person" as const, normalizedValue: PROTECTED, start: 42, end: 57 },
    ],
    previewProjection: {
      preview: "The team shipped the release on schedule.",
      hiddenWordCount: 22,
      issuesImproved: 3,
      naturalness: "Strong" as const,
      meaningPreservation: "High" as const,
      protectedItems: [PROTECTED],
    },
  };
}

async function grantEntitlement(db: AppDatabase, userId: string, id: string) {
  await billing.upsertSubscriptionFromStripe(db, {
    userId,
    stripeCustomerId: `cus_${userId}`,
    stripeSubscriptionId: id,
    planId: "starter",
    catalogVersion: 1,
    status: "active",
    currentPeriodStart: new Date(Date.now() - 1_000),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    cancelAtPeriodEnd: false,
    lastStripeEventId: "evt_seed",
  });
}

/** One entitled owner with a claimed job, plus an entitled stranger who owns nothing. */
async function scenario() {
  const db = await createTestDatabase();
  const job = await persistHumanizationJob(db, jobInput());

  const owner = await billing.getOrCreateUserByExternalSubject(db, { externalSubject: "owner", email: null });
  const stranger = await billing.getOrCreateUserByExternalSubject(db, { externalSubject: "stranger", email: null });
  await signIn(db, "owner");
  await signIn(db, "stranger");

  await billing.claimJobForUser(db, { capabilityDigest: await digestOf(job.capabilityToken), userId: owner.userId });
  await grantEntitlement(db, owner.userId, "sub_owner");
  await grantEntitlement(db, stranger.userId, "sub_stranger");

  return { db, job, owner, stranger };
}

function call(
  db: AppDatabase,
  jobId: string,
  body: { sentenceIndex: number; action: "regenerate" | "restore" },
  options: { subject?: string | null; key?: string; engine?: unknown } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-idempotency-key": options.key ?? crypto.randomUUID(),
  };
  if (options.subject !== null) Object.assign(headers, sessionHeaders(options.subject ?? "owner"));

  return buildSentenceOperationResponse(
    new Request(`http://localhost/api/history/${jobId}/sentence`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    jobId,
    async () => ({
      db,
      billing,
      history,
      revisions,
      auth,
      ...(options.engine ? { engine: options.engine as never } : {}),
    }),
  );
}

/**
 * Words the ledger has committed for this account this period.
 *
 * `getConsumedWords` matches the period start exactly rather than treating it
 * as "since", so the entitlement has to supply it. Passing an arbitrary recent
 * timestamp silently returns 0 and makes every debit assertion below vacuous.
 */
async function consumedWords(db: AppDatabase, userId: string): Promise<number> {
  const entitlement = await billing.getActiveEntitlement(db, userId);
  assert.ok(entitlement, "the scenario grants an active entitlement");
  return getConsumedWords(db, userId, entitlement.currentPeriodStart);
}

async function bodyOf(response: Response): Promise<SentenceOperationBody> {
  return (await response.json()) as SentenceOperationBody;
}

/** A provider that returns a fixed sentence, so a test can choose what the engine proposes. */
function engineReturning(sentence: string) {
  return {
    humanizationProvider: {
      name: "test-fixed",
      async rewrite() {
        return { text: sentence, providerName: "test-fixed" };
      },
    },
  };
}

// ---------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------

test("a signed-out caller cannot change a sentence", async () => {
  const { db, job } = await scenario();
  const response = await call(db, job.jobId, { sentenceIndex: TARGET, action: "regenerate" }, { subject: null });
  assert.equal(response.status, 401);
});

test("another account cannot change a sentence in a rewrite it does not own", async () => {
  const { db, job } = await scenario();
  const response = await call(db, job.jobId, { sentenceIndex: TARGET, action: "regenerate" }, { subject: "stranger" });

  assert.equal(response.status, 404, "an owned-by-someone-else job is indistinguishable from a missing one");
  const body = await response.json() as { error: string };
  assert.ok(!JSON.stringify(body).includes("Elena"), "a refusal must not leak the rewrite");
});

test("a cross-site request is refused before anything is charged", async () => {
  const { db, job, owner } = await scenario();
  const response = await buildSentenceOperationResponse(
    new Request(`http://localhost/api/history/${job.jobId}/sentence`, {
      method: "POST",
      headers: {
        ...sessionHeaders("owner"),
        "content-type": "application/json",
        "x-idempotency-key": crypto.randomUUID(),
        origin: "https://evil.test",
      },
      body: JSON.stringify({ sentenceIndex: TARGET, action: "regenerate" }),
    }),
    job.jobId,
    async () => ({ db, billing, history, revisions, auth }),
  );

  assert.equal(response.status, 403);
  assert.equal(await consumedWords(db, owner.userId), 0);
});

// ---------------------------------------------------------------------
// Protected content and verification
// ---------------------------------------------------------------------

test("a candidate that drops a protected value is rejected and charges nothing", async () => {
  const { db, job, owner } = await scenario();

  // Proposes a fluent sentence that silently loses the protected person.
  const response = await call(
    db,
    job.jobId,
    { sentenceIndex: TARGET, action: "regenerate" },
    { engine: engineReturning("The reviewer looked at the findings and the results held up well.") },
  );

  const body = await bodyOf(response);
  assert.equal(response.status, 422);
  assert.equal(body.outcome, "rejected");
  assert.equal(body.chargedWords, 0);
  assert.equal(await consumedWords(db, owner.userId), 0,
    "a rejected candidate must not reach the ledger");
});

test("an applied regeneration keeps the protected value and charges exactly its words", async () => {
  const { db, job, owner } = await scenario();
  const candidate = `${PROTECTED} reviewed the findings, and the results were robust.`;

  const response = await call(
    db,
    job.jobId,
    { sentenceIndex: TARGET, action: "regenerate" },
    { engine: engineReturning(candidate) },
  );
  const body = await bodyOf(response);

  // Asserted, not tolerated. An earlier version of this test accepted a
  // rejection here, which made it pass while regeneration was incapable of
  // ever applying: extractProtectedContent was emitting the protected person
  // twice over one span and the verifier failed every candidate.
  assert.equal(body.outcome, "applied", "a meaning-preserving candidate must be applied");
  assert.equal(response.status, 200);
  assert.ok(body.sentence?.includes(PROTECTED), "the protected person must survive regeneration");
  assert.ok(body.result?.includes(PROTECTED));
  assert.ok(body.chargedWords > 0);
  assert.equal(
    await consumedWords(db, owner.userId),
    body.chargedWords,
    "the ledger must show exactly the candidate's words, not the reservation",
  );
});

// ---------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------

test("regeneration keeps a protected value with the real provider chain, not only a stub", async () => {
  const { db, job } = await scenario();

  // No injected engine: this is the deterministic provider, verifier, and
  // evaluator the deployed app runs.
  const body = await bodyOf(await call(db, job.jobId, { sentenceIndex: TARGET, action: "regenerate" }));

  assert.equal(body.outcome, "applied");
  assert.ok(body.sentence?.includes(PROTECTED), "the protected person must survive the real chain");
});

test("a retry under the same idempotency key replays and charges once", async () => {
  const { db, job, owner } = await scenario();
  const key = crypto.randomUUID();
  const engine = engineReturning(`${PROTECTED} reviewed the findings, and the results were robust.`);

  const first = await bodyOf(await call(db, job.jobId, { sentenceIndex: TARGET, action: "regenerate" }, { key, engine }));
  const afterFirst = await consumedWords(db, owner.userId);

  const second = await bodyOf(await call(db, job.jobId, { sentenceIndex: TARGET, action: "regenerate" }, { key, engine }));

  assert.equal(second.replayed, true, "the second call must be a replay, not a new operation");
  assert.equal(second.outcome, first.outcome);
  assert.equal(second.chargedWords, first.chargedWords);
  assert.equal(
    await consumedWords(db, owner.userId),
    afterFirst,
    "a replay must not debit a second time",
  );
});

test("reusing one idempotency key for a different sentence is refused, not silently recharged", async () => {
  const { db, job } = await scenario();
  const key = crypto.randomUUID();

  await call(db, job.jobId, { sentenceIndex: TARGET, action: "restore" }, { key });
  const response = await call(db, job.jobId, { sentenceIndex: 0, action: "restore" }, { key });

  assert.equal(response.status, 409);
});

// ---------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------

test("restoring a sentence is free", async () => {
  const { db, job, owner } = await scenario();

  const response = await call(db, job.jobId, { sentenceIndex: TARGET, action: "restore" });
  const body = await bodyOf(response);

  assert.equal(body.chargedWords, 0);
  assert.equal(await consumedWords(db, owner.userId), 0,
    "restore generates nothing, so it must debit nothing");
});

// ---------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------

test("regeneration is bounded per sentence and the refusal charges nothing", async () => {
  const { db, job, owner } = await scenario();
  const engine = engineReturning(`${PROTECTED} reviewed the findings, and the results were robust.`);

  let applied = 0;
  for (let attempt = 0; attempt < MAX_REGENERATIONS_PER_SENTENCE + 2; attempt += 1) {
    const response = await call(db, job.jobId, { sentenceIndex: TARGET, action: "regenerate" }, { engine });
    if (response.status === 429) {
      const body = await response.json() as { limit?: string };
      assert.equal(body.limit, "sentence");
      assert.ok(applied <= MAX_REGENERATIONS_PER_SENTENCE);
      const consumed = await consumedWords(db, owner.userId);
      const again = await call(db, job.jobId, { sentenceIndex: TARGET, action: "regenerate" }, { engine });
      assert.equal(again.status, 429);
      assert.equal(
        await consumedWords(db, owner.userId),
        consumed,
        "a refused regeneration must not debit",
      );
      return;
    }
    if ((await bodyOf(response.clone())).outcome === "applied") applied += 1;
  }

  assert.fail(`expected a per-sentence bound after ${MAX_REGENERATIONS_PER_SENTENCE} regenerations`);
});

// ---------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------

test("a sentence index past the end of the rewrite is refused", async () => {
  const { db, job } = await scenario();
  const response = await call(db, job.jobId, { sentenceIndex: 999, action: "regenerate" });
  assert.equal(response.status, 404);
});

test("a request without an idempotency key is refused", async () => {
  const { db, job } = await scenario();
  const response = await buildSentenceOperationResponse(
    new Request(`http://localhost/api/history/${job.jobId}/sentence`, {
      method: "POST",
      headers: { ...sessionHeaders("owner"), "content-type": "application/json" },
      body: JSON.stringify({ sentenceIndex: TARGET, action: "regenerate" }),
    }),
    job.jobId,
    async () => ({ db, billing, history, revisions, auth }),
  );
  assert.equal(response.status, 400);
});

// ---------------------------------------------------------------------
// The per-job bound, the addressing it depends on, and deletion
// ---------------------------------------------------------------------

/**
 * A rewrite long enough that the per-job cap can be reached without the
 * per-sentence cap reaching first: MAX_REGENERATIONS_PER_JOB regenerations
 * spread three-per-sentence need more sentences than the fixture above has.
 */
async function longScenario() {
  const text = Array.from(
    { length: 12 },
    (_, index) => `Team ${index} will leverage a robust solution to drive value at scale.`,
  ).join(" ");

  const db = await createTestDatabase();
  const job = await persistHumanizationJob(db, { ...jobInput(), original: text, result: text });
  const owner = await billing.getOrCreateUserByExternalSubject(db, { externalSubject: "owner", email: null });
  await signIn(db, "owner");
  await billing.claimJobForUser(db, { capabilityDigest: await digestOf(job.capabilityToken), userId: owner.userId });
  await grantEntitlement(db, owner.userId, "sub_owner");
  return { db, job, owner };
}

test("the per-job cap refuses regeneration beyond the bound, and the refusal charges nothing", async () => {
  const { db, job, owner } = await longScenario();

  let attempts = 0;
  let sentenceIndex = 0;
  while (attempts < MAX_REGENERATIONS_PER_JOB) {
    for (let n = 0; n < MAX_REGENERATIONS_PER_SENTENCE && attempts < MAX_REGENERATIONS_PER_JOB; n += 1) {
      const response = await call(db, job.jobId, { sentenceIndex, action: "regenerate" });
      assert.notEqual(response.status, 429, `attempt ${attempts} is inside both caps and must be allowed`);
      attempts += 1;
    }
    sentenceIndex += 1;
  }
  const chargedBefore = await consumedWords(db, owner.userId);

  // A sentence with regenerations of its own still to spare, on a job with none.
  const refused = await call(db, job.jobId, { sentenceIndex, action: "regenerate" });
  assert.equal(refused.status, 429);
  assert.equal((await refused.json() as { limit?: string }).limit, "job");
  assert.equal(await consumedWords(db, owner.userId), chargedBefore);
});

test("a restore is free of the regeneration caps, because it generates nothing", async () => {
  const { db, job } = await scenario();

  const restored = await bodyOf(await call(db, job.jobId, { sentenceIndex: TARGET, action: "restore" }));
  assert.equal(restored.chargedWords, 0);
  assert.equal(restored.regenerationsUsedForSentence, 0);
  assert.equal(restored.regenerationsUsedForJob, 0);
});

test("sentence addressing is total and abbreviation-aware", () => {
  // Two properties an index into a paying customer's document depends on, and
  // that splitSentences() in src/lib/humanization/text.ts does not have: it
  // splits "Dr." from the name it belongs to, and it drops the clause around a
  // decimal outright.
  const document = "Dr. Elena Marsh reported 42% growth. The board approved $1.2 million for Acme Corp. Work starts now.";
  const sentences = segmentSentences(document);

  assert.equal(sentences.length, 3);
  assert.ok(sentences[0].text.startsWith("Dr. Elena Marsh"), "a title must not end a sentence");
  assert.ok(sentences[1].text.includes("$1.2 million"), "a decimal must not split, and must not vanish");
  assert.ok(sentences[1].text.endsWith("Acme Corp."), "a trailing abbreviation before a capital does end one");

  const covered = sentences.map((sentence) => document.slice(sentence.start, sentence.end)).join("");
  assert.equal(covered.replace(/\s+/g, ""), document.replace(/\s+/g, ""), "no character may be dropped");
});

test("deleting the rewrite voids the text a sentence operation left in its revisions", async () => {
  const { db, job, owner } = await scenario();

  const applied = await bodyOf(await call(db, job.jobId, { sentenceIndex: TARGET, action: "regenerate" }));
  assert.equal(applied.outcome, "applied");

  const before = await db.select().from(schema.resultRevisions);
  assert.ok(before.length >= 2, "an applied operation leaves an original and a derived revision");
  assert.ok(before.some((revision) => revision.resultRef.includes(PROTECTED)));

  assert.equal(
    await history.deleteHistoryEntryForUser(db, { userId: owner.userId, jobId: job.jobId }),
    "deleted",
  );

  const after = await db.select().from(schema.resultRevisions);
  assert.ok(after.every((revision) => revision.resultRef === ""), "no revision may outlive the payload it came from");
});
