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
  | { ok: false; status: 409 | 429 | 503; error: string; retryAfterSeconds?: number };

export type GuardInput<T> = {
  clientId: string;
  idempotencyKey: string;
  fingerprint: string;
  execute: () => Promise<T>;
};

type GuardOptions = {
  maxRequests: number;
  windowMs: number;
  maxConcurrent: number;
  replayTtlMs: number;
  maxEntries: number;
};

export const PREVIEW_GUARD_LIMITS = {
  maxRequests: 12,
  windowMs: 60_000,
  maxConcurrent: 2,
  leaseMs: 15_000,
  replayTtlMs: 10 * 60_000,
  failedTtlMs: 30_000,
} as const;

const DEFAULT_OPTIONS: GuardOptions = {
  maxRequests: PREVIEW_GUARD_LIMITS.maxRequests,
  windowMs: PREVIEW_GUARD_LIMITS.windowMs,
  maxConcurrent: PREVIEW_GUARD_LIMITS.maxConcurrent,
  replayTtlMs: 60_000,
  maxEntries: 256,
};

const STORAGE_ERROR = "Preview protection is temporarily unavailable. Please try again shortly.";

class GuardExecutionError {
  constructor(readonly cause: unknown) {}
}

/**
 * Fast isolate-local fallback. Production callers must use
 * DistributedPreviewRequestGuard; this class exists for plain-Node tests and
 * explicitly non-production development only.
 */
export class PreviewRequestGuard<T> {
  private readonly options: GuardOptions;
  private readonly requests = new Map<string, CachedRequest<T>>();
  private readonly clients = new Map<string, ClientWindow>();

