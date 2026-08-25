import { createHumanizationPipeline, HumanizationFailedError, PIPELINE_VERSION } from "@/src/lib/humanization";
import type { WritingMode } from "@/src/lib/humanization";
import {
  DistributedPreviewRequestGuard,
  PreviewRequestGuard,
  previewGuardClientKey,
} from "@/src/lib/preview-request-guard";
import { isMateriallyUnchanged, MIN_PAYWALLABLE_INPUT_WORDS, projectPreview } from "@/src/lib/preview-projection";
import { resolveChatGPTUserFromHeaders } from "@/src/lib/chatgpt-identity";
import { releasePaidUsage, reservePaidUsage } from "@/src/lib/paid-usage";
import type { PaidUsageReservation } from "@/src/lib/paid-usage";
import { completeEntitledRewrite } from "@/src/lib/entitled-rewrite";
import type { EntitledRewritePayload } from "@/src/lib/entitled-rewrite";
import type { AppDatabase, PreviewProjection } from "../../../db/repository";

const allowedModes = new Set<WritingMode>(["natural", "professional", "academic", "casual"]);
const pipeline = createHumanizationPipeline({ config: { maxInputCharacters: 10_000 } });
const MAX_REQUEST_BYTES = 10_000;
const MAX_PROCESSING_MS = 5_000;
const IDEMPOTENCY_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/;

/**
 * ACT-01. The terminal, un-sellable outcome: the pipeline returned a
 * candidate materially identical to the submitted draft. Structurally it
 * carries no `preview`, no `hiddenWordCount` and no `capability` — there
 * is no withheld remainder to unlock, so there is nothing to charge for
 * and no checkout can be started against it.
 */
type UnchangedPayload = {
  original: string;
  unchanged: true;
};

type HumanizePayload =
  | (PreviewProjection & {
      original: string;
      unchanged?: false;
      /** Present only when the job was durably persisted; absent is not an error. */
      capability?: string;
      capabilityExpiresAt?: string;
    })
  | UnchangedPayload
  | EntitledRewritePayload;

class QuotaExceededError extends Error {
  constructor(readonly usage: { consumed: number; allowance: number; remaining: number; periodEnd: string }) {
    super("Monthly word allowance reached.");
  }
}

class PaidUsageUnavailableError extends Error {}

/**
 * Best-effort persistence: durably stores the succeeded job and issues an
 * anonymous preview capability (M1-09). `db/index.ts` reaches for the
 * `cloudflare:workers` binding, which only resolves inside the actual
 * Workers runtime — under `npm test` (plain Node, importing this route
 * directly) or any environment without a configured D1 binding, the
 * dynamic import/getDb() call throws and this quietly no-ops. The preview
 * itself never depends on persistence succeeding.
 *
 * Known tradeoff (AQA review, see docs/QA.md's idempotency requirement):
 * if the in-memory PreviewRequestGuard's replay cache is gone (isolate
 * recycle) and a genuine duplicate submission reaches here, the unique
 * index on (client_fingerprint, idempotency_key) rejects the second
 * insert and this catches it — the caller gets a fresh, correctly
 * re-derived preview but no capability. That's intentional, not a bug to
 * silently paper over: only a capability's one-way digest is ever stored
 * (never the raw token), so there is no raw token to hand back for the
 * original job. Recovering one would mean minting a second live
 * capability for the same job, which breaks the "exactly one capability
 * per job" invariant in docs/ARCHITECTURE.md — a product/security
 * decision, not something to change here unilaterally.
 */
