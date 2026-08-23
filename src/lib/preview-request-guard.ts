type CachedRequest<T> = {
  fingerprint: string;
  expiresAt: number;
  promise?: Promise<T>;
  value?: T;
};

type ClientWindow = {
  startedAt: number;
  requests: number;
  inFlight: number;
  lastSeenAt: number;
};

export type GuardResult<T> =
  | { ok: true; value: T; replayed: boolean }
  | { ok: false; status: 409 | 429; error: string; retryAfterSeconds?: number };

type GuardOptions = {
  maxRequests: number;
  windowMs: number;
  maxConcurrent: number;
  replayTtlMs: number;
  maxEntries: number;
};

const DEFAULT_OPTIONS: GuardOptions = {
  maxRequests: 12,
  windowMs: 60_000,
  maxConcurrent: 2,
  replayTtlMs: 60_000,
  maxEntries: 256,
};

/**
 * A bounded, per-runtime safety net. This intentionally does not claim to be a
 * distributed rate limiter; a durable edge/store-backed limiter is still a
 * launch requirement before this endpoint calls a paid model.
 */
export class PreviewRequestGuard<T> {
  private readonly options: GuardOptions;
  private readonly requests = new Map<string, CachedRequest<T>>();
  private readonly clients = new Map<string, ClientWindow>();

  constructor(options: Partial<GuardOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async run(input: {
    clientId: string;
    idempotencyKey: string;
    fingerprint: string;
    execute: () => Promise<T>;
  }): Promise<GuardResult<T>> {
    const now = Date.now();
    this.cleanup(now);
    const requestKey = `${input.clientId}:${input.idempotencyKey}`;
    const existing = this.requests.get(requestKey);

    if (existing) {
      if (existing.fingerprint !== input.fingerprint) {
        return { ok: false, status: 409, error: "That idempotency key was already used for different text." };
      }
      if (existing.promise) return { ok: true, value: await existing.promise, replayed: true };
      if (existing.value !== undefined) return { ok: true, value: existing.value, replayed: true };
    }

    if (this.requests.size >= this.options.maxEntries) {
      return {
        ok: false,
        status: 429,
        error: "Preview capacity is temporarily full. Please try again shortly.",
        retryAfterSeconds: 1,
      };
    }

    const client = this.clientWindow(input.clientId, now);
    if (client.requests >= this.options.maxRequests) {
      return {
        ok: false,
        status: 429,
        error: "Too many previews were requested. Please wait a moment and try again.",
        retryAfterSeconds: Math.max(1, Math.ceil((client.startedAt + this.options.windowMs - now) / 1_000)),
      };
    }
    if (client.inFlight >= this.options.maxConcurrent) {
      return {
        ok: false,
        status: 429,
        error: "Two previews are already being processed. Please wait for one to finish.",
        retryAfterSeconds: 1,
      };
    }

    client.requests += 1;
    client.inFlight += 1;
    client.lastSeenAt = now;
    const promise = input.execute();
    this.requests.set(requestKey, {
      fingerprint: input.fingerprint,
      expiresAt: now + this.options.replayTtlMs,
      promise,
    });

    try {
      const value = await promise;
      this.requests.set(requestKey, {
        fingerprint: input.fingerprint,
        expiresAt: Date.now() + this.options.replayTtlMs,
        value,
      });
      return { ok: true, value, replayed: false };
    } catch (error) {
      this.requests.delete(requestKey);
      throw error;
    } finally {
      client.inFlight = Math.max(0, client.inFlight - 1);
      client.lastSeenAt = Date.now();
    }
  }

  private clientWindow(clientId: string, now: number): ClientWindow {
    const existing = this.clients.get(clientId);
    if (existing && now - existing.startedAt < this.options.windowMs) return existing;
    const next = { startedAt: now, requests: 0, inFlight: existing?.inFlight ?? 0, lastSeenAt: now };
    this.clients.set(clientId, next);
    return next;
  }

  private cleanup(now: number) {
    for (const [key, request] of this.requests) {
      if (!request.promise && request.expiresAt <= now) this.requests.delete(key);
    }
    for (const [key, client] of this.clients) {
      if (client.inFlight === 0 && now - client.lastSeenAt > this.options.windowMs * 2) this.clients.delete(key);
    }
    while (this.requests.size >= this.options.maxEntries) {
      const settled = [...this.requests].find(([, request]) => !request.promise);
      if (!settled) break;
      this.requests.delete(settled[0]);
    }
  }
}
