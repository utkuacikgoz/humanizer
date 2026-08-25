// The ambient-request-context half of identity, for React Server Components
// and pages: `next/headers` and `next/navigation` do not resolve outside the
// vinext/Next.js request context, and importing either one transitively
// crashes plain-Node tests at import time.
//
// So the split this file preserves is load-bearing, not stylistic: all of the
// logic lives in src/lib/identity.ts, which route handlers holding a real
// `Request` and tests invoking routes as functions import directly. This is
// the thin wrapper that reads the ambient request instead.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveSessionUser, signInPath, type SessionIdentity } from "@/src/lib/identity";

export type { SessionIdentity };
export { signInPath, signOutPath } from "@/src/lib/identity";

async function loadIdentityDeps() {
  const [{ getDb }, auth] = await Promise.all([
    import("../db/index"),
    import("../db/auth-repository"),
  ]);
  return { db: getDb(), auth };
}

/**
 * The signed-in customer, or null.
 *
 * A resolution failure (no D1 binding, a database outage) resolves to null
 * here rather than throwing, because this runs during page rendering: a
 * signed-out page is a recoverable state a visitor can act on, an unhandled
 * throw is a 500. Route handlers, which can answer 503 honestly, do not
 * swallow it.
 */
export async function getSessionUser(): Promise<SessionIdentity | null> {
  try {
    return await resolveSessionUser(await headers(), loadIdentityDeps);
  } catch {
    return null;
  }
}

export async function requireSessionUser(returnTo: string): Promise<SessionIdentity> {
  const user = await getSessionUser();
  if (user) return user;

  redirect(signInPath(returnTo));
}
