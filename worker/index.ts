/** Cloudflare Worker entry point for the Ownword application. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { runScheduledPurge } from "../src/lib/purge-worker";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledController {
  scheduledTime: number;
  cron: string;
  noRetry(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const response = await handler.fetch(request, env, ctx);
    const headers = new Headers(response.headers);
    headers.set("x-content-type-options", "nosniff");
    headers.set("referrer-policy", "strict-origin-when-cross-origin");
    headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(self)");
    headers.set("x-frame-options", "DENY");
    headers.set("cross-origin-opener-policy", "same-origin");
    headers.set(
      "content-security-policy",
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'",
    );
    if (url.protocol === "https:") {
      headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },

  /**
   * M3-05 purge schedule (cron in vite.config.ts, hourly).
   *
   * A history deletion is not deferred to this handler — /api/history/{id}
   * voids the customer's text inside the request that accepts the deletion.
   * This drains the propagation queue those writes leave behind, and ages out
   * unclaimed anonymous payloads. The second half is the one nothing else
   * guarantees: the opportunistic sweep on the persist path only runs when
   * someone is writing, so on a quiet week nothing enforced the 30 days
   * /privacy promises.
   *
   * Everything is swallowed here on purpose: a scheduled run has no customer
   * waiting, an unhandled rejection would be retried by the platform against a
   * queue that is already idempotent, and a caught D1 error object must never
   * be logged — it can carry the bound parameters of the failing statement,
   * which for this application is the customer's writing. What happened is
   * recorded in `deletion_audit_events`, in a form that cannot hold text.
   */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.DB) return;
    const db = drizzle(env.DB, { schema });
    ctx.waitUntil(runScheduledPurge(db).then(() => undefined, () => undefined));
  },
};

export default worker;
