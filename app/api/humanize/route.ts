import { createHumanizationPipeline, HumanizationFailedError, PIPELINE_VERSION } from "@/src/lib/humanization";
import type { WritingMode } from "@/src/lib/humanization";
import { PreviewRequestGuard } from "@/src/lib/preview-request-guard";
import type { PreviewProjection } from "../../../db/repository";

const allowedModes = new Set<WritingMode>(["natural", "professional", "academic", "casual"]);
const pipeline = createHumanizationPipeline({ config: { maxInputCharacters: 2_400 } });
const MAX_REQUEST_BYTES = 10_000;
const MAX_PROCESSING_MS = 5_000;
const IDEMPOTENCY_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/;

type PreviewPayload = PreviewProjection & {
  original: string;
  /** Present only when the job was durably persisted; absent is not an error. */
  capability?: string;
  capabilityExpiresAt?: string;
};

/**
 * Best-effort persistence: durably stores the succeeded job and issues an
 * anonymous preview capability (M1-09). `db/index.ts` reaches for the
 * `cloudflare:workers` binding, which only resolves inside the actual
 * Workers runtime — under `npm test` (plain Node, importing this route
 * directly) or any environment without a configured D1 binding, the
 * dynamic import/getDb() call throws and this quietly no-ops. The preview
 * itself never depends on persistence succeeding.
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

const requestGuard = new PreviewRequestGuard<PreviewPayload>();

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

function partialPreview(text: string) {
  const words = text.split(/\s+/);
  const visibleWords = Math.min(90, Math.max(8, Math.floor(words.length * 0.46)));
  return words.slice(0, visibleWords).join(" ");
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
  if (typeof text !== "string" || text.trim().split(/\s+/).length < 12) {
    return Response.json({ error: "Add a little more context. At least 12 words works best." }, { status: 400 });
  }
  if (text.length > 2_400 || text.trim().split(/\s+/).length > 300) {
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException("Preview deadline exceeded.", "TimeoutError")), MAX_PROCESSING_MS);
    const clientId = request.headers.get("cf-connecting-ip")?.trim() || "anonymous-runtime";
    const contentFingerprint = await fingerprint(text, mode as WritingMode);
    const guarded = await requestGuard.run({
      clientId,
      idempotencyKey,
      fingerprint: contentFingerprint,
      execute: async () => {
        try {
          const result = await pipeline.humanize({ text, mode: mode as WritingMode, signal: controller.signal });
          const preview = partialPreview(result.text);
          const projection: PreviewProjection = {
            preview,
            hiddenWordCount: Math.max(0, result.text.trim().split(/\s+/).length - preview.trim().split(/\s+/).length),
            issuesImproved: Math.max(1, result.improvements),
            naturalness: result.evaluation.scores.naturalness >= 0.7 ? "Strong" : "Good",
            meaningPreservation: result.verification.passed ? "High" : "Review needed",
            protectedItems: result.protectedContent.map((item) => item.value),
          };
          const persisted = await tryPersist({
            mode: mode as WritingMode,
            clientFingerprint: await sha256Hex(clientId),
            idempotencyKey,
            contentFingerprint,
            original: result.original,
            result: result.text,
            successfulWords: result.metrics.successfulWords,
            protectedContent: result.protectedContent,
            projection,
          });
          return { original: result.original, ...projection, ...persisted } satisfies PreviewPayload;
        } finally {
          clearTimeout(timeout);
        }
      },
    });
    clearTimeout(timeout);
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
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return Response.json({ error: "The preview took too long. No usage was charged; please try again." }, { status: 504, headers: { "cache-control": "no-store" } });
    }
    const message = error instanceof HumanizationFailedError
      ? "We could not verify this rewrite without changing the meaning. No usage was charged."
      : "The rewrite could not be completed.";
    return Response.json({ error: message }, { status: 422, headers: { "cache-control": "no-store" } });
  }
}
