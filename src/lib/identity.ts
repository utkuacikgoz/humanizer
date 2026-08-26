// Identity for Ownword: session-cookie resolution, the host containment gate,
// and the safe return-path logic every sign-in link shares.
//
// This replaces the ChatGPT-header identity this app was born with. That
// scheme read `oai-authenticated-user-*` request headers, which were
// trustworthy only because the OpenAI app-hosting boundary injected them and
// stripped any client-supplied copy. On ownword.pro — a plain Cloudflare
// Worker on a custom domain — nothing injects or strips them, so they were
// simultaneously useless (nobody could sign in) and dangerous (anyone could
// send them). They are gone; a session cookie backed by a server-side row is
// the only identity now.
//
// No `next/headers`, `next/navigation`, or `cloudflare:workers` imports, so
// this is directly importable from route handlers holding a real `Request`
// and from plain-Node tests that invoke routes as functions. The
// ambient-request-context variants for RSC/page code live in app/auth.ts,
// which wraps these — keep that split.
import { productConfig } from "@/src/config/product";
import { isProductionEnvironment } from "@/src/lib/runtime-environment";
import type { AppDatabase } from "../../db/repository";
import type { SessionIdentity } from "../../db/auth-repository";

export type { SessionIdentity };

/** Where a signed-out visitor is sent. A real page in this repository, unlike the platform route it replaces. */
export const SIGN_IN_PATH = "/signin";
/** POST-only: ending a session is a state change, so it is never a link. */
export const SIGN_OUT_PATH = "/api/auth/signout";
export const REQUEST_LINK_PATH = "/api/auth/request-link";
export const VERIFY_PATH = "/api/auth/verify";

const HOST_HEADER = "host";
// Hosts served directly by the runtime, outside the trusted boundary.
const DEV_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The session cookie.
 *
 * `__Host-` is the strong form: a browser only accepts it when the cookie is
 * Secure, host-only (no Domain), and Path=/, which means no sibling
 * subdomain and no network attacker on a plain-http origin can plant one for
 * ownword.pro. It is also the reason there are two names: `__Host-` REQUIRES
 * Secure, and Secure cookies are not set over plain http, so a http://localhost
 * dev server would silently never receive a session and the whole flow would
 * look broken for reasons no error message explains.
 *
 * So: https gets the `__Host-` cookie, a plain-http *dev host* gets the
 * unprefixed name, and plain http anywhere else gets nothing at all. Secure is
 * never quietly dropped in production; issuing a session there simply fails.
 * The unprefixed name is likewise only ever READ on a dev host, so the
 * subdomain-injection weakness it carries cannot exist in production.
 */
export const SESSION_COOKIE = "__Host-ownword_session";
export const DEV_SESSION_COOKIE = "ownword_session";

/**
 * SEC-17. The link nonce: what binds a sign-in link to the browser that
 * asked for it.
 *
 * `SameSite=Lax` is what makes the session cookie a login-CSRF problem in the
 * first place — it deliberately permits top-level GET navigation, which is
 * exactly what opening an emailed link is — and it is also, unavoidably, what
 * this cookie needs. A `Strict` cookie is withheld on a navigation that
 * originates outside the site, and every click from a mail client is one, so
 * `Strict` here would mean the nonce never arrives and NOBODY ever redeems in
 * one click.
 *
 * `Lax` does not weaken the binding. An attacker's forged navigation carries
 * the VICTIM's nonce cookie, and the victim's nonce does not match the digest
 * stored against the attacker's token row. What the cookie proves is not
 * "this navigation was same-site" but "this browser is the one that asked",
 * and that is the property the attack needs to be missing.
 *
 * Two names for the same reason the session cookie has two: `__Host-` requires
 * Secure, and Secure cookies are not set over plain http, so a http://localhost
 * dev server would never receive one.
 */
export const LINK_NONCE_COOKIE = "__Host-ownword_link";
export const DEV_LINK_NONCE_COOKIE = "ownword_link";

/** 30 days. Long enough not to nag a paying customer, short enough that a stolen cookie is not forever. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * SEC-01, carried forward. Identity is honored only on the configured
 * production domain or a local dev host. Everywhere else — a preview alias,
 * an unknown route that reaches the Worker — the caller is anonymous, which
 * fails closed: no entitlement, no unlock, no portal.
 *
 * Under header identity this was containment against forged headers. Under
 * cookie identity it does something narrower but still worth keeping: a
 * session cookie presented on any other Host is refused, so an origin that
 * somehow serves this Worker under a different name cannot be used to
 * exercise a real customer's session.
 */
