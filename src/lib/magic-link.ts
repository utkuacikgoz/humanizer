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
  buildLinkNonceCookie,
  canonicalEmailForRateLimit,
  clientRateLimitKey,
  buildSessionCookie,
  clearedLinkNonceCookies,
  clearedSessionCookies,
  digestToken,
  emailSubject,
  isCrossSiteRequest,
  isDevHost,
  isSameOriginRequest,
  isSecureRequest,
  isTrustedIdentityHost,
  normalizeEmail,
  randomToken,
  readLinkNonceCookie,
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
  /**
   * Links mailed to one address per hour, on the exact string the customer
   * typed. Kept, but it is no longer the mail-bomb bound on its own: see
   * `perInbox`.
   */
  perEmail: 5,
  /**
   * SEC-19. Links mailed to one INBOX per hour, counted on the address folded
   * to what the mail provider will actually deliver to
   * (`canonicalEmailForRateLimit`). This is the mail-bomb bound.
   *
   * The exact-string bucket was described as that bound and was not: ten
   * `+tag` and dot aliases of one Gmail address were accepted from a single
   * source, each with its own budget, and refusal only arrived at 15 from the
   * per-client bound. Three times the documented figure, delivered to one
   * inbox as genuine correctly-signed mail from a verified domain.
   */
  perInbox: 5,
  /** Links requested by one client per hour, whatever addresses they name. */
  perClient: 15,
  /**
   * SEC-20. Redemption attempts admitted from one client per hour.
   *
   * Redemption was the one write path in this flow with no bound at all: 25
   * invented tokens were answered with 25 redirects and 50 UPDATEs, no
   * refusal at any point. The tokens are not guessable — 256 bits of CSPRNG,
   * and the single-use guard holds — so what this closes is not credential
   * guessing but a free unauthenticated write amplifier against the database
   * that also serves entitlement and quota decisions.
   *
   * Generous on purpose. A person redeems one or two links an hour; a mail
   * provider that prefetches links, a customer retrying a stale tab, and the
   * confirmation POST following its own GET all spend from this budget, and
   * refusing a real sign-in is a worse outcome than admitting a few dozen
   * failed lookups.
   */
  perClientVerify: 30,
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
  insertMagicLinkToken(db: AppDatabase, input: { tokenDigest: string; email: string; issuedAt: Date; expiresAt: Date; browserNonceDigest?: string | null }): Promise<void>;
  consumeMagicLinkToken(db: AppDatabase, input: { tokenDigest: string; now: Date }): Promise<{ email: string } | null>;
  consumeMagicLinkTokenForBrowser(db: AppDatabase, input: { tokenDigest: string; nonceDigest: string; now: Date }): Promise<{ email: string } | null>;
  findMagicLinkTokenState(db: AppDatabase, input: { tokenDigest: string; now: Date }): Promise<{ issued: boolean; redeemable: boolean; email: string | null }>;
  recordMagicLinkAttempt(db: AppDatabase, tokenDigest: string): Promise<void>;
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
async function bucketKey(kind: "email" | "inbox" | "client" | "verify", value: string): Promise<string> {
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
  //
  // SEC-19: two buckets, not one. The inbox bucket is the real bound — it
  // folds `+tag` and (at providers that do it) dots, so aliases of one
  // address share one budget. The exact-string bucket stays alongside it
  // because folding is a heuristic about delivery, and a heuristic must not
  // be the only thing bounding a mail path.
  const admittedInbox = await deps.auth.admitRateLimitedRequest(deps.db, {
    bucketKey: await bucketKey("inbox", canonicalEmailForRateLimit(email)),
    windowStart,
    limit: MAGIC_LINK_LIMITS.perInbox,
    now: now.getTime(),
  });
  if (!admittedInbox) return rateLimited(now, windowStart);

  const admittedEmail = await deps.auth.admitRateLimitedRequest(deps.db, {
    bucketKey: await bucketKey("email", email),
    windowStart,
    limit: MAGIC_LINK_LIMITS.perEmail,
    now: now.getTime(),
  });
  if (!admittedEmail) return rateLimited(now, windowStart);

  if (clientIp) {
    const admittedClient = await deps.auth.admitRateLimitedRequest(deps.db, {
      // SEC-19, second half: an IPv6 client holding a routine /64 has 2^64
      // source addresses, so bucketing on the literal address means this
      // bound stops bounding anything the moment an attacker is on IPv6.
      bucketKey: await bucketKey("client", clientRateLimitKey(clientIp)),
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

  // SEC-17. The nonce is minted here and lives in two places that must both
  // be present for a one-click sign-in: a cookie on this browser, and its
  // digest on the token row. Neither alone is a credential — the cookie
  // names no token and the digest cannot be presented — and an attacker who
  // mails their own link to a victim controls the row but not the victim's
  // cookie jar, which is the whole of the fix.
  const nonce = randomToken();
  const nonceCookie = buildLinkNonceCookie(request, nonce, Math.ceil(MAGIC_LINK_TTL_MS / 1000));

  await deps.auth.insertMagicLinkToken(deps.db, {
    tokenDigest: await digestToken(token),
    email,
    issuedAt: now,
    expiresAt,
    // Null when this request cannot carry a cookie safely. That link is still
    // mailed and still works; it just takes the confirmation step.
    browserNonceDigest: nonceCookie ? await digestToken(nonce) : null,
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

  // The nonce rides back on the success response and on nothing else, so it
  // is set for a registered and an unregistered address alike — the
  // enumeration property is untouched.
  const headers = new Headers(NO_STORE);
  if (nonceCookie) headers.append("set-cookie", nonceCookie);
  return Response.json({ ok: true, message: LINK_SENT_MESSAGE }, { status: 200, headers });
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
// GET /api/auth/verify  — redeem, or offer confirmation
// POST /api/auth/verify — the confirmed redemption
// ---------------------------------------------------------------------------
//
// SEC-17, and the shape of the fix, because it is easy to undo by accident.
//
// The vulnerability was login CSRF: redemption was a bare GET with no
// cross-site control at all, and `SameSite=Lax` deliberately permits the
// top-level GET navigation that opening an emailed link is. An attacker
// requested a link for their OWN address, mailed it on, and the victim's
// click silently made their browser the attacker's account — after which the
// victim's drafts were written to the attacker's history.
//
// Adding `isCrossSiteRequest` here would not have fixed it. A link opened
// from a mail client arrives with no Origin at all, so that check cannot
// distinguish the honest case from the hostile one on this route.
//
// What actually distinguishes them is WHICH BROWSER ASKED. So:
//
//   * One click, no interruption, when the browser presents the nonce cookie
//     it was given at request time. That is the overwhelmingly common case —
//     request a link, click it in the same browser — and it is settled by one
//     guarded UPDATE carrying the nonce digest in its WHERE clause.
//   * Otherwise: no session, and no failure either. Opening a link on a
//     different device is a real and ordinary thing to do, and refusing it
//     would trade a security bug for a support queue. Instead the link lands
//     on a page that NAMES the address it is about to sign in as and asks for
//     a POST.
//
// The POST is what closes the attack. A top-level navigation cannot issue
// one, a cross-site form POST carries an Origin naming the attacker's site,
// and this route refuses any POST that does not carry a same-site Origin. So
// the attacker's mailed link can, at absolute best, show the victim a page
// saying "You are about to sign in as attacker@example.com" — which is not an
// attack, it is a warning.

/** Every failed redemption lands here. One destination for expired, unknown, tampered, and already-used. */
function failedVerification(returnTo: string) {
  return redirect(`${SIGN_IN_PATH}?error=link&return_to=${encodeURIComponent(returnTo)}`);
}

/**
 * SEC-20. The bound on redemption, shared by the navigation and the confirmed
 * POST so the two cannot be played off against each other.
 *
 * Returns null when the attempt is admitted, or the response to send instead.
 * That response is the "unavailable" state, never "expired link": a customer
 * throttled behind a shared address holds a link that is still perfectly
 * good, and telling them it expired would send them round a loop that cannot
 * work.
 *
 * No client signal and not a dev host is refused, matching the request path.
 * It is the same `cf-connecting-ip` header, so if it were ever absent no
 * links would have been issued to redeem in the first place.
 */
async function admitRedemption(
  request: Request,
  deps: MagicLinkDeps,
  now: Date,
  safeReturnTo: string,
): Promise<Response | null> {
  const unavailable = () => redirect(`${SIGN_IN_PATH}?error=unavailable&return_to=${encodeURIComponent(safeReturnTo)}`);

  const clientIp = trustedConnectingIp(request);
  if (!clientIp) {
    if (isDevHost(request)) return null;
    console.error("[auth] refusing redemption: no cf-connecting-ip, so the per-client bound cannot be enforced");
    return unavailable();
  }

  const windowStart = Math.floor(now.getTime() / MAGIC_LINK_LIMITS.windowMs) * MAGIC_LINK_LIMITS.windowMs;
  const admitted = await deps.auth.admitRateLimitedRequest(deps.db, {
    bucketKey: await bucketKey("verify", clientRateLimitKey(clientIp)),
    windowStart,
    limit: MAGIC_LINK_LIMITS.perClientVerify,
    now: now.getTime(),
  });
  return admitted ? null : unavailable();
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

  const throttled = await admitRedemption(request, deps, now, safeReturnTo);
  if (throttled) return throttled;

  const tokenDigest = await digestToken(token);

  const nonce = readLinkNonceCookie(request);
  if (nonce && TOKEN_SHAPE.test(nonce)) {
    const consumed = await deps.auth.consumeMagicLinkTokenForBrowser(deps.db, {
      tokenDigest,
      nonceDigest: await digestToken(nonce),
      now,
    });
    // Matched: this is the browser that asked. One click, nothing in the way.
    if (consumed) return completeSignIn(request, deps, consumed.email, now, safeReturnTo);
  }

  // No nonce, or one that binds a different link. Not a failure and not a
  // sign-in: a question. Read-only, and it decides only which page to render.
  const pending = await deps.auth.findMagicLinkTokenState(deps.db, { tokenDigest, now });
  // A dead link answers exactly as it always did, so expired, spent, unknown
  // and tampered remain one indistinguishable outcome. The attempt is counted
  // here and only here on this path: a nonce that does not match a LIVE link
  // is an ordinary second device, not evidence of anything, and counting it
  // would turn the column into noise.
  //
  // SEC-20: the counter UPDATE runs only against a digest that was actually
  // issued. Against an invented one it matched no row and recorded nothing,
  // so it was pure write amplification.
  if (!pending.redeemable || !pending.email) {
    if (pending.issued) {
      try { await deps.auth.recordMagicLinkAttempt(deps.db, tokenDigest); } catch { /* evidence, not a control */ }
    }
    return failedVerification(safeReturnTo);
  }

  return confirmationPage(pending.email, token, safeReturnTo);
}

export async function buildVerifyConfirmationResponse(
  request: Request,
  loadDeps: () => Promise<MagicLinkDeps>,
): Promise<Response> {
  if (!isTrustedIdentityHost(request)) return failedVerification("/");
  if (!isSecureRequest(request) && !isDevHost(request)) return failedVerification("/");

  // The control the whole confirmation step exists to apply, and it runs
  // before anything is read or written. `isSameOriginRequest`, not
  // `isCrossSiteRequest`: this request carries no session cookie by
  // construction, so `SameSite=Lax` protects nothing here and a missing
  // Origin cannot be given the benefit of the doubt.
  if (!isSameOriginRequest(request)) return refusedConfirmation();

  if (!request.headers.get("content-type")?.toLowerCase().includes("application/x-www-form-urlencoded")) {
    return refusedConfirmation();
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return failedVerification("/");
  }

  const rawReturnTo = form.get("return_to");
  const safeReturnTo = safeRelativeReturnPath(typeof rawReturnTo === "string" ? rawReturnTo : "/");
  const rawToken = form.get("token");
  const token = typeof rawToken === "string" ? rawToken : "";
  if (!TOKEN_SHAPE.test(token)) return failedVerification(safeReturnTo);

  const deps = await tryLoadDeps(loadDeps, "verify-confirm");
  if (!deps) return redirect(`${SIGN_IN_PATH}?error=unavailable&return_to=${encodeURIComponent(safeReturnTo)}`);
  const now = (deps.now ?? (() => new Date()))();

  const throttled = await admitRedemption(request, deps, now, safeReturnTo);
  if (throttled) return throttled;

  // Single use is still one guarded write. The nonce is deliberately not
  // required here — that is the point of this path — so the Origin check
  // above is the only thing standing in for it, and it stands alone.
  const consumed = await deps.auth.consumeMagicLinkToken(deps.db, {
    tokenDigest: await digestToken(token),
    now,
  });
  if (!consumed) return failedVerification(safeReturnTo);

  return completeSignIn(request, deps, consumed.email, now, safeReturnTo);
}

/**
 * Everything that happens once a token has been consumed, shared by the
 * one-click and the confirmed path so the two cannot drift. Both arrive here
 * having ALREADY spent the token on one guarded write; nothing below re-opens
 * that decision.
 */
async function completeSignIn(
  request: Request,
  deps: MagicLinkDeps,
  email: string,
  now: Date,
  safeReturnTo: string,
): Promise<Response> {
  // First successful sign-in is what creates the account. The subject is
  // namespaced so an address identity can never collide with the ChatGPT
  // subjects already in this column.
  const { userId } = await getOrCreateUserByExternalSubject(deps.db, {
    externalSubject: emailSubject(email),
    email,
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
  try { await deps.auth.consumeOutstandingLinksForEmail(deps.db, { email, now }); } catch { /* best effort */ }

  // The nonce has done its one job. It is cleared alongside the session being
  // issued so it cannot bind a later link it was never minted for.
  return redirect(safeReturnTo, [cookie, ...clearedLinkNonceCookies(request)]);
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

// ---------------------------------------------------------------------------
// The confirmation step
// ---------------------------------------------------------------------------
//
// Plain server-rendered HTML rather than a React page, for one reason: the
// token must not travel any further than it already has. A Next page would
// have to be reached by a redirect carrying the token in its URL, putting it
// in a second address bar entry and a second history record. Answering here,
// at the URL the mail client already opened, keeps the token in a hidden
// field that leaves only as a POST body.
//
// No script and no external asset: the page's whole job is to be a form, and
// the site's CSP (`form-action 'self'`) is a third control on where that form
// can go.

const CONFIRM_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  // Nothing here is for a search engine, and an indexed page carrying a
  // spent token is a support ticket at best.
  "x-robots-tag": "noindex, nofollow",
} as const;

const CONFIRM_STYLE = [
  ":root{color-scheme:light dark}",
  "*{box-sizing:border-box}",
  "body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;",
  "font:16px/1.55 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;",
  "background:#faf9f6;color:#14171a}",
  "main{width:100%;max-width:34rem;background:#fff;border:1px solid #e4e2dc;border-radius:16px;padding:32px 28px}",
  "h1{margin:0 0 4px;font-size:1.35rem;letter-spacing:-.02em}",
  ".brand{margin:0 0 20px;font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;color:#6b7076}",
  "p{margin:0 0 16px;color:#41474d}",
  ".address{display:block;margin:0 0 16px;padding:12px 14px;border:1px solid #e4e2dc;border-radius:10px;",
  "background:#faf9f6;font-weight:600;color:#14171a;overflow-wrap:anywhere}",
  "button{appearance:none;border:1px solid #14171a;background:#14171a;color:#fff;border-radius:999px;",
  "padding:12px 22px;font:inherit;font-weight:550;cursor:pointer}",
  "button:hover{background:#000}",
  "a{color:#41474d}",
  ".note{margin:20px 0 0;font-size:.85rem;color:#6b7076}",
  "@media (prefers-color-scheme:dark){",
  "body{background:#111315;color:#f2f1ee}",
  "main{background:#191c1e;border-color:#2c3033}",
  "p{color:#c3c7cb}.address{background:#111315;border-color:#2c3033;color:#f2f1ee}",
  ".brand,.note{color:#8d9298}",
  "button{background:#f2f1ee;border-color:#f2f1ee;color:#14171a}button:hover{background:#fff}",
  "a{color:#c3c7cb}}",
].join("");

function confirmPageShell(title: string, body: string, status: number): Response {
  const product = escapeHtml(productConfig.productName);
  return new Response(
    [
      "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">",
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
      "<meta name=\"robots\" content=\"noindex, nofollow\">",
      `<title>${escapeHtml(title)} | ${product}</title>`,
      `<style>${CONFIRM_STYLE}</style></head><body><main>`,
      `<p class="brand">${product}</p>`,
      body,
      "</main></body></html>",
    ].join(""),
    { status, headers: CONFIRM_HEADERS },
  );
}

/**
 * The page a link opened in a different browser lands on.
 *
 * Naming the address is the security control, not a courtesy. The attack this
 * whole path exists to stop ends with a victim signed into someone else's
 * account without knowing it; a page that states, before anything happens,
 * exactly whose account this is turns that from a silent compromise into an
 * obvious "that is not my address".
 */
function confirmationPage(email: string, token: string, safeReturnTo: string): Response {
  const body = [
    "<h1>Confirm this sign-in</h1>",
    "<p>This link will sign this browser in as:</p>",
    `<span class="address">${escapeHtml(email)}</span>`,
    "<p>If that is not your address, close this page. Someone else&#39;s sign-in link ",
    "will sign you into <em>their</em> account, and anything you write here would be saved to it.</p>",
    "<form method=\"post\" action=\"",
    escapeHtml(VERIFY_PATH),
    "\">",
    `<input type="hidden" name="token" value="${escapeHtml(token)}">`,
    `<input type="hidden" name="return_to" value="${escapeHtml(safeReturnTo)}">`,
    "<button type=\"submit\">Yes, sign me in</button>",
    "</form>",
    "<p class=\"note\">This step appears because the link was opened in a different browser ",
    "from the one that asked for it, which is normal when you open it on another device. ",
    "The link still works once and still expires 15 minutes after it was sent.</p>",
  ].join("");
  return confirmPageShell("Confirm this sign-in", body, 200);
}

/**
 * A POST that did not come from this site. This is the attack landing, so it
 * says what happened plainly and offers only a route back to a sign-in the
 * visitor starts themselves.
 */
function refusedConfirmation(): Response {
  const body = [
    "<h1>This sign-in was not completed</h1>",
    "<p>This request did not come from ",
    escapeHtml(productConfig.productName),
    ", so nobody was signed in and nothing was changed.</p>",
    `<p><a href="${escapeHtml(SIGN_IN_PATH)}">Go to sign in</a> and request a link yourself.</p>`,
  ].join("");
  return confirmPageShell("Sign-in not completed", body, 403);
}
