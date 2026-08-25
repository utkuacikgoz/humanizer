// M4-01: the email magic-link sign-in flow.
//
// Every decision lives here rather than in app/api/auth/**, for the same
// reason src/lib/result-access.ts exists: a route handler cannot be imported
// under plain Node (it reaches for `cloudflare:workers` through db/index),
// and an authentication path that can only be tested through a live Worker
// is an authentication path that does not get tested. The routes supply the
// runtime-bound dependencies and nothing else.
//
// This module must stay free of `cloudflare:workers`, `next/headers`, and
// `next/navigation` imports.
//
// The three properties worth stating outright, because they are what the
// tests in tests/magic-link.test.mts pin:
//
//   * Enumeration safety. Requesting a link never reads the users table, so
//     a registered and an unregistered address take the same path, do the
//     same work, and produce byte-identical responses. The account is created
//     at redemption, not at request, which is what makes that possible.
//   * Single use. Redemption is one guarded UPDATE; the second attempt on a
//     token changes no rows and creates no session.
//   * Fail closed. No mail provider configured means sign-in returns an error
//     and logs it for the operator. It never returns "check your inbox" for
//     mail that was never sent.
import { getOrCreateUserByExternalSubject } from "../../db/billing-repository";
import type { AppDatabase } from "../../db/repository";
import type { SessionIdentity } from "../../db/auth-repository";
import { productConfig } from "@/src/config/product";
import type { EmailSender } from "@/src/lib/email-sender";
import { EmailDeliveryError } from "@/src/lib/email-sender";
import {
  buildSessionCookie,
  clearedSessionCookies,
  digestToken,
  emailSubject,
  isCrossSiteRequest,
  isDevHost,
  isSecureRequest,
  isTrustedIdentityHost,
  normalizeEmail,
  randomToken,
  readSessionCookie,
  safeRelativeReturnPath,
  SESSION_TTL_MS,
  SIGN_IN_PATH,
  TOKEN_SHAPE,
  VERIFY_PATH,
} from "@/src/lib/identity";

/** A link is short-lived on purpose: it is a bearer credential sitting in an inbox. */
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

/** Fixed windows, same shape as the preview guard's. */
export const MAGIC_LINK_LIMITS = {
  windowMs: 60 * 60 * 1000,
  /** Links mailed to one address per hour. This is the mail-bomb bound. */
  perEmail: 5,
  /** Links requested by one client per hour, whatever addresses they name. */
  perClient: 15,
} as const;

const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * The one response a link request can produce on success. Identical for an
 * address with an account, an address without one, and an address that does
 * not exist at all.
 */
export const LINK_SENT_MESSAGE = "If that address can receive mail, a sign-in link is on its way. It expires in 15 minutes.";

export interface AuthPort {
  findSessionIdentity(db: AppDatabase, input: { sessionDigest: string; now: Date }): Promise<SessionIdentity | null>;
  insertMagicLinkToken(db: AppDatabase, input: { tokenDigest: string; email: string; issuedAt: Date; expiresAt: Date }): Promise<void>;
  consumeMagicLinkToken(db: AppDatabase, input: { tokenDigest: string; now: Date }): Promise<{ email: string } | null>;
  consumeOutstandingLinksForEmail(db: AppDatabase, input: { email: string; now: Date }): Promise<void>;
  createSession(db: AppDatabase, input: { sessionDigest: string; userId: string; issuedAt: Date; expiresAt: Date }): Promise<void>;
  deleteSession(db: AppDatabase, sessionDigest: string): Promise<void>;
  admitRateLimitedRequest(db: AppDatabase, input: { bucketKey: string; windowStart: number; limit: number; now: number }): Promise<boolean>;
  purgeExpiredAuthRows(db: AppDatabase, now: Date, windowFloor: number): Promise<void>;
}

export interface MagicLinkDeps {
  db: AppDatabase;
  auth: AuthPort;
  /**
   * Null when no mail provider is configured. Sign-in then fails closed and
   * says so in the Worker log; it never pretends a link was sent.
   */
  sender: EmailSender | null;
  /** Envelope sender, e.g. `Ownword <no-reply@ownword.pro>`. */
  from: string;
  now?: () => Date;
}

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: NO_STORE });
}

/**
 * Loads the runtime dependencies, or null.
 *
 * `getDb()` throws when the D1 binding is missing, and letting that escape a
 * route handler produces a bare 500 with no body — a visitor sees a broken
 * page and an operator sees nothing they can act on. Every entry point below
 * turns null into a specific, honest state instead. The caught error is never
 * logged: a D1 error object can carry the bound parameters of the failing
 * statement.
 */
