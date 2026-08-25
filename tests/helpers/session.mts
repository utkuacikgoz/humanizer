// Test-side sign-in.
//
// Identity is a session cookie backed by a row now, so a test that used to
// bolt two headers onto a Request has to have a real session. This keeps that
// one line long: `signIn(db, "owner")` writes the row, `sessionHeaders("owner")`
// builds the cookie, and the token is derived from the subject so the header
// builder can stay synchronous at dozens of call sites.
//
// The unprefixed cookie name is the one a plain-http dev host is issued, and
// every request in these tests is http://localhost. See src/lib/identity.ts.
import * as auth from "../../db/auth-repository";
import { getOrCreateUserByExternalSubject } from "../../db/billing-repository";
import { digestToken, DEV_SESSION_COOKIE } from "../../src/lib/identity";
import type { AppDatabase } from "../../db/repository";

/** Shape-valid (base64url, >= 32 chars) and stable per subject. Never a real token: nothing here reaches production. */
export function sessionToken(subject: string): string {
  return `test-session-${subject}`.replace(/[^A-Za-z0-9_-]/g, "-").padEnd(43, "0").slice(0, 128);
}

export function sessionHeaders(subject: string, extra: Record<string, string> = {}): Record<string, string> {
  return { cookie: `${DEV_SESSION_COOKIE}=${sessionToken(subject)}`, ...extra };
}

/** Creates the account (if needed) and a live session for it, the way a redeemed magic link would. */
export async function signIn(
  db: AppDatabase,
  subject: string,
  options: { expiresAt?: Date; email?: string | null } = {},
): Promise<{ userId: string }> {
  const { userId } = await getOrCreateUserByExternalSubject(db, {
    externalSubject: subject,
    email: options.email ?? `${subject}@example.com`,
  });
  const now = new Date();
  await auth.createSession(db, {
    sessionDigest: await digestToken(sessionToken(subject)),
    userId,
    issuedAt: now,
    expiresAt: options.expiresAt ?? new Date(now.getTime() + 60 * 60 * 1000),
  });
  return { userId };
}
