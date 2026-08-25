// M4-01 — email magic-link sign-in.
//
// These drive the exact functions app/api/auth/** delegates to, against a
// real SQLite database and a recording mail sender, so every assertion is
// about production behavior rather than a re-implementation of it. Nothing
// here touches the network: the sender is injected.
import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import * as auth from "../db/auth-repository";
import * as schema from "../db/schema";
import {
  buildSessionStateResponse,
  buildSignInRequestResponse,
  buildSignOutResponse,
  buildVerifyResponse,
  LINK_SENT_MESSAGE,
  MAGIC_LINK_LIMITS,
} from "../src/lib/magic-link";
import {
  digestToken,
  emailSubject,
  resolveSessionUser,
  safeRelativeReturnPath,
  SESSION_COOKIE,
  DEV_SESSION_COOKIE,
} from "../src/lib/identity";
import type { EmailMessage, EmailSender } from "../src/lib/email-sender";
import { EmailDeliveryError } from "../src/lib/email-sender";
import { createTestDatabase } from "./helpers/sqlite-db.mjs";
import type { AppDatabase } from "../db/repository";

const CLIENT_IP = "203.0.113.7";

function recordingSender() {
  const sent: EmailMessage[] = [];
  const sender: EmailSender = { async send(message) { sent.push(message); } };
  return { sender, sent };
}

type Harness = {
  db: AppDatabase;
  sent: EmailMessage[];
  statements: string[];
  request(email: string, options?: { returnTo?: string; origin?: string; host?: string; headers?: Record<string, string> }): Promise<Response>;
  verify(link: string, options?: { cookie?: string }): Promise<Response>;
  signOut(cookie?: string, options?: { origin?: string }): Promise<Response>;
  sessionState(cookie?: string): Promise<Response>;
  linkFrom(message: EmailMessage): string;
  setNow(fn: () => Date): void;
  setSender(sender: EmailSender | null): void;
};

async function harness(): Promise<Harness> {
  const statements: string[] = [];
  const db = await createTestDatabase({ onStatement: (sql) => statements.push(sql) });
  const recorder = recordingSender();
  let sender: EmailSender | null = recorder.sender;
  let now = () => new Date();
  const loadDeps = async () => ({ db, auth, sender, from: "Ownword <no-reply@ownword.pro>", now });

  return {
    db,
    sent: recorder.sent,
    statements,
    setNow(fn) { now = fn; },
    setSender(next) { sender = next; },
    request(email, options = {}) {
      const host = options.host ?? "localhost";
      const scheme = host === "localhost" ? "http" : "https";
      return buildSignInRequestResponse(
        new Request(`${scheme}://${host}/api/auth/request-link`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            host,
            "cf-connecting-ip": CLIENT_IP,
            ...(options.origin ? { origin: options.origin } : {}),
            ...options.headers,
          },
          body: JSON.stringify({ email, returnTo: options.returnTo ?? "/" }),
        }),
        loadDeps,
      );
    },
    verify(link, options = {}) {
      const url = new URL(link);
      return buildVerifyResponse(
        new Request(link, {
          headers: { host: url.host, ...(options.cookie ? { cookie: options.cookie } : {}) },
        }),
        loadDeps,
      );
    },
    signOut(cookie, options = {}) {
      return buildSignOutResponse(
        new Request("http://localhost/api/auth/signout", {
          method: "POST",
          headers: {
            host: "localhost",
            ...(cookie ? { cookie } : {}),
            ...(options.origin ? { origin: options.origin } : {}),
          },
        }),
        loadDeps,
      );
    },
    sessionState(cookie) {
      return buildSessionStateResponse(
        new Request("http://localhost/api/auth/session", {
          headers: { host: "localhost", ...(cookie ? { cookie } : {}) },
        }),
        loadDeps,
      );
    },
    linkFrom(message) {
      const found = message.text.match(/https?:\/\/\S+/);
      assert.ok(found, "the message must carry a sign-in link");
      return found[0];
    },
  };
}

function cookieValue(response: Response): string | null {
  const header = response.headers.get("set-cookie") ?? "";
  const match = header.match(/(?:__Host-ownword_session|ownword_session)=([^;]+)/);
  return match ? match[1] : null;
}

