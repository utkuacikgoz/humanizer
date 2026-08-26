// Properties of the sign-in flow that a customer never sees but an attacker
// would go looking for.
//
// Everything here is asserted against the running dev server, through the
// real routes. Where a browser is the honest medium (what a signed-out
// visitor is shown) the test drives one; where the property is about bytes on
// the wire (two responses being indistinguishable) it compares the bytes,
// because a screenshot cannot prove that.
//
// No token, session id or cookie value is printed anywhere in this file.
import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { BASE_URL, closeBrowser, environmentBlocker, gotoReady, openSession } from "./helpers/harness.mts";
import { REWRITABLE_DRAFT } from "./helpers/fixtures.mts";
import { DEV_LINK_NONCE_COOKIE } from "../../src/lib/identity";
import {
  findAccount,
  grantEntitlement,
  identityBlocker,
  liveLinkCount,
  mintSignInLink,
  ownedJobIds,
  purgeTestAccount,
  testEmail,
} from "./helpers/identity.mts";

const blocker = (await environmentBlocker()) ?? identityBlocker();

/** A unique synthetic client address, so one test's rate-limit budget is never another's failure. */
function syntheticIp(): string {
  const bytes = randomBytes(2);
  return `198.18.${bytes[0]}.${bytes[1]}`;
}

/**
 * Redeems a link with no browser involved.
 *
 * Returns the status, the destination, and the cookie header the response
 * issued (empty when it issued none). The cookie is a live credential: it is
 * passed into request headers and never printed.
 */
/**
 * Redeems a link the way the browser that requested it would: presenting the
 * nonce the link was bound to (SEC-17). Passing a bare URL string deliberately
 * omits the nonce, which is the attacker's shape and lands on confirmation.
 */
async function redeemFull(link: string | { url: string; nonce?: string }) {
  const url = typeof link === "string" ? link : link.url;
  const nonce = typeof link === "string" ? undefined : link.nonce;
  const headers: Record<string, string> = { "cf-connecting-ip": syntheticIp() };
  if (nonce) headers.cookie = `${DEV_LINK_NONCE_COOKIE}=${nonce}`;
  const response = await fetch(url, { redirect: "manual", headers });
  const cookies = response.headers.getSetCookie().map((value) => value.split(";")[0]).filter((pair) => pair.split("=")[1]);
  return { status: response.status, location: response.headers.get("location") ?? "", cookie: cookies.join("; ") };
}

// ---------------------------------------------------------------------------

test("a signed-out visitor cannot reach /history and is told to sign in", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;

  const [listResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/history"), { timeout: 30_000 }),
    gotoReady(page, "/history"),
  ]);
  assert.equal(listResponse.status(), 401, `an anonymous /api/history request answered ${listResponse.status()}`);

  const alert = page.locator("[role=alert]").first();
  await alert.waitFor({ timeout: 30_000 });
  const text = (await alert.innerText()).replace(/\s+/g, " ").trim();
  assert.match(text, /sign in/i, `the signed-out history page did not tell the visitor to sign in: ${JSON.stringify(text)}`);

  const signInLink = alert.getByRole("link", { name: /sign in/i }).first();
  assert.ok(await signInLink.isVisible(), "the signed-out history page offers no way to get to sign-in");
  assert.equal(
    new URL(await signInLink.getAttribute("href") ?? "", BASE_URL).pathname,
    "/signin",
    "the sign-in offer on the history page does not point at the sign-in page",
  );

  assert.equal(await page.locator(".history-list .history-item").count(), 0, "a signed-out visitor was rendered history rows");
  assert.deepEqual(session.pageErrors, [], `the signed-out history page raised page errors: ${session.pageErrors.join(" | ")}`);
});