export function isTrustedIdentityHost(source: Request | Headers): boolean {
  const hostname = hostnameOf(source);
  if (!hostname) return false;
  // Via isDevHost, so a production isolate does not claim a dev host at all:
  // there is one gate on the dev names, not two that can drift (SEC-22).
  if (isDevHost(source)) return true;
  const configured = productConfig.domain.trim().toLowerCase();
  if (!configured) return false;
  return hostname === configured || hostname === `www.${configured}`;
}

export function isDevHost(source: Request | Headers): boolean {
  // SEC-22. The unprefixed, non-`Secure` cookie name is reachable only
  // through this predicate, and until now the only thing keeping it out of
  // production was `workers_dev: false` plus custom-domain-only routes in
  // vite.config.ts. That is routing configuration holding a security
  // property. A production build declares `ENVIRONMENT: "production"`
  // (vite.config.ts), and this makes the code hold it: on that binding the
  // dev host set is empty, whatever Host header arrives.
  if (isProductionEnvironment()) return false;
  return DEV_HOSTS.has(hostnameOf(source));
}

/**
 * The Host header is authoritative when present (Workers always populate it).
 * A bare `Headers` with no host falls back to nothing, so callers holding a
 * Request should pass the Request and let its URL answer.
 */
function hostnameOf(source: Request | Headers): string {
  const headers = source instanceof Headers ? source : source.headers;
  const fromHeader = (headers.get(HOST_HEADER) ?? "").trim();
  if (fromHeader) return fromHeader.toLowerCase().split(":")[0];
  if (!(source instanceof Headers)) {
    try { return new URL(source.url).hostname.toLowerCase(); } catch { return ""; }
  }
  return "";
}

/**
 * True when the connection carrying this request is TLS-protected.
 *
 * SEC-22. This used to read `x-forwarded-proto` FIRST and fall back to the
 * URL. On a Cloudflare Worker that is exactly backwards: the request URL is
 * populated by the runtime and is unforgeable, while the header is neither.
 * A genuine https sign-in request carrying `x-forwarded-proto: http` was
 * answered "Sign-in requires a secure connection" and mailed nothing, and a
 * request carrying both `Host: localhost` and `x-forwarded-proto: http` was
 * issued the unprefixed, non-`Secure` cookie name.
 *
 * Only self-denial was reachable through it, because headers cannot be
 * injected into someone else's request. But two security properties this
 * module states outright — that Secure is never quietly dropped, and that the
 * unprefixed cookie name is only ever read on a dev host — were resting on a
 * client-controlled value. They rest on the URL now. The header is consulted
 * only when the URL yields no scheme at all, which on a Worker does not
 * happen.
 */
export function isSecureRequest(request: Request): boolean {
  try {
    const protocol = new URL(request.url).protocol;
    if (protocol === "https:" || protocol === "http:") return protocol === "https:";
  } catch { /* fall through to the header */ }
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0].trim().toLowerCase();
  return forwarded === "https";
}

export function signInPath(returnTo: string): string {
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}

export function signOutPath(): string {
  return SIGN_OUT_PATH;
}

/**
 * The open-redirect guard. A sign-in link that can be pointed at another
 * origin is a phishing primitive: the victim signs in for real and is then
 * handed to the attacker's page wearing the site's own credibility. There is
 * exactly one copy of this check and every path that honors a `return_to`
 * uses it — the emailed link, the sign-in page, and every "sign in" CTA.
 *
 * Absolute URLs, protocol-relative `//evil.test` (which `new URL` resolves to
 * another origin), anything that does not start with `/`, and the auth paths
 * themselves all collapse to `/`.
 */
export function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";

  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  if (isReservedAuthPath(url.pathname)) return "/";

  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Bouncing back into the sign-in flow after signing in is at best a loop and
 * at worst a way to re-enter an auth route with attacker-chosen parameters.
 */
function isReservedAuthPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "").toLowerCase() || "/";
  return normalized === SIGN_IN_PATH || normalized === SIGN_OUT_PATH
    || normalized === REQUEST_LINK_PATH || normalized === VERIFY_PATH
    || normalized.startsWith("/api/auth");
}

// ---------------------------------------------------------------------------
// Address handling
// ---------------------------------------------------------------------------

/**
 * One normalization, applied everywhere an address is read, so the same
 * person cannot end up with two accounts because they capitalized their name
 * one Tuesday. Deliberately conservative: trim and lowercase only. The local
 * part of an address is case-sensitive per RFC 5321 and some providers do
 * treat it that way, but every provider a customer will actually use folds
 * case, and treating `A@x` and `a@x` as different accounts is the far worse
 * failure — it silently splits one paying customer's history in two.
 */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!isPlausibleEmail(normalized)) return null;
  return normalized;
}

const EMAIL_SHAPE = /^[^\s@,;:<>"'\\]{1,64}@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Shape check, not validation: the only thing that proves an address is real
 * is that someone received the link and clicked it. This exists to keep
 * header-injection characters and obvious junk out of the mail API call and
 * out of storage, not to be an authority on RFC 5322.
 */
export function isPlausibleEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_SHAPE.test(value);
}

/**
 * SEC-19. The address folded to the inbox it will actually reach, for
 * rate-limit bucketing ONLY.
 *
 * `MAGIC_LINK_LIMITS.perEmail` is described as the mail-bomb bound, and it
 * bucketed on the exact normalized string. Gmail-style `+tag` suffixes and
 * dots in the local part produce different strings that deliver to one inbox,
 * so ten aliases of one address were accepted from a single source and each
 * alias got its own budget; refusal only arrived at 15, from the per-client
 * bound. Three times the documented bound, at one victim's inbox, in
 * genuine correctly-signed mail from a verified domain.
 *
 * NEVER use this for storage, for mail, or for account identity. The address
 * a customer typed is the address that gets the link and the address the
 * account is keyed on: `a.b@gmail.com` and `ab@gmail.com` are one inbox at
 * Google and could be two different people at a provider that does not fold
 * dots, and merging them would silently join two accounts. This is a counter
 * key and nothing else, which is why it is applied IN ADDITION to the
 * exact-string bucket rather than instead of it.
 *
 * Dot-folding is applied only to providers known to do it. Plus-tagging is
 * folded everywhere: it is an addressing convention, not a provider feature,
 * and an address that does not use it is unaffected.
 */
const DOT_FOLDING_DOMAINS = new Set(["gmail.com", "googlemail.com"]);
/** Provider aliases that are the same mailbox, not merely the same company. */
const DOMAIN_ALIASES: Record<string, string> = { "googlemail.com": "gmail.com" };

export function canonicalEmailForRateLimit(normalizedEmail: string): string {
  const at = normalizedEmail.lastIndexOf("@");
  if (at <= 0) return normalizedEmail;
  let local = normalizedEmail.slice(0, at);
  const rawDomain = normalizedEmail.slice(at + 1);
  const domain = DOMAIN_ALIASES[rawDomain] ?? rawDomain;

  const tag = local.indexOf("+");
  if (tag > 0) local = local.slice(0, tag);
  if (DOT_FOLDING_DOMAINS.has(rawDomain)) local = local.replace(/\./g, "");

  // A local part that folds away entirely (`+tag@x`, `.@gmail.com`) is not a
  // deliverable address, but it must still bucket somewhere deterministic
  // rather than collapsing every such attempt onto one shared counter with
  // real addresses.
  return `${local || normalizedEmail.slice(0, at)}@${domain}`;
}

/**
 * SEC-19, second half. The abuse-counter identity of a client address.
 *
 * An IPv6 client holding a routine /64 has 2^64 source addresses, so
 * bucketing on the literal address means the per-client bound stops bounding
 * anything the moment an attacker is on IPv6 — which is the real ceiling the
 * audit named. /64 is the standard allocation to a single subscriber and is
 * the conventional unit for abuse counters. IPv4 is unchanged.
 */