/** Resolves a raw session id the way every authenticated surface does. */
function identityFor(db: AppDatabase, rawSession: string, host = "localhost") {
  return resolveSessionUser(
    new Headers({ host, cookie: `${host === "localhost" ? DEV_SESSION_COOKIE : SESSION_COOKIE}=${rawSession}` }),
    async () => ({ db, auth }),
  );
}

/** Requests a link and returns the raw URL it mailed. */
async function issuedLink(h: Harness, email: string, options?: { returnTo?: string }) {
  const before = h.sent.length;
  const response = await h.request(email, options);
  assert.equal(response.status, 200, await response.text());
  assert.equal(h.sent.length, before + 1, "exactly one message per accepted request");
  return h.linkFrom(h.sent[h.sent.length - 1]);
}

// ---------------------------------------------------------------------
// Redemption: single use, expiry, and one indistinguishable failure
// ---------------------------------------------------------------------

test("a sign-in link works exactly once", async () => {
  const h = await harness();
  const link = await issuedLink(h, "person@example.com");

  const first = await h.verify(link);
  assert.equal(first.status, 303);
  const session = cookieValue(first);
  assert.ok(session, "a successful redemption must set a session cookie");
  assert.ok(await identityFor(h.db, session));

  const sessionsAfterFirst = await h.db.select().from(schema.authSessions);
  assert.equal(sessionsAfterFirst.length, 1);

  const second = await h.verify(link);
  assert.equal(second.status, 303);
  assert.equal(second.headers.get("location"), "/signin?error=link&return_to=%2F");
  assert.equal(cookieValue(second), null, "a spent link must not mint a second session");

  const sessionsAfterSecond = await h.db.select().from(schema.authSessions);
  assert.equal(sessionsAfterSecond.length, 1, "the second redemption must create no session");
});

test("an expired link fails, and looks exactly like an unknown or tampered one", async () => {
  const h = await harness();
  const issuedAt = new Date("2026-08-25T10:00:00Z");
  h.setNow(() => issuedAt);
  const expiredLink = await issuedLink(h, "person@example.com");

  // 16 minutes later: past the 15-minute life.
  h.setNow(() => new Date(issuedAt.getTime() + 16 * 60 * 1000));
  const expired = await h.verify(expiredLink);

  const live = await issuedLink(h, "other@example.com");
  const tampered = live.replace(/token=([^&]+)/, (_, token: string) => `token=${flipLastCharacter(token)}`);
  const unknown = live.replace(/token=([^&]+)/, `token=${"z".repeat(43)}`);

  const responses = [expired, await h.verify(tampered), await h.verify(unknown)];
  for (const response of responses) {
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), responses[0].headers.get("location"));
    assert.equal(cookieValue(response), null);
  }
  assert.equal((await h.db.select().from(schema.authSessions)).length, 0, "no failure path may create a session");
});

function flipLastCharacter(token: string) {
  const last = token.slice(-1);
  return `${token.slice(0, -1)}${last === "a" ? "b" : "a"}`;
}

test("the account is created on first redemption, under a namespaced subject", async () => {
  const h = await harness();
  const link = await issuedLink(h, "  Person@Example.COM  ");
  await h.verify(link);

  const users = await h.db.select().from(schema.users);
  assert.equal(users.length, 1);
  // Normalized on the way in, so the same person cannot end up with two rows.
  assert.equal(users[0].externalSubject, emailSubject("person@example.com"));
  assert.equal(users[0].contactEmail, "person@example.com");

  // A second sign-in with different casing reuses the same account.
  const again = await issuedLink(h, "PERSON@example.com");
  await h.verify(again);
  assert.equal((await h.db.select().from(schema.users)).length, 1);
});

test("signing in again rotates the session id", async () => {
  const h = await harness();
  const first = cookieValue(await h.verify(await issuedLink(h, "person@example.com")));
  assert.ok(first);

  const second = cookieValue(await h.verify(await issuedLink(h, "person@example.com"), {
    cookie: `${DEV_SESSION_COOKIE}=${first}`,
  }));
  assert.ok(second);
  assert.notEqual(second, first);
  assert.equal(await identityFor(h.db, first), null, "the session presented at sign-in must not survive it");
  assert.ok(await identityFor(h.db, second));
});