  constructor(options: Partial<GuardOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async run(input: GuardInput<T>): Promise<GuardResult<T>> {
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
      return { ok: false, status: 429, error: "Preview capacity is temporarily full. Please try again shortly.", retryAfterSeconds: 1 };
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
      return { ok: false, status: 429, error: "Two previews are already being processed. Please wait for one to finish.", retryAfterSeconds: 1 };
    }

    client.requests += 1;
    client.inFlight += 1;
    client.lastSeenAt = now;
    // Normalizing through a microtask also makes a synchronous throw from a
    // nominally async provider follow the cleanup path below.
    const promise = Promise.resolve().then(input.execute);
    this.requests.set(requestKey, { fingerprint: input.fingerprint, expiresAt: now + this.options.replayTtlMs, promise });

    try {
      const value = await promise;
      this.requests.set(requestKey, { fingerprint: input.fingerprint, expiresAt: Date.now() + this.options.replayTtlMs, value });
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
    for (const [key, request] of this.requests) if (!request.promise && request.expiresAt <= now) this.requests.delete(key);
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

type DistributedOptions = {
  leaseMs: number;
  replayTtlMs: number;
  failedTtlMs: number;
  windowMs: number;
  now: () => number;
};

type RequestRow = {
  fingerprint: string;
  status: "active" | "succeeded" | "failed";
  lease_expires_at: number;
  response_ciphertext: string | null;
  response_iv: string | null;
  expires_at: number;
};

export class DistributedPreviewRequestGuard<T> {
  private readonly options: DistributedOptions;

  constructor(
    private readonly db: D1Database,
    private readonly secret: string,
    options: Partial<DistributedOptions> = {},
  ) {
    if (new TextEncoder().encode(secret).byteLength < 32) throw new Error("PREVIEW_GUARD_SECRET must contain at least 32 bytes.");
    this.options = {
      leaseMs: PREVIEW_GUARD_LIMITS.leaseMs,
      replayTtlMs: PREVIEW_GUARD_LIMITS.replayTtlMs,
      failedTtlMs: PREVIEW_GUARD_LIMITS.failedTtlMs,
      windowMs: PREVIEW_GUARD_LIMITS.windowMs,
      now: Date.now,
      ...options,
    };
  }

  async run(input: GuardInput<T>): Promise<GuardResult<T>> {
    try {
      const [clientKey, requestKey, contentKey] = await Promise.all([
        previewGuardHmac(this.secret, `client\0${input.clientId}`),
        previewGuardHmac(this.secret, `request\0${input.clientId}\0${input.idempotencyKey}`),
        previewGuardHmac(this.secret, `content\0${input.fingerprint}`),
      ]);
      const now = this.options.now();
      const existing = await this.read(requestKey);
      const prior = existing ? await this.handleExisting(existing, contentKey, requestKey) : null;
      if (prior) return prior;

      const windowStart = Math.floor(now / this.options.windowMs) * this.options.windowMs;
      const leaseExpiresAt = now + this.options.leaseMs;
      const expiresAt = now + this.options.replayTtlMs;
      const leaseToken = crypto.randomUUID();
      const admissionToken = crypto.randomUUID();
      let admitted = false;

      try {
        const counter = this.db.prepare(
          `INSERT INTO preview_guard_windows (client_key, window_start, request_count, updated_at, admission_token)
           VALUES (?, ?, 1, ?, ?)
           ON CONFLICT(client_key, window_start) DO UPDATE SET
             request_count = preview_guard_windows.request_count + 1,
             updated_at = excluded.updated_at,
             admission_token = excluded.admission_token
           WHERE preview_guard_windows.request_count < ?`,
        ).bind(clientKey, windowStart, now, admissionToken, PREVIEW_GUARD_LIMITS.maxRequests);

        if (existing) {
          const request = this.db.prepare(
            `UPDATE preview_guard_requests
             SET client_key = ?, fingerprint = ?, window_start = ?, status = 'active', lease_token = ?, lease_expires_at = ?,
                 response_ciphertext = NULL, response_iv = NULL, expires_at = ?, updated_at = ?
             WHERE request_key = ? AND (status = 'failed' OR lease_expires_at <= ? OR expires_at <= ?)
               AND EXISTS (
                 SELECT 1 FROM preview_guard_windows
                 WHERE client_key = ? AND window_start = ? AND admission_token = ?
               )
               AND (
                 SELECT COUNT(*) FROM preview_guard_requests
                 WHERE client_key = ? AND request_key != ? AND status = 'active' AND lease_expires_at > ?
               ) < ?`,
          ).bind(
            clientKey, contentKey, windowStart, leaseToken, leaseExpiresAt, expiresAt, now,
            requestKey, now, now,
            clientKey, windowStart, admissionToken,
            clientKey, requestKey, now, PREVIEW_GUARD_LIMITS.maxConcurrent,
          );
          const results = await this.db.batch([counter, request]);
          admitted = Number(results[1]?.meta.changes ?? 0) === 1;
        } else {
          const request = this.db.prepare(
            `INSERT INTO preview_guard_requests
              (request_key, client_key, fingerprint, window_start, status, lease_token, lease_expires_at, expires_at, created_at, updated_at)
             SELECT ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM preview_guard_windows
               WHERE client_key = ? AND window_start = ? AND admission_token = ?
             )
               AND (
                 SELECT COUNT(*) FROM preview_guard_requests
                 WHERE client_key = ? AND status = 'active' AND lease_expires_at > ?
               ) < ?`,
          ).bind(
            requestKey, clientKey, contentKey, windowStart, leaseToken, leaseExpiresAt, expiresAt, now, now,
            clientKey, windowStart, admissionToken,
            clientKey, now, PREVIEW_GUARD_LIMITS.maxConcurrent,
          );
          const results = await this.db.batch([counter, request]);
          admitted = Number(results[1]?.meta.changes ?? 0) === 1;
        }
      } catch (error) {
        const raced = await this.read(requestKey);
        if (raced) {
          const racedResult = await this.handleExisting(raced, contentKey, requestKey);
          if (racedResult) return racedResult;
        }
        throw error;
      }

      if (!admitted) {
        const raced = await this.read(requestKey);
        if (raced) {
          const racedResult = await this.handleExisting(raced, contentKey, requestKey);
          if (racedResult) return racedResult;
        }
        const limited = await this.classifyAdmission(clientKey, now, windowStart);
        if (limited) return limited;
        throw new Error("Preview admission changed without a readable request row.");
      }

      // Cloudflare may terminate un-awaited work once the response completes;
      // wait for the bounded cleanup rather than relying on isolate lifetime.
      await this.cleanup(now).catch(() => undefined);
      let value: T;
      try {
        value = await Promise.resolve().then(input.execute);
      } catch (error) {
        await this.db.prepare(
          `UPDATE preview_guard_requests SET status = 'failed', lease_expires_at = 0, expires_at = ?, updated_at = ?
           WHERE request_key = ? AND status = 'active' AND lease_token = ?`,
        ).bind(this.options.now() + this.options.failedTtlMs, this.options.now(), requestKey, leaseToken).run().catch(() => undefined);
        throw new GuardExecutionError(error);
      }
      try {
        const encrypted = await this.encrypt(JSON.stringify(value), requestKey);
        const completion = await this.db.prepare(
          `UPDATE preview_guard_requests
           SET status = 'succeeded', lease_expires_at = 0, response_ciphertext = ?, response_iv = ?, expires_at = ?, updated_at = ?
           WHERE request_key = ? AND status = 'active' AND lease_token = ?`,
        ).bind(encrypted.ciphertext, encrypted.iv, this.options.now() + this.options.replayTtlMs, this.options.now(), requestKey, leaseToken).run();
        if (Number(completion.meta.changes ?? 0) !== 1) {
          return { ok: false, status: 409, error: "That preview request is already being processed.", retryAfterSeconds: 1 };
        }
        return { ok: true, value, replayed: false };
      } catch {
        return { ok: false, status: 503, error: STORAGE_ERROR, retryAfterSeconds: 2 };
      }
    } catch (error) {
      if (error instanceof GuardExecutionError) throw error.cause;
      return { ok: false, status: 503, error: STORAGE_ERROR, retryAfterSeconds: 2 };
    }
  }

  private async handleExisting(row: RequestRow, contentKey: string, requestKey: string): Promise<GuardResult<T> | null> {
    const now = this.options.now();
    if (row.fingerprint !== contentKey) {
      return { ok: false, status: 409, error: "That idempotency key was already used for different text." };
    }
    if (row.status === "succeeded" && row.expires_at > now && row.response_ciphertext && row.response_iv) {
      try {
        return {
          ok: true,
          value: JSON.parse(await this.decrypt(row.response_ciphertext, row.response_iv, requestKey)) as T,
          replayed: true,
        };
      } catch {
        return { ok: false, status: 503, error: STORAGE_ERROR, retryAfterSeconds: 2 };
      }
    }
    if (row.status === "active" && row.lease_expires_at > now) {
      return { ok: false, status: 409, error: "That preview request is already being processed.", retryAfterSeconds: 1 };
    }
    return null;
  }

  private read(requestKey: string) {
    return this.db.prepare(
      `SELECT fingerprint, status, lease_expires_at, response_ciphertext, response_iv, expires_at
       FROM preview_guard_requests WHERE request_key = ?`,
    ).bind(requestKey).first<RequestRow>();
  }

  private async classifyAdmission(clientKey: string, now: number, windowStart: number): Promise<GuardResult<T> | null> {
    const state = await this.db.prepare(
      `SELECT
         COALESCE((
           SELECT request_count FROM preview_guard_windows WHERE client_key = ? AND window_start = ?
         ), 0) AS request_count,
         (
           SELECT COUNT(*) FROM preview_guard_requests
           WHERE client_key = ? AND status = 'active' AND lease_expires_at > ?
         ) AS active_count`,
    ).bind(clientKey, windowStart, clientKey, now).first<{ request_count: number; active_count: number }>();
    if (Number(state?.request_count ?? 0) >= PREVIEW_GUARD_LIMITS.maxRequests) {
      return {
        ok: false,
        status: 429,
        error: "Too many previews were requested. Please wait a moment and try again.",
        retryAfterSeconds: Math.max(1, Math.ceil((windowStart + this.options.windowMs - now) / 1_000)),
      };
    }
    if (Number(state?.active_count ?? 0) >= PREVIEW_GUARD_LIMITS.maxConcurrent) {
      return { ok: false, status: 429, error: "Two previews are already being processed. Please wait for one to finish.", retryAfterSeconds: 1 };
    }
    return null;
  }

  private async cleanup(now: number) {
    const oldWindow = Math.floor(now / this.options.windowMs) * this.options.windowMs - this.options.windowMs * 2;
    await this.db.batch([
      this.db.prepare(
        "DELETE FROM preview_guard_requests WHERE request_key IN (SELECT request_key FROM preview_guard_requests WHERE expires_at <= ? LIMIT 100)",
      ).bind(now),
      this.db.prepare(
        "DELETE FROM preview_guard_windows WHERE (client_key, window_start) IN (SELECT client_key, window_start FROM preview_guard_windows WHERE window_start < ? LIMIT 100)",
      ).bind(oldWindow),
    ]);
  }

  private async encryptionKey() {
    const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`preview-response\0${this.secret}`));
    return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  private async encrypt(value: string, requestKey: string) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(requestKey) },
      await this.encryptionKey(),
      new TextEncoder().encode(value),
    );
    return { ciphertext: toBase64Url(new Uint8Array(ciphertext)), iv: toBase64Url(iv) };
  }

  private async decrypt(ciphertext: string, encodedIv: string, requestKey: string) {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(encodedIv), additionalData: new TextEncoder().encode(requestKey) },
      await this.encryptionKey(),
      fromBase64Url(ciphertext),
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  }
}

export function previewGuardClientKey(secret: string, clientId: string) {
  return previewGuardHmac(secret, `client\0${clientId}`);
}

async function previewGuardHmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