export function clientRateLimitKey(value: string): string {
  if (!value.includes(":")) return value;
  let hostname: string;
  try {
    hostname = new URL(`http://[${value}]/`).hostname;
  } catch {
    return value;
  }
  // `new URL` normalizes to the compressed form; expand enough to take the
  // first four groups, which is the /64.
  const inner = hostname.replace(/^\[|\]$/g, "");
  const [head, tail = ""] = inner.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups = inner.includes("::")
    ? [...headGroups, ...Array(Math.max(0, missing)).fill("0"), ...tailGroups]
    : headGroups;
  if (groups.length < 8) return value;
  return `${groups.slice(0, 4).map((group) => group.padStart(4, "0")).join(":")}::/64`;
}

/** `email:` namespaced so an address identity can never collide with a legacy external subject. */
export function emailSubject(normalizedEmail: string): string {
  return `email:${normalizedEmail}`;
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

function parseCookieHeader(header: string | null): Map<string, string> {
  const jar = new Map<string, string>();
  if (!header) return jar;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name && value && !jar.has(name)) jar.set(name, value);
  }
  return jar;
}

/**
 * Reads the raw session id the browser presented, or null.
 *
 * The host gate is applied here rather than at every call site, so there is
 * no path that reads a session cookie without it.
 */
export function readSessionCookie(source: Request | Headers): string | null {
  if (!isTrustedIdentityHost(source)) return null;
  const headers = source instanceof Headers ? source : source.headers;
  const jar = parseCookieHeader(headers.get("cookie"));
  const prefixed = jar.get(SESSION_COOKIE);
  if (prefixed) return prefixed;
  // The unprefixed name exists for plain-http local development only.
  return isDevHost(source) ? jar.get(DEV_SESSION_COOKIE) ?? null : null;
}

const BASE_FLAGS = "HttpOnly; SameSite=Lax; Path=/";

/**
 * Builds the Set-Cookie value, or null when this request cannot carry a
 * session safely (plain http on something that is not a dev host). Null means
 * "refuse to sign in", never "sign in without Secure".
 *
 * No `Domain` attribute: the cookie stays host-only, which is both what
 * `__Host-` requires and what keeps it off every other name in the zone.
 */
export function buildSessionCookie(request: Request, rawSessionId: string, maxAgeSeconds: number): string | null {
  if (isSecureRequest(request)) {
    return `${SESSION_COOKIE}=${rawSessionId}; ${BASE_FLAGS}; Secure; Max-Age=${maxAgeSeconds}`;
  }
  if (isDevHost(request)) {
    return `${DEV_SESSION_COOKIE}=${rawSessionId}; ${BASE_FLAGS}; Max-Age=${maxAgeSeconds}`;
  }
  return null;
}

/** Both names are cleared: a customer signing out must not depend on which one they were issued. */
export function clearedSessionCookies(request: Request): string[] {
  const expired = "Max-Age=0";
  const cookies = [`${SESSION_COOKIE}=; ${BASE_FLAGS}; Secure; ${expired}`];
  if (isDevHost(request)) cookies.push(`${DEV_SESSION_COOKIE}=; ${BASE_FLAGS}; ${expired}`);
  return cookies;
}

/**
 * Reads the link nonce this browser presented, or null.
 *
 * Same host gate and same two-name rule as the session cookie, so there is no
 * path that reads a nonce on a host this app does not claim.
 */
export function readLinkNonceCookie(source: Request | Headers): string | null {
  if (!isTrustedIdentityHost(source)) return null;
  const headers = source instanceof Headers ? source : source.headers;
  const jar = parseCookieHeader(headers.get("cookie"));
  const prefixed = jar.get(LINK_NONCE_COOKIE);
  if (prefixed) return prefixed;
  return isDevHost(source) ? jar.get(DEV_LINK_NONCE_COOKIE) ?? null : null;
}

/**
 * Builds the nonce Set-Cookie, or null when this request cannot carry one
 * safely. Null is never "set it without Secure": the caller mails the link
 * anyway and the redemption falls through to the confirmation step, which is
 * the safe outcome rather than the broken one.
 */
export function buildLinkNonceCookie(request: Request, rawNonce: string, maxAgeSeconds: number): string | null {
  if (isSecureRequest(request)) {
    return `${LINK_NONCE_COOKIE}=${rawNonce}; ${BASE_FLAGS}; Secure; Max-Age=${maxAgeSeconds}`;
  }
  if (isDevHost(request)) {
    return `${DEV_LINK_NONCE_COOKIE}=${rawNonce}; ${BASE_FLAGS}; Max-Age=${maxAgeSeconds}`;
  }
  return null;
}