// ---------------------------------------------------------------------
// Enumeration safety
// ---------------------------------------------------------------------

test("requesting a link for an unregistered address is indistinguishable from a registered one", async () => {
  const h = await harness();
  // Give one address a real account, by signing it in.
  await h.verify(await issuedLink(h, "registered@example.com"));
  assert.equal((await h.db.select().from(schema.users)).length, 1);

  h.statements.length = 0;
  const known = await h.request("registered@example.com");
  const knownStatements = [...h.statements];

  h.statements.length = 0;
  const unknown = await h.request("nobody@example.com");
  const unknownStatements = [...h.statements];

  assert.equal(known.status, unknown.status);
  assert.equal(known.headers.get("cache-control"), unknown.headers.get("cache-control"));
  assert.deepEqual(await known.json(), await unknown.json());

  // The strongest form of the property: the two requests ask the database the
  // same questions, and neither one asks about accounts at all. Timing cannot
  // diverge on work that is not done.
  assert.deepEqual(knownStatements, unknownStatements);
  assert.ok(
    !knownStatements.some((sql) => /\busers\b/i.test(sql)),
    "requesting a link must never read or write the users table",
  );
});

test("the success body says nothing about whether the address exists", async () => {
  const h = await harness();
  const body = (await (await h.request("nobody@example.com")).json()) as { ok: boolean; message: string };
  assert.equal(body.ok, true);
  assert.equal(body.message, LINK_SENT_MESSAGE);
  assert.doesNotMatch(body.message, /account|registered|exists|unknown/i);
});

// ---------------------------------------------------------------------
// Abuse bounds
// ---------------------------------------------------------------------

test("link requests are refused beyond the per-address bound", async () => {
  const h = await harness();
  for (let attempt = 0; attempt < MAGIC_LINK_LIMITS.perEmail; attempt += 1) {
    assert.equal((await h.request("target@example.com")).status, 200, `request ${attempt + 1} should be admitted`);
  }
  assert.equal(h.sent.length, MAGIC_LINK_LIMITS.perEmail);

  const refused = await h.request("target@example.com");
  assert.equal(refused.status, 429);
  assert.ok(Number(refused.headers.get("retry-after")) > 0);
  assert.equal(h.sent.length, MAGIC_LINK_LIMITS.perEmail, "a refused request must not mail anything");
});

test("one client cannot cycle addresses past the per-client bound", async () => {
  const h = await harness();
  let admitted = 0;
  for (let attempt = 0; attempt < MAGIC_LINK_LIMITS.perClient + 3; attempt += 1) {
    const response = await h.request(`person${attempt}@example.com`);
    if (response.status === 200) admitted += 1;
  }
  assert.equal(admitted, MAGIC_LINK_LIMITS.perClient);
  assert.equal(h.sent.length, MAGIC_LINK_LIMITS.perClient);
});

// ---------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------

test("a valid session resolves an identity; an expired or unknown one resolves to null", async () => {
  const h = await harness();
  const session = cookieValue(await h.verify(await issuedLink(h, "person@example.com")));
  assert.ok(session);

  const identity = await identityFor(h.db, session);
  assert.equal(identity?.email, "person@example.com");
  assert.equal(identity?.externalSubject, emailSubject("person@example.com"));

  assert.equal(await identityFor(h.db, "unknown-session-value-that-is-long-enough"), null);

  await h.db.update(schema.authSessions).set({ expiresAt: new Date(Date.now() - 1_000) });
  assert.equal(await identityFor(h.db, session), null, "server-side expiry ends a session, not the cookie's lifetime");
});

test("a session belonging to a deleted account resolves to nobody", async () => {
  const h = await harness();
  const session = cookieValue(await h.verify(await issuedLink(h, "person@example.com")));
  assert.ok(session);

  await h.db.update(schema.users).set({ deletedAt: new Date() });
  assert.equal(await identityFor(h.db, session), null);
});

