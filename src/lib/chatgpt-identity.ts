// Pure ChatGPT-identity header parsing and path building — no
// `next/headers`/`next/navigation` dependency, so this is directly
// importable from route handlers that read a real `Request` (and so must
// stay callable outside the vinext/Next.js request-context ALS those
// modules depend on — see app/api/humanize/route.ts's precedent of
// reading `request.headers` directly) and from plain-Node tests that
// invoke routes as functions (tests/api.test.mts's pattern). RSC/page
// code needing the ambient-request-context variant should use
// app/chatgpt-auth.ts's getChatGPTUser()/requireChatGPTUser() instead,
// which wrap these.
import { productConfig } from "@/src/config/product";

export type ChatGPTUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

const USER_ID_HEADER = "oai-authenticated-user-id";
const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER = "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";
const SIGN_IN_PATH = "/signin-with-chatgpt";
const SIGN_OUT_PATH = "/signout-with-chatgpt";
const CALLBACK_PATH = "/callback";

const HOST_HEADER = "host";
// Hosts served directly by the runtime, outside the trusted boundary.
const DEV_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * SEC-01. The identity headers below are only meaningful because the hosting
 * boundary injects them and strips any client-supplied copy. Any origin that
 * reaches the Worker without passing through it — a *.workers.dev URL, a
 * preview alias, a direct route — can set them freely, and trusting them
 * there is a full authentication bypass: a forged user id returns another
 * customer's paid rewrite and opens their billing portal.
 *
 * So identity is honored only on the configured production domain, or on a
 * local dev host. Everywhere else the caller is anonymous, which fails closed:
 * no entitlement, no unlock, no portal. `workers_dev: false` in vite.config.ts
 * removes the known bad origin; this makes an unknown one harmless too.
 *
 * This is a containment control, not provenance verification. It assumes the
 * boundary is the only thing serving the production Host. Replacing it with a
 * signed/verifiable assertion from the boundary is the real fix.
 */
export function isTrustedIdentityHost(source: Request | Headers): boolean {
  const hostname = hostnameOf(source);
  if (!hostname) return false;
  if (DEV_HOSTS.has(hostname)) return true;
  const configured = productConfig.domain.trim().toLowerCase();
  if (!configured) return false;
  return hostname === configured || hostname === `www.${configured}`;
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

export function resolveChatGPTUserFromHeaders(source: Request | Headers): ChatGPTUser | null {
  if (!isTrustedIdentityHost(source)) return null;
  const requestHeaders = source instanceof Headers ? source : source.headers;
  const userId = requestHeaders.get(USER_ID_HEADER);
  const email = requestHeaders.get(USER_EMAIL_HEADER);
  if (!userId || !email) return null;

  const encodedFullName = requestHeaders.get(USER_FULL_NAME_HEADER);
  const fullName =
    encodedFullName && requestHeaders.get(USER_FULL_NAME_ENCODING_HEADER) === PERCENT_ENCODED_UTF8
      ? safeDecodeURIComponent(encodedFullName)
      : null;

  return { userId, displayName: fullName ?? email, email, fullName };
}

export function chatGPTSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

function safeRelativeReturnPath(value: string): string {
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

function isReservedAuthPath(pathname: string): boolean {
  return pathname === SIGN_IN_PATH || pathname === SIGN_OUT_PATH || pathname === CALLBACK_PATH;
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