/** Cleared on every completed sign-in: a nonce outliving the link it bound is a credential with no purpose. */
export function clearedLinkNonceCookies(request: Request): string[] {
  const expired = "Max-Age=0";
  const cookies = [`${LINK_NONCE_COOKIE}=; ${BASE_FLAGS}; Secure; ${expired}`];
  if (isDevHost(request)) cookies.push(`${DEV_LINK_NONCE_COOKIE}=; ${BASE_FLAGS}; ${expired}`);
  return cookies;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** 256 bits, from the platform CSPRNG. Neither guessable nor enumerable at any realistic rate. */
export const TOKEN_BYTES = 32;

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Base64url of 32 bytes is 43 characters. Anything else is refused before a query is built. */
export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32,128}$/;

/**
 * The one-way function standing between storage and a credential. Applied to
 * both the link token and the session id, so what is compared is always a
 * digest against a digest — a raw secret read back out of storage is never
 * string-compared against anything.
 */
export async function digestToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** The subset of db/auth-repository.ts identity resolution needs. */
export interface SessionPort {
  findSessionIdentity(db: AppDatabase, input: { sessionDigest: string; now: Date }): Promise<SessionIdentity | null>;
}

export interface IdentityDeps {
  db: AppDatabase;
  auth: SessionPort;
}

/**
 * The one resolver. Route handlers and server components both end up here.
 *
 * It is asynchronous because a session is a database row, which is the whole
 * shape change from the header scheme it replaces: identity is no longer
 * something a request can assert, it is something the server looks up.
 *
 * `loadDeps` is invoked lazily and only when a cookie is actually present, so
 * a signed-out visitor still gets their 401 without a database binding — the
 * property the previous synchronous resolver gave for free, kept deliberately.
 * A failure inside `loadDeps` is NOT swallowed: a database outage must not be
 * reported to a signed-in customer as "you are signed out".
 */
export async function resolveSessionUser(
  source: Request | Headers,
  loadDeps: () => Promise<IdentityDeps>,
): Promise<SessionIdentity | null> {
  const raw = readSessionCookie(source);
  if (!raw || !TOKEN_SHAPE.test(raw)) return null;
  const { db, auth } = await loadDeps();
  return auth.findSessionIdentity(db, { sessionDigest: await digestToken(raw), now: new Date() });
}

/**
 * Cross-site request forgery, which header identity did not have to think
 * about and cookie identity does.
 *
 * `SameSite=Lax` already stops a cross-site form post or fetch from carrying
 * the session, and it is the primary control. This is the second one: any
 * state-changing request that arrives WITH an Origin naming another site is
 * refused outright. A missing Origin is allowed through, because non-browser
 * callers (and this repository's own route-level tests) send none, and every
 * browser sends one on exactly the cross-site requests that matter.
 */
export function isCrossSiteRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  // `Origin: null` is an opaque origin — a sandboxed iframe, a `file://`
  // page, some redirect chains. It is a present Origin that names no site
  // this application serves, so it is cross-site; nothing legitimate here
  // sends it, and treating it as "missing" gave it the benefit of the doubt
  // reserved for callers that send no Origin at all.
  if (origin === "null") return true;
  try {
    return new URL(origin).host.toLowerCase() !== new URL(request.url).host.toLowerCase();
  } catch {
    return true;
  }
}

/**
 * The strict form of the check above: the Origin must be present AND name
 * this site. `isCrossSiteRequest` lets a missing Origin through, because
 * non-browser callers send none and the session cookie's `SameSite=Lax` is
 * the primary control on those routes.
 *
 * The sign-in confirmation POST cannot borrow that reasoning. It carries no
 * session cookie by construction — it is the request that CREATES one — so
 * `SameSite` protects nothing there and the Origin is the only control left.
 * A missing Origin is therefore refused rather than allowed: every browser
 * sends one on a form POST, so the only callers this turns away are the ones
 * that have no business redeeming a sign-in link.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  try {
    return new URL(origin).host.toLowerCase() === new URL(request.url).host.toLowerCase();
  } catch {
    return false;
  }
}

/** Calls `load` at most once per request, so two consumers of the same deps do not open two of everything. */
export function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => (pending ??= load());
}