test("requesting a link for an unknown address is indistinguishable from a known one", { skip: blocker ?? false }, async (t) => {
  const known = testEmail("known");
  const unknown = testEmail("unknown");
  t.after(() => purgeTestAccount(known));
  t.after(() => purgeTestAccount(unknown));

  // Make `known` genuinely known: a real account, created the only way one
  // ever is — by redeeming a link — plus a live subscription, so the two
  // addresses differ in every way the database can express.
  const seedLink = await mintSignInLink(BASE_URL, known, "/");
  const seeded = await redeemFull(seedLink);
  assert.equal(seeded.status, 303, "seeding the known account failed at redemption");
  const account = findAccount(known);
  assert.ok(account, "seeding the known account created no user row");
  grantEntitlement(account.userId);
  assert.equal(findAccount(unknown), null, "the 'unknown' address already has an account, so this test proves nothing");

  async function requestLink(email: string) {
    const response = await fetch(`${BASE_URL}/api/auth/request-link`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": syntheticIp() },
      body: JSON.stringify({ email, returnTo: "/history" }),
    });
    return {
      status: response.status,
      body: await response.text(),
      contentType: response.headers.get("content-type"),
      cacheControl: response.headers.get("cache-control"),
      retryAfter: response.headers.get("retry-after"),
      setCookies: response.headers.getSetCookie().length,
    };
  }

  // Interleaved, and the unknown address goes first, so neither ordering nor
  // a warm cache can be the reason they match.
  const first = await requestLink(unknown);
  const second = await requestLink(known);
  const third = await requestLink(unknown);

  assert.deepEqual(second, first, "a registered address produced a different response than an unregistered one");
  assert.deepEqual(third, first, "two requests for the same unregistered address were not identical");

  // Whatever state the server is in, it must be an honest one: either a link
  // was really issued (200), or the operator is told mail is unconfigured
  // (503). A cheerful 200 for mail nobody sent is the failure this checks for.
  assert.ok(
    first.status === 200 || first.status === 503,
    `requesting a link answered ${first.status}; expected 200 (sent) or 503 (no mail provider)`,
  );
  const parsed = JSON.parse(first.body) as { ok?: boolean; message?: string; error?: string };
  if (first.status === 200) {
    assert.equal(parsed.ok, true, "a 200 link request did not report success");
    assert.doesNotMatch(String(parsed.message), /account|registered|exists|unknown/i, "the success message leaks whether the address is registered");
    // A link was really issued for both, and for neither address does the
    // count reveal anything: both go from zero to one.
    assert.equal(liveLinkCount(unknown), 2, "the unregistered address had no link issued, so the responses matched but the behaviour did not");
    assert.equal(liveLinkCount(known), 1, "the registered address had no link issued");
  } else {
    assert.ok(parsed.error, "a 503 link request returned no operator-visible error");
    assert.equal(liveLinkCount(unknown), 0, "a refused request still issued a link");
    assert.equal(liveLinkCount(known), 0, "a refused request still issued a link");
  }
});

test("a redeemed link produces a working session and cannot be redeemed twice", { skip: blocker ?? false }, async (t) => {
  const email = testEmail("single-use");
  t.after(() => purgeTestAccount(email));

  const link = await mintSignInLink(BASE_URL, email, "/history");

  const first = await redeemFull(link);
  assert.equal(first.status, 303, `the first redemption answered ${first.status}`);
  assert.equal(first.location, "/history", "the first redemption did not honour the link's return path");
  assert.ok(first.cookie.length > 0, "the first redemption issued no session cookie");

  const working = await fetch(`${BASE_URL}/api/history`, { headers: { cookie: first.cookie, "cf-connecting-ip": syntheticIp() } });
  assert.equal(working.status, 200, `the session from a redeemed link could not read history (${working.status})`);

  const second = await redeemFull(link);
  assert.equal(second.status, 303, `the second redemption answered ${second.status}`);
  assert.equal(
    second.location,
    "/signin?error=link&return_to=%2Fhistory",
    "redeeming a spent link did not send the customer back to sign-in with the expired/used message",
  );
  assert.equal(second.cookie.length, 0, "redeeming a spent link issued a second session cookie");

  // The first session is untouched by the failed second redemption.
  const stillWorking = await fetch(`${BASE_URL}/api/history`, { headers: { cookie: first.cookie, "cf-connecting-ip": syntheticIp() } });
  assert.equal(stillWorking.status, 200, "a failed redemption invalidated the session the successful one issued");
});

test("an expired link fails exactly the way a spent one does", { skip: blocker ?? false }, async (t) => {
  const email = testEmail("expired");
  t.after(() => purgeTestAccount(email));

  const issuedAt = Date.now() - 60 * 60 * 1000;
  const link = await mintSignInLink(BASE_URL, email, "/", { issuedAt, expiresAt: issuedAt + 15 * 60 * 1000 });

  const outcome = await redeemFull(link);
  assert.equal(outcome.status, 303, `redeeming an expired link answered ${outcome.status}`);
  assert.equal(outcome.location, "/signin?error=link&return_to=%2F", "an expired link produced a different destination than a spent one");
  assert.equal(outcome.cookie.length, 0, "an expired link issued a session cookie");
  assert.equal(findAccount(email), null, "an expired link created an account");
});

test("a malformed or invented token is refused without a database lookup being observable", { skip: blocker ?? false }, async () => {
  const cases = [
    { label: "wrong shape", token: "short" },
    { label: "empty", token: "" },
    { label: "well-formed but never issued", token: Buffer.from(randomBytes(32)).toString("base64url") },
  ];
  const seen = new Set<string>();
  for (const testCase of cases) {
    const outcome = await redeemFull(`${BASE_URL}/api/auth/verify?token=${encodeURIComponent(testCase.token)}&return_to=%2F`);
    assert.equal(outcome.status, 303, `${testCase.label}: answered ${outcome.status}`);
    assert.equal(outcome.cookie.length, 0, `${testCase.label}: a session cookie was issued`);
    seen.add(outcome.location);
  }
  assert.equal(seen.size, 1, `verify distinguishes between kinds of bad token: ${[...seen].join(" vs ")}`);
  assert.equal([...seen][0], "/signin?error=link&return_to=%2F", "a bad token produced an unexpected destination");
});

