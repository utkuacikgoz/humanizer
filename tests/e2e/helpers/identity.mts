// Signing a browser in, for the E2E suite, without sending mail.
//
// -------------------------------------------------------------------------
// Why this file exists, and why it is shaped the way it is
// -------------------------------------------------------------------------
//
// Sign-in is a magic link: `POST /api/auth/request-link` mints a 256-bit
// token, mails it, and stores only `sha256(token)` (db/auth-repository.ts).
// A browser test therefore has to get hold of a link that normally only an
// inbox ever sees. There were three candidate seams:
//
//   1. Inject a recording `EmailSender` (src/lib/email-sender.ts) and read the
//      link out of it. The interface is genuinely injectable, but the sender
//      is resolved per request from the Workers `env` inside
//      app/api/auth/auth-deps.ts. Reaching it from a test would mean editing
//      that production module AND adding a channel to read the recording back
//      out of the Worker process — more new production surface than the thing
//      under test, and a surface that only exists to be a sign-in bypass.
//      Rejected.
//
//   2. Read the token's row out of the local D1/SQLite. Impossible as stated:
//      the tokens table holds `token_digest`, never the token. That is the
//      point of the table, and it is not something a test should change.
//
//   3. What this file does. The TEST mints the token, stores its digest in
//      the same table `insertMagicLinkToken` writes, and then hands the raw
//      token to the browser as a URL. Delivery — and only delivery — is
//      substituted; everything downstream of the inbox is the real thing:
//      the real GET /api/auth/verify, the real single-use guarded UPDATE, the
//      real account creation, the real session row, the real Set-Cookie.
//
// Approach 3 was chosen because it exercises strictly more production code
// than approach 1 while changing strictly less of it: **there is no
// production change at all, and therefore no seam that could be reachable in
// a production build.** The only privilege it needs is write access to the
// dev server's own local SQLite file, which is a developer-machine artifact
// under .wrangler/state and does not exist in a deployed Worker.
//
// -------------------------------------------------------------------------
// Rules this file keeps
// -------------------------------------------------------------------------
//
//   * A raw token, a raw session id, and a session cookie value are returned
//     to the caller but NEVER written to stdout, to an assertion message, or
//     to any file. Nothing below interpolates one into a string that a test
//     runner prints. Failure messages describe shapes and counts.
//   * No customer writing. Every address is synthetic and in the reserved
//     `.test` TLD (RFC 2606), so a stray send could not reach a real inbox
//     even if one were somehow attempted.
//   * Reads and writes go through the same schema the application uses. This
//     file never relaxes a constraint, never sets a flag the application
//     reads, and never writes a row the application could not have written
//     itself through its own code paths.
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pricingConfig } from "../../../src/config/pricing";
import { DEV_LINK_NONCE_COOKIE } from "../../../src/lib/identity";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const D1_DIR = path.join(REPO_ROOT, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");

/** 15 minutes, the same window src/lib/magic-link.ts's MAGIC_LINK_TTL_MS uses. */
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

/**
 * The dev server's D1 content file.
 *
 * Miniflare keeps a fixed-name `metadata.sqlite` catalog beside one
 * hash-named file per D1 binding; only the hash-named one holds application
 * tables. Same selection rule as scripts/migrate-local-d1.mts, deliberately —
 * if that script and this helper disagreed about which file is the database,
 * the suite would seed one and read the other.
 */
export function localD1Path(): string | null {
  if (!existsSync(D1_DIR)) return null;
  const files = readdirSync(D1_DIR)
    .filter((name) => /^[0-9a-f]{32,}\.sqlite$/.test(name))
    .map((name) => path.join(D1_DIR, name));
  return files[0] ?? null;
}

/**
 * Why the identity helpers cannot run here, or null.
 *
 * Separate from harness.mts's `environmentBlocker` because the failure modes
 * are different and the fixes are different: no Chromium is "install a
 * browser", no auth tables is "run `npm run db:migrate:local`". A suite that
 * skipped with one message for both would send the reader to the wrong fix.
 */
export function identityBlocker(): string | null {
  const file = localD1Path();
  if (!file) {
    return `No local D1 database under ${D1_DIR}; run \`npm run dev\` once, then \`npm run db:migrate:local\``;
  }
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch {
    return `The local D1 database at ${file} could not be opened`;
  }
  try {
    const tables = new Set(
      db
        .prepare("select name from sqlite_master where type = 'table'")
        .all()
        .map((row) => String((row as { name: string }).name)),
    );
    const required = ["auth_magic_link_tokens", "auth_sessions", "users", "subscriptions"];
    const missing = required.filter((name) => !tables.has(name));
    if (missing.length) {
      return `The local D1 database is missing ${missing.join(", ")}; run \`npm run db:migrate:local\``;
    }
  } finally {
    db.close();
  }
  return null;
}

function open(): DatabaseSync {
  const file = localD1Path();
  if (!file) throw new Error("no local D1 database; run `npm run dev` then `npm run db:migrate:local`");
  const db = new DatabaseSync(file);
  // `node --test` runs each e2e file in its own process and runs the files
  // concurrently, so several of them write to this one SQLite file at the same
  // time as the dev worker does. Without a busy timeout SQLite does not wait
  // for the lock, it fails the statement immediately with "database is locked"
  // — which surfaced as a seed step failing in whichever file happened to lose
  // the race, a different one on each run. Five seconds is far longer than any
  // of these writes takes and shorter than the tests' own timeouts, so a real
  // deadlock still fails rather than hanging the suite.
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

/** Runs one unit of work against the dev server's database and always closes the handle. */
function withDb<T>(work: (db: DatabaseSync) => T): T {
  const db = open();
  try {
    return work(db);
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/**
 * The same 256-bit base64url token shape src/lib/identity.ts's `randomToken`
 * produces. Regenerated here rather than imported because importing it would
 * not make the token any more real — the property that matters is that the
 * digest stored matches the token presented, which is asserted by the server
 * refusing anything else.
 */
function randomToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

/** src/lib/identity.ts's `digestToken`, byte for byte: hex SHA-256. */
async function digestToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A synthetic address in the reserved `.test` TLD. Never a real inbox, never customer data. */
export function testEmail(label: string): string {
  return `e2e-${label}-${randomUUID().slice(0, 8)}@ownword-e2e.test`;
}

export interface MintedLink {
  /** The raw browser nonce this link was bound to, absent for a deliberately unbound link. */
  nonce?: string;
  /**
   * The absolute verify URL, exactly as `src/lib/magic-link.ts` composes it
   * into the email body. Carries a live credential: navigate to it, never
   * print it.
   */
  url: string;
  email: string;
}

/**
 * Mints a sign-in link for `email` and stores its digest the way
 * `insertMagicLinkToken` does.
 *
 * Nothing about the row is privileged: same columns, same TTL, same digest
 * function. The server cannot tell this row from one `POST
 * /api/auth/request-link` wrote, which is the property that makes the
 * redemption test meaningful.
 */
export async function mintSignInLink(
  baseUrl: string,
  email: string,
  returnTo = "/",
  options: { expiresAt?: number; issuedAt?: number } = {},
): Promise<MintedLink> {
  const token = randomToken();
  const tokenDigest = await digestToken(token);
  const issuedAt = options.issuedAt ?? Date.now();
  const expiresAt = options.expiresAt ?? issuedAt + MAGIC_LINK_TTL_MS;

  // The browser nonce is what binds a link to the browser that asked for it
  // (SEC-17). Minting it here mirrors what buildSignInRequestResponse does:
  // the digest goes in the row, the raw value goes in the requesting browser's
  // cookie jar. A link minted without one is exactly the attacker's link, and
  // the suite exercises that case deliberately in the cross-browser test.
  const nonce = randomToken();
  const nonceDigest = await digestToken(nonce);

  withDb((db) => {
    db.prepare(
      `insert into auth_magic_link_tokens (id, token_digest, browser_nonce_digest, email, created_at, expires_at, attempt_count)
       values (?, ?, ?, ?, ?, ?, 0)`,
    ).run(randomUUID(), tokenDigest, nonceDigest, email, issuedAt, expiresAt);
  });

  const url = `${baseUrl}/api/auth/verify?token=${encodeURIComponent(token)}&return_to=${encodeURIComponent(returnTo)}`;
  return { url, email, nonce };
}

/**
 * Redeems a minted link in a browser context, leaving the real session cookie
 * in that context's jar.
 *
 * Uses `domcontentloaded` rather than `networkidle`: the landing page and
 * /checkout/success both poll, and `networkidle` times out on a polling page
 * instead of resolving (docs/QA.md).
 */
export async function signInBrowser(
  page: {
    goto(url: string, options?: { waitUntil?: "domcontentloaded" }): Promise<unknown>;
    url(): string;
    context(): { addCookies(cookies: unknown[]): Promise<unknown> };
  },
  link: MintedLink,
): Promise<void> {
  // Present the nonce this link was minted with, which is what the browser
  // that requested it would carry. Without it the server correctly refuses to
  // create a session silently and renders the confirmation page instead, so a
  // suite that skipped this step would be testing the attacker's path and
  // calling it the customer's.
  if (link.nonce) {
    await page.context().addCookies([{
      name: DEV_LINK_NONCE_COOKIE,
      value: link.nonce,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax" as const,
    }]);
  }
  await page.goto(link.url, { waitUntil: "domcontentloaded" });
}

// ---------------------------------------------------------------------------
// Accounts and entitlements
// ---------------------------------------------------------------------------

export interface AccountRow {
  userId: string;
}

/** The `users` row a redemption created for this address, or null if it has never signed in. */
export function findAccount(email: string): AccountRow | null {
  return withDb((db) => {
    const [row] = db.prepare("select id from users where external_subject = ?").all(`email:${email}`) as Array<{ id: string }>;
    return row ? { userId: row.id } : null;
  });
}

/**
 * The plan an entitlement test should grant.
 *
 * Read from the catalog at run time rather than hardcoded. Plan availability
 * is actively being changed elsewhere in this repository, and a test that
 * named a plan by string would either break when a plan is retired or, worse,
 * quietly start asserting something about a plan it was never written for.
 * Nothing in this suite asserts a price, an allowance, or a plan name.
 */
function firstActivePlanId(): string {
  const plans = Object.values(pricingConfig.plans) as Array<{ id: string; availability: string }>;
  const active = plans.find((plan) => plan.availability === "active");
  if (!active) throw new Error("no plan in src/config/pricing.ts is available, so no entitled journey can be tested");
  return active.id;
}

/**
 * Gives an account a live subscription row, the way the Stripe webhook would.
 *
 * This is a seeded row, not a bypass: `getActiveEntitlement` reads it with
 * exactly the query it reads a real one with, and every downstream check
 * (allowance, ownership, unlock) runs unmodified. The alternative — driving
 * real Stripe checkout from a browser test — would test Stripe's hosted page,
 * not this application's authorization.
 */
export function grantEntitlement(userId: string, options: { status?: string; periodDays?: number } = {}): void {
  const now = Date.now();
  const status = options.status ?? "active";
  const periodDays = options.periodDays ?? 30;
  withDb((db) => {
    db.prepare(
      `insert into subscriptions
         (id, user_id, stripe_customer_id, stripe_subscription_id, plan_id, catalog_version,
          status, current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(
      randomUUID(),
      userId,
      `cus_e2e_${randomUUID().slice(0, 12)}`,
      `sub_e2e_${randomUUID().slice(0, 12)}`,
      firstActivePlanId(),
      pricingConfig.catalogVersion,
      status,
      now - 24 * 60 * 60 * 1000,
      now + periodDays * 24 * 60 * 60 * 1000,
      now,
      now,
    );
  });
}

// ---------------------------------------------------------------------------
// Server-side observations
// ---------------------------------------------------------------------------

/**
 * How many live session rows this account has server-side.
 *
 * The point of counting rather than reading: a test can prove sign-out
 * destroyed the session without ever handling a session digest, and an
 * assertion message can name a number instead of a credential.
 */
export function liveSessionCount(userId: string): number {
  return withDb((db) => {
    const [row] = db
      .prepare("select count(*) as n from auth_sessions where user_id = ? and expires_at > ?")
      .all(userId, Date.now()) as Array<{ n: number }>;
    return Number(row?.n ?? 0);
  });
}

/** Outstanding (unconsumed, unexpired) sign-in links for an address. Counts only — never the digests. */
export function liveLinkCount(email: string): number {
  return withDb((db) => {
    const [row] = db
      .prepare("select count(*) as n from auth_magic_link_tokens where email = ? and consumed_at is null and expires_at > ?")
      .all(email, Date.now()) as Array<{ n: number }>;
    return Number(row?.n ?? 0);
  });
}

export interface StoredPayload {
  /** Length only. The stored text is the customer's writing and never leaves this module. */
  sourceLength: number;
  resultLength: number;
  purged: boolean;
}

/**
 * What is left in `job_payloads` for a job.
 *
 * Deliberately returns lengths, not text. The deletion assertion is "the text
 * is gone, not hidden", and a length of zero proves that without a test ever
 * holding the text it is proving the absence of.
 */
export function storedPayload(jobId: string): StoredPayload | null {
  return withDb((db) => {
    const [row] = db
      .prepare("select source_ref, result_ref, purged_at from job_payloads where job_id = ?")
      .all(jobId) as Array<{ source_ref: string | null; result_ref: string | null; purged_at: number | null }>;
    if (!row) return null;
    return {
      sourceLength: (row.source_ref ?? "").length,
      resultLength: (row.result_ref ?? "").length,
      purged: row.purged_at !== null,
    };
  });
}

/** Job ids owned by this account, newest first. Metadata only. */
export function ownedJobIds(userId: string): string[] {
  return withDb((db) =>
    (db
      .prepare("select id from humanization_jobs where owner_user_id = ? order by created_at desc")
      .all(userId) as Array<{ id: string }>).map((row) => row.id),
  );
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Removes everything one E2E account created from the developer's local
 * database.
 *
 * Best-effort by construction: this runs in `t.after`, and a cleanup failure
 * must never turn a passing journey into a failing one or mask the real
 * assertion that already ran. Foreign keys are enforced in this SQLite build,
 * so the order below is child-first and is not arbitrary.
 */
export function purgeTestAccount(email: string): void {
  const account = findAccount(email);
  withDb((db) => {
    const run = (sql: string, ...params: Array<string | number>) => {
      try {
        db.prepare(sql).run(...params);
      } catch {
        // A table this build does not have, or a row another test already
        // removed. Cleanup is hygiene, not a control.
      }
    };

    run("delete from auth_magic_link_tokens where email = ?", email);
    if (!account) return;
    const { userId } = account;

    const jobIds = (db
      .prepare("select id from humanization_jobs where owner_user_id = ?")
      .all(userId) as Array<{ id: string }>).map((row) => row.id);

    for (const jobId of jobIds) {
      run("delete from analytics_outbox where job_id = ?", jobId);
      run("delete from deletion_jobs where subject_id = ?", jobId);
      run("delete from result_revisions where job_id = ?", jobId);
      run("delete from protected_items where job_id = ?", jobId);
      run("delete from job_attempts where job_id = ?", jobId);
      run("delete from anonymous_sessions where job_id = ?", jobId);
      run("delete from usage_entries where job_id = ?", jobId);
      run("delete from job_payloads where job_id = ?", jobId);
    }
    run("delete from deletion_jobs where requested_by_user_id = ?", userId);
    run("delete from usage_entries where user_id = ?", userId);
    run("delete from humanization_jobs where owner_user_id = ?", userId);
    run("delete from subscriptions where user_id = ?", userId);
    run("delete from auth_sessions where user_id = ?", userId);
    run("delete from users where id = ?", userId);
  });
}
