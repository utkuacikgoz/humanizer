const allowedEvents = new Set([
  "landing_view",
  "text_pasted",
  "humanization_started",
  "humanization_completed",
  "preview_viewed",
  "checkout_started",
  "result_copied",
  "second_humanization",
]);
const allowedPropertyNames = new Set(["mode", "wordCount", "issuesImproved", "planId", "source"]);
const MAX_EVENT_BYTES = 2_048;

async function readLimitedBody(request: Request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_EVENT_BYTES) {
      await reader.cancel();
      throw new RangeError("payload-too-large");
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(joined);
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return new Response(null, { status: 415 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_EVENT_BYTES) {
    return new Response(null, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(await readLimitedBody(request));
  } catch (error) {
    if (error instanceof RangeError && error.message === "payload-too-large") return new Response(null, { status: 413 });
    return new Response(null, { status: 400 });
  }
  if (!body || typeof body !== "object" || !allowedEvents.has(String((body as { event?: unknown }).event))) {
    return new Response(null, { status: 400 });
  }
  const properties = (body as { properties?: unknown }).properties;
  if (properties !== undefined) {
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) return new Response(null, { status: 400 });
    for (const [key, value] of Object.entries(properties)) {
      if (!allowedPropertyNames.has(key)) return new Response(null, { status: 400 });
      if (typeof value === "string" && value.length <= 64) continue;
      if (typeof value === "number" && Number.isFinite(value)) continue;
      if (typeof value === "boolean") continue;
      return new Response(null, { status: 400 });
    }
  }

  // Provider forwarding is intentionally deferred until a privacy-reviewed
  // analytics destination is configured. Never log or accept writing text here.
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