async function tryPersist(input: {
  mode: WritingMode;
  clientFingerprint: string;
  idempotencyKey: string;
  contentFingerprint: string;
  original: string;
  result: string;
  successfulWords: number;
  protectedContent: Array<{ id: string; kind: string; normalizedValue: string; start: number; end: number }>;
  projection: PreviewProjection;
}): Promise<{ capability: string; capabilityExpiresAt: string } | undefined> {
  try {
    const [{ getDb }, { persistHumanizationJob }] = await Promise.all([
      import("../../../db/index"),
      import("../../../db/repository"),
    ]);
    const persisted = await persistHumanizationJob(getDb(), {
      mode: input.mode,
      clientFingerprint: input.clientFingerprint,
      idempotencyKey: input.idempotencyKey,
      contentFingerprint: input.contentFingerprint,
      inputWordCount: input.original.trim().split(/\s+/).length,
      successfulWordCount: input.successfulWords,
      pipelineVersion: PIPELINE_VERSION,
      original: input.original,
      result: input.result,
      protectedContent: input.protectedContent,
      previewProjection: input.projection,
    });
    return { capability: persisted.capabilityToken, capabilityExpiresAt: persisted.capabilityExpiresAt.toISOString() };
  } catch {
    // Never log this error: D1/driver error objects can carry bound
    // statement parameters (including source/result text) in their
    // message/cause chain, which would violate the no-sensitive-logging
    // control in docs/SECURITY.md. Best-effort only — the preview response
    // never depends on persistence succeeding.
    return undefined;
  }
}

const localRequestGuard = new PreviewRequestGuard<HumanizePayload>();

type RuntimeGuard = {
  guard: PreviewRequestGuard<HumanizePayload> | DistributedPreviewRequestGuard<HumanizePayload>;
  secret?: string;
  distributed: boolean;
};

async function requestGuardForRuntime(): Promise<RuntimeGuard | null> {
  try {
    const { env } = await import("cloudflare:workers");
    const runtime = env as Cloudflare.Env;
    const environment = runtime.ENVIRONMENT?.trim().toLowerCase();
    const explicitlyNonProduction = environment === "development" || environment === "local" || environment === "test";
    const secret = runtime.PREVIEW_GUARD_SECRET?.trim();
    if (runtime.DB && secret) {
      return { guard: new DistributedPreviewRequestGuard<HumanizePayload>(runtime.DB, secret), secret, distributed: true };
    }
    // A real Workers runtime is production-like unless it explicitly says
    // otherwise. Missing shared storage or its HMAC/encryption secret fails
    // closed; silently dropping to isolate memory would reopen the abuse gap.
    return explicitlyNonProduction ? { guard: localRequestGuard, distributed: false } : null;
  } catch {
    // Plain Node route tests do not provide the cloudflare:workers module.
    return { guard: localRequestGuard, distributed: false };
  }
}