async function tryLoadDeps(loadDeps: () => Promise<MagicLinkDeps>, context: string): Promise<MagicLinkDeps | null> {
  try {
    return await loadDeps();
  } catch {
    console.error(`[auth] ${context}: the database binding is unavailable, so sign-in cannot proceed`);
    return null;
  }
}

function redirect(location: string, cookies: string[] = []) {
  const headers = new Headers({ ...NO_STORE, location });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  // 303: the browser must follow with a GET even when this answered a POST.
  return new Response(null, { status: 303, headers });
}

/**
 * Cloudflare's own connecting-IP header, which a client cannot forge through
 * the edge. Same parsing as app/api/humanize/route.ts's.
 */
function trustedConnectingIp(request: Request): string | null {
  const value = request.headers.get("cf-connecting-ip")?.trim();
  if (!value || value.length > 64 || /[\s,]/.test(value)) return null;
  return value.toLowerCase();
}

function originOf(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("host")?.trim() || url.host;
  return `${isSecureRequest(request) ? "https" : "http"}://${host}`;
}

/**
 * Bucket keys are one-way digests, never the address or the IP. The tokens
 * table already holds the address it has to mail, so this is not the strongest
 * link in the privacy chain — but a counter table that outlives the token it
 * counted should not be the thing that says who tried to sign in and when.
 */
async function bucketKey(kind: "email" | "client", value: string): Promise<string> {
  return digestToken(`auth-rate-limit\0${kind}\0${value}`);
}

// ---------------------------------------------------------------------------
// POST /api/auth/request-link
// ---------------------------------------------------------------------------

export async function buildSignInRequestResponse(
  request: Request,
  loadDeps: () => Promise<MagicLinkDeps>,
): Promise<Response> {
  if (isCrossSiteRequest(request)) return json({ error: "This request did not come from Ownword." }, 403);
  if (!isTrustedIdentityHost(request)) return json({ error: "Sign-in is not available on this address." }, 404);
  if (!isSecureRequest(request) && !isDevHost(request)) {
    // A sign-in link requested over plain http would be answered with a
    // session cookie that cannot be set securely. Refuse rather than
    // downgrade.
    return json({ error: "Sign-in requires a secure connection." }, 400);
  }
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return json({ error: "Send a JSON body." }, 415);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "The request body is not valid JSON." }, 400);
  }
  if (!payload || typeof payload !== "object") return json({ error: "An email address is required." }, 400);

  const { email: rawEmail, returnTo } = payload as { email?: unknown; returnTo?: unknown };
  const email = normalizeEmail(rawEmail);
  // A malformed address is a formatting problem, not an account fact: saying
  // so reveals nothing about who is registered.
  if (!email) return json({ error: "Enter an email address in the form name@example.com." }, 400);
  const safeReturnTo = safeRelativeReturnPath(typeof returnTo === "string" ? returnTo : "/");

  const clientIp = trustedConnectingIp(request);
  if (!clientIp && !isDevHost(request)) {
    // Same posture as the distributed preview guard: without a client signal
    // the per-client bound cannot be enforced, and an unbounded sign-in
    // endpoint is a mail-bombing service. Fail closed and say so to the
    // operator, not to the visitor.
    console.error("[auth] refusing sign-in: no cf-connecting-ip, so per-client rate limiting cannot be enforced");
    return json({ error: "Sign-in is temporarily unavailable. Please try again shortly." }, 503);
  }

  const deps = await tryLoadDeps(loadDeps, "request-link");
  if (!deps) return json({ error: "Sign-in is temporarily unavailable. Please try again shortly." }, 503);
  const now = (deps.now ?? (() => new Date()))();
  const windowStart = Math.floor(now.getTime() / MAGIC_LINK_LIMITS.windowMs) * MAGIC_LINK_LIMITS.windowMs;

  // The address bound is checked first and always: it is what stops one
  // person's inbox being used as a weapon, and it applies whether or not the
  // address has an account.
  const admittedEmail = await deps.auth.admitRateLimitedRequest(deps.db, {
    bucketKey: await bucketKey("email", email),
    windowStart,
    limit: MAGIC_LINK_LIMITS.perEmail,
    now: now.getTime(),
  });
  if (!admittedEmail) return rateLimited(now, windowStart);

  if (clientIp) {
    const admittedClient = await deps.auth.admitRateLimitedRequest(deps.db, {
      bucketKey: await bucketKey("client", clientIp),
      windowStart,
      limit: MAGIC_LINK_LIMITS.perClient,
      now: now.getTime(),
    });
    if (!admittedClient) return rateLimited(now, windowStart);
  }

  if (!deps.sender) {
    // Loud on the server, honest to the visitor. The alternative — a cheerful
    // "check your inbox" for mail nobody sent — is the failure mode this
    // branch exists to prevent.
    console.error("[auth] RESEND_API_KEY is not configured, so no sign-in link can be sent. Set it as a Worker secret.");
    return json({ error: "Sign-in email is not configured yet. Please contact support." }, 503);
  }

  const token = randomToken();
  const expiresAt = new Date(now.getTime() + MAGIC_LINK_TTL_MS);
  await deps.auth.insertMagicLinkToken(deps.db, {
    tokenDigest: await digestToken(token),
    email,
    issuedAt: now,
    expiresAt,
  });

  const link = `${originOf(request)}${VERIFY_PATH}?token=${encodeURIComponent(token)}&return_to=${encodeURIComponent(safeReturnTo)}`;
  try {
    await deps.sender.send({ to: email, ...composeMagicLinkEmail(link) });
  } catch (error) {
    // Only the self-generated code, never the provider response and never the
    // message: the message contains the link.
    const code = error instanceof EmailDeliveryError ? error.code : "unknown";
    console.error("[auth] sign-in link could not be delivered:", code);
    return json({ error: "The sign-in email could not be sent. Please try again." }, 502);
  }

  // Opportunistic hygiene on a write path, bounded, and never able to fail the
  // request — the same pattern as db/repository.ts's retention sweep.
  try {
    await deps.auth.purgeExpiredAuthRows(deps.db, now, windowStart - MAGIC_LINK_LIMITS.windowMs * 2);
  } catch { /* cleanup is opportunistic */ }

  return json({ ok: true, message: LINK_SENT_MESSAGE }, 200);
}

