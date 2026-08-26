/** Cloudflare Worker entry point for the Ownword application. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { runScheduledPurge } from "../src/lib/purge-worker";
import { canonicalOrigin, normalizeHost } from "../src/lib/public-pages";
import { recordRuntimeEnvironment } from "../src/lib/runtime-environment";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  /** `production` on a deployed build; see vite.config.ts's workerBindingConfig. */
  ENVIRONMENT?: string;
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

/**
 * SEO-003 handoff H-3. `www.ownword.pro` is bound as a second custom domain
 * (see `productionRoutes()` in vite.config.ts), so before this it served the
 * entire application on a second hostname. The host gate in
 * app/robots.txt/route.ts and src/lib/public-pages.ts kept that copy out of
 * the index — off the canonical host everything is `Disallow: /` and
 * `noindex` — so nothing duplicate was ever indexed. What it could not do is
 * consolidate: a link, a share, or a typed `www` URL earned the apex nothing.
 *
 * 308 rather than 301 on purpose. A 301 lets a client rewrite the method to
 * GET, which would silently drop the body of a POST to `/api/*` or to the
 * Stripe webhook path if either were ever addressed through `www`. 308 is the
 * permanent redirect that promises method and body survive, and search
 * engines treat it exactly as they treat a 301 for consolidation.
 *
 * The decision reads the real request host, never `x-forwarded-host`: an
 * inbound header claiming to be `www` while the socket is on the apex would
 * redirect the apex to itself, forever.
 */
function redirectWwwToApex(request: Request, url: URL): Response | null {
  const canonical = canonicalOrigin();
  if (!canonical) return null;

  const host = normalizeHost(request.headers.get("host") ?? url.host);
  if (host !== `www.${canonical.host.toLowerCase()}`) return null;

  const target = new URL(url.pathname + url.search, canonical.origin);
  return new Response(null, {
    status: 308,
    headers: { location: target.toString(), "cache-control": "public, max-age=3600" },
  });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // SEC-22. This is the only place the runtime bindings are in scope before
    // a route runs, so it is where the deployment identity is recorded for
    // the pure modules that must not import `cloudflare:workers`. Cheap and
    // idempotent: it writes one module-level string per isolate.
    recordRuntimeEnvironment(env.ENVIRONMENT);

    const url = new URL(request.url);

    const wwwRedirect = redirectWwwToApex(request, url);
    if (wwwRedirect) return wwwRedirect;

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