test("the session cookie carries the flags that make it safe", async () => {
  const h = await harness();
  // On the production host over https: the strong form.
  const link = await issuedLink(h, "person@example.com", { returnTo: "/history" });
  const secureLink = link.replace("http://localhost", "https://ownword.pro");
  const response = await h.verify(secureLink);
  const cookie = response.headers.get("set-cookie") ?? "";

  assert.match(cookie, /^__Host-ownword_session=/, "the __Host- prefix pins the cookie to this exact origin");
  assert.match(cookie, /;\s*HttpOnly/i, "script must never be able to read the session");
  assert.match(cookie, /;\s*Secure/i);
  assert.match(cookie, /;\s*SameSite=Lax/i, "SameSite=Lax is the CSRF control this app relies on");
  assert.match(cookie, /;\s*Path=\//);
  assert.doesNotMatch(cookie, /Domain=/i, "a Domain attribute would share the session with every subdomain");
  assert.equal(response.headers.get("location"), "/history");
});

test("a plain-http dev host gets a working cookie without silently dropping Secure in production", async () => {
  const h = await harness();
  const cookie = (await h.verify(await issuedLink(h, "person@example.com"))).headers.get("set-cookie") ?? "";
  assert.match(cookie, /^ownword_session=/, "http cannot carry a __Host- cookie, so dev uses the plain name");
  assert.doesNotMatch(cookie, /Secure/i);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
});

test("a session cookie is not honored on an untrusted host", async () => {
  const h = await harness();
  const session = cookieValue(await h.verify(await issuedLink(h, "person@example.com")));
  assert.ok(session);
  assert.ok(await identityFor(h.db, session, "localhost"));
  assert.equal(await identityFor(h.db, session, "humanizer.workers.dev"), null);
  assert.equal(await identityFor(h.db, session, "evil.test"), null);
});

test("signing out destroys the session server-side, not just the cookie", async () => {
  const h = await harness();
  const session = cookieValue(await h.verify(await issuedLink(h, "person@example.com")));
  assert.ok(session);

  const response = await h.signOut(`${DEV_SESSION_COOKIE}=${session}`);
  assert.equal(response.status, 303);
  assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
  assert.equal(await identityFor(h.db, session), null);
  assert.equal((await h.db.select().from(schema.authSessions)).length, 0);
});

test("the session-state endpoint answers only for the caller's own cookie", async () => {
  const h = await harness();
  assert.deepEqual(await (await h.sessionState()).json(), { signedIn: false });

  const session = cookieValue(await h.verify(await issuedLink(h, "person@example.com")));
  assert.ok(session);
  assert.deepEqual(
    await (await h.sessionState(`${DEV_SESSION_COOKIE}=${session}`)).json(),
    { signedIn: true, email: "person@example.com" },
  );

  // A value that names no session is signed out, not an error and not a hint.
  assert.deepEqual(
    await (await h.sessionState(`${DEV_SESSION_COOKIE}=${"q".repeat(43)}`)).json(),
    { signedIn: false },
  );

  await h.signOut(`${DEV_SESSION_COOKIE}=${session}`);
  assert.deepEqual(await (await h.sessionState(`${DEV_SESSION_COOKIE}=${session}`)).json(), { signedIn: false });
});

test("a third-party page cannot sign someone out", async () => {
  const h = await harness();
  const session = cookieValue(await h.verify(await issuedLink(h, "person@example.com")));
  assert.ok(session);

  const response = await h.signOut(`${DEV_SESSION_COOKIE}=${session}`, { origin: "https://evil.test" });
  assert.equal(response.status, 403);
  assert.ok(await identityFor(h.db, session), "the session must survive a forged sign-out");
});

// ---------------------------------------------------------------------
// Storage holds no secrets
// ---------------------------------------------------------------------

test("no raw token or session id is ever written to storage", async () => {
  const h = await harness();
  const link = await issuedLink(h, "person@example.com");
  const rawToken = new URL(link).searchParams.get("token");
  assert.ok(rawToken);
  const session = cookieValue(await h.verify(link));
  assert.ok(session);

  const rows = [
    ...(await h.db.select().from(schema.authMagicLinkTokens)),
    ...(await h.db.select().from(schema.authSessions)),
    ...(await h.db.select().from(schema.authRateLimits)),
  ];
  assert.ok(rows.length >= 3);
  const serialized = JSON.stringify(rows);
  assert.ok(!serialized.includes(rawToken), "the raw link token must never reach a column");
  assert.ok(!serialized.includes(session), "the raw session id must never reach a column");

  // What IS stored is the digest, and only the digest.
  const [token] = await h.db.select().from(schema.authMagicLinkTokens);
  assert.equal(token.tokenDigest, await digestToken(rawToken));
  assert.match(token.tokenDigest, /^[0-9a-f]{64}$/);
  const [stored] = await h.db.select().from(schema.authSessions);
  assert.equal(stored.sessionDigest, await digestToken(session));
});

test("a redeemed link is marked consumed, and its attempts are counted", async () => {
  const h = await harness();
  const link = await issuedLink(h, "person@example.com");
  await h.verify(link);
  await h.verify(link);

  const [token] = await h.db.select().from(schema.authMagicLinkTokens);
  assert.ok(token.consumedAt, "redemption stamps the single-use marker");
  assert.equal(token.attemptCount, 2, "the refused replay is counted against the token");
});

test("a successful sign-in kills every other outstanding link for that address", async () => {
  const h = await harness();
  const stale = await issuedLink(h, "person@example.com");
  const fresh = await issuedLink(h, "person@example.com");

  assert.equal(cookieValue(await h.verify(fresh)) !== null, true);
  const staleAttempt = await h.verify(stale);
  assert.equal(cookieValue(staleAttempt), null, "an older link in the same inbox is dead after a sign-in");
});

// ---------------------------------------------------------------------
// return_to cannot become an open redirect
// ---------------------------------------------------------------------

test("return_to cannot be used for an open redirect", async () => {
  const hostile = [
    "https://evil.test/steal",
    "http://evil.test",
    "//evil.test/steal",
    "/\\evil.test",
    "javascript:alert(1)",
    "\\/\\/evil.test",
    "https://ownword.pro.evil.test/",
  ];
  for (const value of hostile) {
    assert.equal(safeRelativeReturnPath(value), "/", `${value} must not survive`);
  }

  // Reserved auth paths collapse too: bouncing back into the flow is at best a
  // loop and at worst a way to re-enter an auth route with chosen parameters.
  for (const value of ["/signin", "/signin?error=link", "/api/auth/verify?token=x", "/api/auth/signout", "/API/AUTH/verify"]) {
    assert.equal(safeRelativeReturnPath(value), "/", `${value} must not survive`);
  }

  // A genuine in-app destination is preserved exactly.
  assert.equal(safeRelativeReturnPath("/history?open=1#top"), "/history?open=1#top");
});

test("a hostile return_to never reaches the emailed link or the redirect", async () => {
  const h = await harness();
  const link = await issuedLink(h, "person@example.com", { returnTo: "https://evil.test/steal" });
  assert.equal(new URL(link).searchParams.get("return_to"), "/");

  const response = await h.verify(link);
  assert.equal(response.headers.get("location"), "/");
});

// ---------------------------------------------------------------------
// Configuration and forgery
// ---------------------------------------------------------------------

test("with no mail provider configured, sign-in fails closed", async () => {
  const h = await harness();
  h.setSender(null);

  const response = await h.request("person@example.com");
  assert.equal(response.status, 503);
  assert.match(((await response.json()) as { error: string }).error, /not configured/i);
  assert.equal(h.sent.length, 0);
  assert.equal((await h.db.select().from(schema.authMagicLinkTokens)).length, 0, "no token may be minted for mail nobody sent");
});

test("a missing database binding is an honest outage, not a 500 and not an expired link", async () => {
  // getDb() throws when the D1 binding is absent. Letting that escape a route
  // handler produces a bare 500 with no body: a broken page for the visitor
  // and nothing actionable for the operator.
  const failing = async () => { throw new Error("D1 binding unavailable"); };

  const requested = await buildSignInRequestResponse(
    new Request("http://localhost/api/auth/request-link", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost", "cf-connecting-ip": CLIENT_IP },
      body: JSON.stringify({ email: "person@example.com" }),
    }),
    failing,
  );
  assert.equal(requested.status, 503);

  const verified = await buildVerifyResponse(
    new Request(`http://localhost/api/auth/verify?token=${"a".repeat(43)}&return_to=%2Fhistory`, { headers: { host: "localhost" } }),
    failing,
  );
  assert.equal(verified.status, 303);
  assert.equal(verified.headers.get("location"), "/signin?error=unavailable&return_to=%2Fhistory");
  assert.equal(cookieValue(verified), null);

  const state = await buildSessionStateResponse(
    new Request("http://localhost/api/auth/session", {
      headers: { host: "localhost", cookie: `${DEV_SESSION_COOKIE}=${"a".repeat(43)}` },
    }),
    failing,
  );
  assert.equal(state.status, 503);
});