function rateLimited(now: Date, windowStart: number) {
  const retryAfter = Math.max(1, Math.ceil((windowStart + MAGIC_LINK_LIMITS.windowMs - now.getTime()) / 1000));
  return Response.json(
    { error: "Too many sign-in links were requested. Please wait a little and try again." },
    { status: 429, headers: { ...NO_STORE, "retry-after": String(retryAfter) } },
  );
}

/** Plain text and HTML say exactly the same thing; no tracking pixel, no redirect wrapper. */
export function composeMagicLinkEmail(link: string): { subject: string; text: string; html: string } {
  const product = productConfig.productName;
  const subject = `Your ${product} sign-in link`;
  const text = [
    `Sign in to ${product}`,
    "",
    "Open this link to sign in:",
    link,
    "",
    "The link works once and expires in 15 minutes.",
    "If you did not ask to sign in, you can ignore this message. Nothing has changed on your account.",
    "",
    product,
  ].join("\n");
  const html = [
    `<p>Sign in to ${escapeHtml(product)}</p>`,
    `<p><a href="${escapeHtml(link)}">Sign in to ${escapeHtml(product)}</a></p>`,
    `<p>The link works once and expires in 15 minutes.</p>`,
    `<p>If you did not ask to sign in, you can ignore this message. Nothing has changed on your account.</p>`,
  ].join("\n");
  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// GET /api/auth/verify
// ---------------------------------------------------------------------------

/** Every failed redemption lands here. One destination for expired, unknown, tampered, and already-used. */
function failedVerification(returnTo: string) {
  return redirect(`${SIGN_IN_PATH}?error=link&return_to=${encodeURIComponent(returnTo)}`);
}

export async function buildVerifyResponse(
  request: Request,
  loadDeps: () => Promise<MagicLinkDeps>,
): Promise<Response> {
  const url = new URL(request.url);
  const safeReturnTo = safeRelativeReturnPath(url.searchParams.get("return_to") ?? "/");

  if (!isTrustedIdentityHost(request)) return failedVerification("/");
  if (!isSecureRequest(request) && !isDevHost(request)) return failedVerification(safeReturnTo);

  const token = url.searchParams.get("token") ?? "";
  // A token of the wrong shape is refused before a query is built, and gets
  // the same answer as a well-formed one that turns out to be spent.
  if (!TOKEN_SHAPE.test(token)) return failedVerification(safeReturnTo);

  const deps = await tryLoadDeps(loadDeps, "verify");
  // A database outage is not an expired link, and telling the customer it is
  // would send them round a loop that cannot work. Distinct state, distinct
  // message.
  if (!deps) return redirect(`${SIGN_IN_PATH}?error=unavailable&return_to=${encodeURIComponent(safeReturnTo)}`);
  const now = (deps.now ?? (() => new Date()))();

  const consumed = await deps.auth.consumeMagicLinkToken(deps.db, {
    tokenDigest: await digestToken(token),
    now,
  });
  if (!consumed) return failedVerification(safeReturnTo);

  // First successful sign-in is what creates the account. The subject is
  // namespaced so an address identity can never collide with the ChatGPT
  // subjects already in this column.
  const { userId } = await getOrCreateUserByExternalSubject(deps.db, {
    externalSubject: emailSubject(consumed.email),
    email: consumed.email,
  });

  const sessionId = randomToken();
  const cookie = buildSessionCookie(request, sessionId, Math.floor(SESSION_TTL_MS / 1000));
  if (!cookie) {
    // Unreachable given the secure check above; kept because silently issuing
    // a session with no cookie would look like a successful sign-in that does
    // not stick.
    return failedVerification(safeReturnTo);
  }

  // Rotate: whatever session this browser arrived with is destroyed before the
  // new one exists, so a fixated session id cannot survive a sign-in.
  const presented = readSessionCookie(request);
  if (presented) {
    try { await deps.auth.deleteSession(deps.db, await digestToken(presented)); } catch { /* rotation is best effort */ }
  }

  await deps.auth.createSession(deps.db, {
    sessionDigest: await digestToken(sessionId),
    userId,
    issuedAt: now,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
  });

  // Any other link already sitting in that inbox is dead now.
  try { await deps.auth.consumeOutstandingLinksForEmail(deps.db, { email: consumed.email, now }); } catch { /* best effort */ }

  return redirect(safeReturnTo, [cookie]);
}

// ---------------------------------------------------------------------------
// GET /api/auth/session
// ---------------------------------------------------------------------------

/**
 * What the sign-in page needs to know about the visitor, and nothing more.
 *
 * The session cookie is HttpOnly, so a page cannot tell whether it is signed
 * in without asking. Answering only for the caller's own cookie reveals
 * nothing to anyone else, and the shape is deliberately tiny: signed-in or
 * not, and the address the link was sent to, which the customer typed.
 */
export async function buildSessionStateResponse(
  request: Request,
  loadDeps: () => Promise<MagicLinkDeps>,
): Promise<Response> {
  const presented = readSessionCookie(request);
  if (!presented || !TOKEN_SHAPE.test(presented)) return json({ signedIn: false }, 200);

  try {
    const deps = await tryLoadDeps(loadDeps, "session-state");
    if (!deps) return json({ error: "Sign-in state is unavailable right now." }, 503);
    const now = (deps.now ?? (() => new Date()))();
    const identity = await deps.auth.findSessionIdentity(deps.db, {
      sessionDigest: await digestToken(presented),
      now,
    });
    if (!identity) return json({ signedIn: false }, 200);
    return json({ signedIn: true, email: identity.email }, 200);
  } catch {
    // Never claim someone is signed out on a lookup failure: the page would
    // offer to mail a link to someone who already holds a live session.
    return json({ error: "Sign-in state is unavailable right now." }, 503);
  }
}

// ---------------------------------------------------------------------------
// POST /api/auth/signout
// ---------------------------------------------------------------------------

export async function buildSignOutResponse(
  request: Request,
  loadDeps: () => Promise<MagicLinkDeps>,
): Promise<Response> {
  if (isCrossSiteRequest(request)) return json({ error: "This request did not come from Ownword." }, 403);

  const presented = readSessionCookie(request);
  if (presented && TOKEN_SHAPE.test(presented)) {
    try {
      const deps = await tryLoadDeps(loadDeps, "signout");
      if (!deps) return json({ error: "Sign-out could not be completed. Please try again." }, 503);
      // The row goes, not just the cookie: clearing a cookie the customer's
      // browser holds does nothing about a copy of it somewhere else.
      await deps.auth.deleteSession(deps.db, await digestToken(presented));
    } catch {
      // Never tell someone they are signed out when the session may still be
      // live server-side.
      return json({ error: "Sign-out could not be completed. Please try again." }, 503);
    }
  }

  return redirect("/", clearedSessionCookies(request));
}