function trustedConnectingIp(request: Request) {
  const value = request.headers.get("cf-connecting-ip")?.trim();
  if (!value || value.length > 64 || /[\s,]/.test(value)) return null;
  const octets = value.split(".");
  if (octets.length === 4 && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255 && String(Number(part)) === part)) return value;
  if (!value.includes(":")) return null;
  try {
    return new URL(`http://[${value}]/`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

class PayloadTooLargeError extends Error {}

async function readLimitedBody(request: Request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fingerprint(text: string, mode: WritingMode) {
  return sha256Hex(`${mode}\0${text}`);
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return Response.json({ error: "Send text as JSON." }, { status: 415 });
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: "The request is too large." }, { status: 413 });
  }

  let payload: unknown;
  try {
    const rawBody = await readLimitedBody(request);
    payload = JSON.parse(rawBody);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return Response.json({ error: "The request is too large." }, { status: 413 });
    }
    return Response.json({ error: "The request body is not valid JSON." }, { status: 400 });
  }

  if (!payload || typeof payload !== "object") {
    return Response.json({ error: "Text is required." }, { status: 400 });
  }

  const { text, mode } = payload as { text?: unknown; mode?: unknown };
  // SEC-02: the minimum is a paywall-integrity control, not just a quality
  // hint. Below roughly this length the rewrite is too short to withhold a
  // meaningful remainder, which is what let a document be chunked into tiny
  // windows and reconstructed for free. Keep this at or above
  // MIN_PAYWALLABLE_INPUT_WORDS.
  if (typeof text !== "string" || text.trim().split(/\s+/).length < MIN_PAYWALLABLE_INPUT_WORDS) {
    return Response.json(
      { error: `Add a little more context. At least ${MIN_PAYWALLABLE_INPUT_WORDS} words works best.` },
      { status: 400 },
    );
  }
  if (text.trim().split(/\s+/).length > 300) {
    return Response.json({ error: "Keep this first pass to 300 words or fewer." }, { status: 413 });
  }
  if (typeof mode !== "string" || !allowedModes.has(mode as WritingMode)) {
    return Response.json({ error: "Choose a valid writing mode." }, { status: 400 });
  }

  const idempotencyKey = request.headers.get("x-idempotency-key")?.trim() ?? "";
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
    return Response.json({ error: "Send a valid x-idempotency-key with each preview request." }, { status: 400 });
  }

  try {
    const runtimeGuard = await requestGuardForRuntime();
    if (!runtimeGuard) {
      return Response.json(
        { error: "Preview protection is temporarily unavailable. Please try again shortly." },
        { status: 503, headers: { "cache-control": "no-store", "retry-after": "2" } },
      );
    }
    const trustedIp = trustedConnectingIp(request);
    if (runtimeGuard.distributed && !trustedIp) {
      return Response.json(
        { error: "Preview protection is temporarily unavailable. Please try again shortly." },
        { status: 503, headers: { "cache-control": "no-store", "retry-after": "2" } },
      );
    }
    const authenticatedUser = resolveChatGPTUserFromHeaders(request);
    const clientId = trustedIp
      ? authenticatedUser ? `${trustedIp}\0${authenticatedUser.userId}` : trustedIp
      : "local-test-runtime";
    const contentFingerprint = await fingerprint(text, mode as WritingMode);
    // The same hashed client signal both persistence paths store: an HMAC
    // under the shared guard secret where one exists, a digest otherwise.
    // Never a raw IP or user id.
    const clientFingerprint = () => runtimeGuard.secret
      ? previewGuardClientKey(runtimeGuard.secret, clientId)
      : sha256Hex(clientId);
    const guarded = await runtimeGuard.guard.run({
      clientId,
      idempotencyKey,
      fingerprint: contentFingerprint,
      execute: async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(new DOMException("Preview deadline exceeded.", "TimeoutError")), MAX_PROCESSING_MS);
        let paidDb: AppDatabase | null = null;
        let paidReservation: PaidUsageReservation | null = null;
        try {
          if (authenticatedUser) {
            try {
              const { getDb } = await import("../../../db/index");
              paidDb = getDb();
              const admission = await reservePaidUsage(paidDb, {
                externalSubject: authenticatedUser.userId,
                idempotencyKey,
                words: text.trim().split(/\s+/).length,
              });
              if (admission.kind === "quota-exceeded") {
                throw new QuotaExceededError({
                  consumed: admission.consumed,
                  allowance: admission.allowance,
                  remaining: admission.remaining,
                  periodEnd: admission.periodEnd.toISOString(),
                });
              }
              if (admission.kind === "reserved") paidReservation = admission.reservation;
            } catch (error) {
              if (error instanceof QuotaExceededError) throw error;
              throw new PaidUsageUnavailableError("Paid usage verification is unavailable.");
            }
          }

          const result = await pipeline.humanize({ text, mode: mode as WritingMode, signal: controller.signal });

          // ACT-01: never truncate, price, or persist a rewrite that did
          // not rewrite anything. Derived from the normalized full
          // rewrite versus the normalized original — not from
          // `improvements` — and returned before any preview projection,
          // persistence, or capability minting happens, so no unlock CTA
          // can exist for this outcome anywhere downstream.
          if (isMateriallyUnchanged(result.original, result.text) || result.improvements === 0) {
            if (paidDb && paidReservation) await releasePaidUsage(paidDb, paidReservation);
            return { original: result.original, unchanged: true } satisfies UnchangedPayload;
          }

          const evidence = {
            issuesImproved: result.improvements,
            naturalness: result.evaluation.scores.naturalness >= 0.7 ? "Strong" as const : "Good" as const,
            meaningPreservation: result.verification.passed ? "High" as const : "Review needed" as const,
            protectedItems: result.protectedContent.map((item) => item.value),
          };

          if (paidDb && paidReservation) {
            // M3-02: the entitled branch commits usage, records the rewrite
            // in the owner's history, and returns the complete text. The
            // history write is best-effort inside completeEntitledRewrite —
            // it cannot fail this request and it never releases or re-charges
            // the reservation.
            return await completeEntitledRewrite(paidDb, paidReservation, {
              mode: mode as WritingMode,
              clientFingerprint: await clientFingerprint(),
              idempotencyKey,
              contentFingerprint,
              pipelineVersion: PIPELINE_VERSION,
              original: result.original,
              result: result.text,
              inputWordCount: text.trim().split(/\s+/).length,
              successfulWordCount: result.metrics.successfulWords,
              protectedContent: result.protectedContent,
              evidence,
            }, {
              // Content-free by construction: a reason code, never the error
              // object, which can carry bound statement parameters (the
              // customer's text) in its cause chain.
              onPersistenceSkipped: (reason) => {
                if (reason === "write-failed") console.warn("history persistence failed for an entitled rewrite");
              },
            });
          }

          // SEC-02: a rewrite too short to withhold a meaningful remainder
          // must never be returned whole with a purchase CTA over it. The
          // input minimum above normally prevents this; if a rewrite shrinks
          // past it anyway, withhold everything rather than leak it. This is
          // deliberately NOT the ACT-01 `unchanged` path — the text really
          // was rewritten, and claiming otherwise would be its own dishonesty.
          // KI-01: a rewrite the engine measured at zero improvements is not
          // sellable, however much text it withheld.
          const split = result.improvements > 0 ? projectPreview(result.text) : { preview: "", hiddenWordCount: 0, paywallable: false };
          if (!split.paywallable) {
            throw new HumanizationFailedError("The rewrite was too short to preview.", result.metrics, result.verification, result.evaluation);
          }

          const projection: PreviewProjection = {
            preview: split.preview,
            hiddenWordCount: split.hiddenWordCount,
            // ACT-02: the measured count, with no `Math.max(1, …)` floor.
            // A floored "1 improvement" is a fabricated evidence claim
            // (docs/MONETIZATION.md), and it was the mechanism that made
            // the ACT-01 no-op look legitimate.
            ...evidence,
          };
          const persisted = await tryPersist({
            mode: mode as WritingMode,
            clientFingerprint: await clientFingerprint(),
            idempotencyKey,
            contentFingerprint,
            original: result.original,
            result: result.text,
            successfulWords: result.metrics.successfulWords,
            protectedContent: result.protectedContent,
            projection,
          });
          return { original: result.original, ...projection, ...persisted } satisfies HumanizePayload;
        } catch (error) {
          if (paidDb && paidReservation) {
            try { await releasePaidUsage(paidDb, paidReservation); } catch { /* fail closed below */ }
          }
          throw error;
        } finally {
          clearTimeout(timeout);
        }
      },
    });
    if (!guarded.ok) {
      const headers: Record<string, string> = { "cache-control": "no-store" };
      if (guarded.retryAfterSeconds) headers["retry-after"] = String(guarded.retryAfterSeconds);
      return Response.json({ error: guarded.error }, { status: guarded.status, headers });
    }
    return Response.json(guarded.value, {
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-idempotent-replay": guarded.replayed ? "true" : "false",
      },
    });
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      return Response.json(
        { error: "You have used this month's word allowance.", usage: error.usage },
        { status: 429, headers: { "cache-control": "no-store" } },
      );
    }
    if (error instanceof PaidUsageUnavailableError) {
      return Response.json(
        { error: "Paid usage could not be verified. No usage was charged; please try again." },
        { status: 503, headers: { "cache-control": "no-store", "retry-after": "2" } },
      );
    }
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return Response.json({ error: "The preview took too long. No usage was charged; please try again." }, { status: 504, headers: { "cache-control": "no-store" } });
    }
    const message = error instanceof HumanizationFailedError
      ? "We could not verify this rewrite without changing the meaning. No usage was charged."
      : "The rewrite could not be completed.";
    return Response.json({ error: message }, { status: 422, headers: { "cache-control": "no-store" } });
  }
}