test("a delivery failure is reported rather than presented as success", async () => {
  const h = await harness();
  h.setSender({ async send() { throw new EmailDeliveryError("http_422"); } });

  const response = await h.request("person@example.com");
  assert.equal(response.status, 502);
  assert.equal(h.sent.length, 0);
});

test("a link request from a third-party page is refused", async () => {
  const h = await harness();
  const response = await h.request("person@example.com", { origin: "https://evil.test" });
  assert.equal(response.status, 403);
  assert.equal(h.sent.length, 0);
});

test("sign-in is not offered on a host this app does not claim", async () => {
  const h = await harness();
  const response = await h.request("person@example.com", { host: "humanizer.workers.dev" });
  assert.equal(response.status, 404);
  assert.equal(h.sent.length, 0);
});

test("a malformed address is refused without minting anything", async () => {
  const h = await harness();
  for (const address of ["", "   ", "not-an-address", "a@b", "person@example.com, other@evil.test", "person@exa mple.com", `${"a".repeat(250)}@example.com`]) {
    const response = await h.request(address);
    assert.equal(response.status, 400, `${address || "(empty)"} must be refused`);
  }
  assert.equal(h.sent.length, 0);
  assert.equal((await h.db.select().from(schema.authMagicLinkTokens)).length, 0);
});