test("a link opened in a browser that did not request it never signs anyone in silently", { skip: blocker ?? false }, async (t) => {
  // SEC-17. This is the attacker's path: they request a link for their own
  // address and mail it to someone else. Before the nonce binding, the
  // victim's click created a session pointing at the attacker, and no page
  // showed whose account they were in. The link must still be usable when it
  // is genuinely opened on another device, so the answer is a confirmation
  // step rather than a refusal.
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;

  const email = testEmail("sec17");
  t.after(() => purgeTestAccount(email));
  const link = await mintSignInLink(BASE_URL, email);

  // Deliberately do NOT present the nonce: this browser did not ask for it.
  await page.goto(link.url, { waitUntil: "domcontentloaded" });

  assert.equal(findAccount(email), null, "opening an unbound link must not create an account on its own");

  const confirm = page.locator('button[type="submit"]');
  assert.ok(await confirm.count() >= 1, "an unbound link must land on a confirmation step, not a session");
  const shown = await page.locator("body").innerText();
  assert.ok(shown.includes(email), "the confirmation step must name the account it would sign you into");

  // Confirming deliberately, as the real cross-device customer would.
  await confirm.first().click();
  await page.waitForURL((url: URL) => !url.pathname.startsWith("/api/auth/verify"), { timeout: 15_000 });

  const account = findAccount(email);
  assert.ok(account, "confirming on another device must still sign the customer in");

  assert.deepEqual(session.pageErrors, [], "the confirmation journey produced uncaught page errors");
});

test("one customer's history is unreachable from another customer's live session", { skip: blocker ?? false }, async (t) => {
  const owner = testEmail("owner");
  const stranger = testEmail("stranger");
  t.after(() => purgeTestAccount(owner));
  t.after(() => purgeTestAccount(stranger));

  const ownerSession = (await redeemFull(await mintSignInLink(BASE_URL, owner, "/"))).cookie;
  const ownerAccount = findAccount(owner);
  assert.ok(ownerAccount, "the owner account was not created");
  grantEntitlement(ownerAccount.userId);

  const rewrite = await fetch(`${BASE_URL}/api/humanize`, {
    method: "POST",
    headers: {
      cookie: ownerSession,
      "content-type": "application/json",
      "x-idempotency-key": crypto.randomUUID(),
      "cf-connecting-ip": syntheticIp(),
    },
    body: JSON.stringify({ text: REWRITABLE_DRAFT, mode: "natural" }),
  });
  assert.equal(rewrite.status, 200, `the owner's rewrite answered ${rewrite.status}`);
  const jobIds = ownedJobIds(ownerAccount.userId);
  assert.equal(jobIds.length, 1, `expected one owned job, found ${jobIds.length}`);
  const jobId = jobIds[0];

  const strangerSession = (await redeemFull(await mintSignInLink(BASE_URL, stranger, "/"))).cookie;
  const strangerAccount = findAccount(stranger);
  assert.ok(strangerAccount, "the stranger account was not created");
  grantEntitlement(strangerAccount.userId);

  const strangerList = await fetch(`${BASE_URL}/api/history`, { headers: { cookie: strangerSession, "cf-connecting-ip": syntheticIp() } });
  assert.equal(strangerList.status, 200, "the stranger could not read their own (empty) history");
  const listBody = (await strangerList.json()) as { items: Array<{ jobId: string }> };
  assert.equal(listBody.items.length, 0, `a second entitled account saw ${listBody.items.length} rows that are not theirs`);

  const strangerDetail = await fetch(`${BASE_URL}/api/history/${jobId}`, { headers: { cookie: strangerSession, "cf-connecting-ip": syntheticIp() } });
  assert.equal(strangerDetail.status, 404, `a stranger read another customer's rewrite (${strangerDetail.status})`);

  const strangerDelete = await fetch(`${BASE_URL}/api/history/${jobId}`, {
    method: "DELETE",
    headers: { cookie: strangerSession, "cf-connecting-ip": syntheticIp() },
  });
  assert.equal(strangerDelete.status, 404, `a stranger's delete of another customer's rewrite answered ${strangerDelete.status}`);

  // And it really is still there for its owner.
  const ownerDetail = await fetch(`${BASE_URL}/api/history/${jobId}`, { headers: { cookie: ownerSession, "cf-connecting-ip": syntheticIp() } });
  assert.equal(ownerDetail.status, 200, "the stranger's refused delete destroyed the owner's rewrite anyway");
});
