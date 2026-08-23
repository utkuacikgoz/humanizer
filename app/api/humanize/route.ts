import { createHumanizationPipeline, HumanizationFailedError } from "@/src/lib/humanization";
import type { WritingMode } from "@/src/lib/humanization";
import { PreviewRequestGuard } from "@/src/lib/preview-request-guard";

const allowedModes = new Set<WritingMode>(["natural", "professional", "academic", "casual"]);
const pipeline = createHumanizationPipeline({ config: { maxInputCharacters: 2_400 } });
const MAX_REQUEST_BYTES = 10_000;
const MAX_PROCESSING_MS = 5_000;
const IDEMPOTENCY_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/;

type PreviewPayload = {
  original: string;
  preview: string;
  hiddenWordCount: number;
  issuesImproved: number;
  naturalness: "Strong" | "Good";
  meaningPreservation: "High" | "Review needed";
  protectedItems: string[];
};

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

async function fingerprint(text: string, mode: WritingMode) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${mode}\0${text}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
    const guarded = await requestGuard.run({
      clientId,
      idempotencyKey,
      fingerprint: await fingerprint(text, mode as WritingMode),
      execute: async () => {
        try {
          const result = await pipeline.humanize({ text, mode: mode as WritingMode, signal: controller.signal });
          const preview = partialPreview(result.text);
          return {
            original: result.original,
            preview,
            hiddenWordCount: Math.max(0, result.text.trim().split(/\s+/).length - preview.trim().split(/\s+/).length),
            issuesImproved: Math.max(1, result.improvements),
            naturalness: result.evaluation.scores.naturalness >= 0.7 ? "Strong" : "Good",
            meaningPreservation: result.verification.passed ? "High" : "Review needed",
            protectedItems: result.protectedContent.map((item) => item.value),
          } satisfies PreviewPayload;
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