test("the mailed link points at this origin and carries a short-lived token", async () => {
  const h = await harness();
  const issuedAt = new Date("2026-08-25T10:00:00Z");
  h.setNow(() => issuedAt);
  const link = await issuedLink(h, "person@example.com");
  const url = new URL(link);

  assert.equal(url.origin, "http://localhost");
  assert.equal(url.pathname, "/api/auth/verify");
  assert.match(url.searchParams.get("token") ?? "", /^[A-Za-z0-9_-]{43}$/);

  const [token] = await h.db.select().from(schema.authMagicLinkTokens);
  assert.equal(token.expiresAt.getTime() - issuedAt.getTime(), 15 * 60 * 1000);
  assert.equal(token.email, "person@example.com");
});

test("the message never suggests the address has an account, and offers a way out", async () => {
  const h = await harness();
  await issuedLink(h, "person@example.com");
  const [message] = h.sent;
  assert.match(message.subject, /sign-in link/i);
  assert.doesNotMatch(`${message.subject}\n${message.text}`, /welcome back|your account exists/i);
  assert.match(message.text, /did not ask to sign in/i);
  assert.match(message.text, /expires in 15 minutes/i);
});

test("the token row is the only place the link lives, and it is gone once swept", async () => {
  const h = await harness();
  const issuedAt = new Date("2026-08-25T10:00:00Z");
  h.setNow(() => issuedAt);
  await issuedLink(h, "person@example.com");

  await auth.purgeExpiredAuthRows(h.db, new Date(issuedAt.getTime() + 60 * 60 * 1000), 0);
  assert.equal((await h.db.select().from(schema.authMagicLinkTokens)).length, 0);
});

test("a session row points at a real user and is removed with the sweep once expired", async () => {
  const h = await harness();
  const session = cookieValue(await h.verify(await issuedLink(h, "person@example.com")));
  assert.ok(session);
  const [row] = await h.db.select().from(schema.authSessions);
  const [user] = await h.db.select().from(schema.users).where(eq(schema.users.id, row.userId));
  assert.ok(user, "every session must reference a real account");

  await h.db.update(schema.authSessions).set({ expiresAt: new Date(Date.now() - 1_000) });
  await auth.purgeExpiredAuthRows(h.db, new Date(), 0);
  assert.equal((await h.db.select().from(schema.authSessions)).length, 0);
});
