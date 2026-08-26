// The signed-in customer's journey, end to end in a real browser.
//
//   land -> ask for a sign-in link -> redeem it -> land signed in -> humanize
//   -> read the complete rewrite -> open /history -> open the item -> delete
//   it -> sign out -> find the session dead server-side.
//
// How the emailed link is obtained without sending mail, and why that seam is
// safe, is documented at the top of ./helpers/identity.mts. In one line: the
// test mints the token and stores its digest exactly as the application does,
// so every step downstream of the inbox — verify, single-use redemption,
// account creation, session issuance, the cookie — is the real production
// path with nothing stubbed and no production code changed.
//
// Nothing in this file prints a token, a session id, a cookie value, or the
// customer's text. Failure messages carry shapes, counts and lengths.
import assert from "node:assert/strict";
import test from "node:test";
import {
  closeBrowser,
  cookieHeaderFor,
  environmentBlocker,
  gotoHydrated,
  gotoReady,
  openSession,
  submitDraft,
  BASE_URL,
} from "./helpers/harness.mts";
import { REWRITABLE_DRAFT } from "./helpers/fixtures.mts";
import {
  findAccount,
  grantEntitlement,
  identityBlocker,
  liveSessionCount,
  mintSignInLink,
  ownedJobIds,
  purgeTestAccount,
  storedPayload,
  testEmail,
} from "./helpers/identity.mts";

const blocker = (await environmentBlocker()) ?? identityBlocker();

/** The trailing words of a string, for proving a passage reached the page without asserting the whole of it. */
function tailWords(text: string, count: number): string {
  return text.trim().split(/\s+/).slice(-count).join(" ");
}

function normalized(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

test("a customer signs in by link, rewrites, reads it in history, deletes it, and signs out for good", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const email = testEmail("journey");
  t.after(() => purgeTestAccount(email));

  const session = await openSession();
  t.after(() => session.close());
  const { page, context } = session;

  // --- Land, and ask for a link through the real form -----------------------
  await gotoReady(page, "/signin?return_to=%2F");
  await page.locator("#signin-email").fill(email);
  const [requestResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/auth/request-link"), { timeout: 30_000 }),
    page.locator("form button[type=submit]").first().click(),
  ]);

  // The local dev server usually has no mail provider configured, which is a
  // 503 by design ("never return 'check your inbox' for mail nobody sent" —
  // src/lib/magic-link.ts). Either outcome is a correct one; what must never
  // happen is a silent success. The response is asserted to be one of the two
  // honest states, and the page is asserted to say so.
  const requestStatus = requestResponse.status();
  assert.ok(
    requestStatus === 200 || requestStatus === 503,
    `requesting a sign-in link answered ${requestStatus}; expected 200 (sent) or 503 (no mail provider configured)`,
  );
  const requestBody = (await requestResponse.json()) as { message?: string; error?: string };
  if (requestStatus === 200) {
    assert.ok(requestBody.message, "a successful link request returned no message for the page to show");
    await page.locator(".status-line").filter({ hasText: requestBody.message }).first().waitFor({ timeout: 10_000 });
  } else {
    assert.ok(requestBody.error, "a refused link request returned no error for the page to show");
    await page.locator("[role=alert]").filter({ hasText: requestBody.error }).first().waitFor({ timeout: 10_000 });
  }
  assert.ok(
    !normalized(await page.locator("main").innerText()).includes(email.split("@")[0].toUpperCase()),
    "the sign-in page echoed something derived from the address back at the visitor",
  );

  // --- Redeem the link ------------------------------------------------------
  const link = await mintSignInLink(BASE_URL, email, "/");
  await page.goto(link.url, { waitUntil: "domcontentloaded" });
  assert.equal(
    new URL(page.url()).pathname,
    "/",
    "redeeming a valid link did not land the customer on the return path it carried",
  );

  const sessionState = await context.request.get(`${BASE_URL}/api/auth/session`);
  assert.equal(sessionState.status(), 200, "the session endpoint refused a freshly issued session");
  const state = (await sessionState.json()) as { signedIn?: boolean; email?: string };
  assert.equal(state.signedIn, true, "the redeemed link did not produce a signed-in session");
  assert.equal(state.email, email, "the session resolved to a different address than the link was issued for");

  const account = findAccount(email);
  assert.ok(account, "redeeming the link created no account row");
  assert.equal(liveSessionCount(account.userId), 1, "redemption did not leave exactly one live server-side session");

  // --- Become a paying customer --------------------------------------------
  // Seeded the way the Stripe webhook would write it. Nothing about the plan
  // is asserted anywhere below: not its name, not its price, not its
  // allowance. See helpers/identity.mts's `firstActivePlanId`.
  grantEntitlement(account.userId);

  // --- Humanize, and read the complete rewrite ------------------------------
  await gotoHydrated(page, "/");
  const rewrite = await submitDraft(page, REWRITABLE_DRAFT);
  assert.equal(rewrite.status, 200, `the signed-in rewrite answered ${rewrite.status}`);
  assert.equal(rewrite.body.paid, true, "a subscribed customer's rewrite came back as an anonymous preview");
  const fullRewrite = String(rewrite.body.result ?? "");
  assert.ok(fullRewrite.length > 0, "the paid response carried no rewrite");

  const humanizedPanel = page.locator(".comparison .humanized-panel").first();
  await humanizedPanel.waitFor({ timeout: 30_000 });
  const shown = normalized(await humanizedPanel.innerText());
  assert.ok(
    shown.includes(normalized(tailWords(fullRewrite, 6))),
    "the end of the paid rewrite never reached the page, so the customer was shown less than they were charged for",
  );
  assert.equal(
    await page.locator(".locked-copy").count(),
    0,
    "a paid rewrite was rendered with the withheld-remainder placeholder still over it",
  );
  assert.ok(
    await page.locator(".paid-result-actions").first().isVisible(),
    "the paid result actions (copy, history link) are missing from a paid rewrite",
  );
  assert.deepEqual(session.pageErrors, [], `the signed-in rewrite raised page errors: ${session.pageErrors.join(" | ")}`);

  const jobIds = ownedJobIds(account.userId);
  assert.equal(jobIds.length, 1, `expected the rewrite to record exactly one owned job, found ${jobIds.length}`);
  const jobId = jobIds[0];

  // --- The rewrite is in history -------------------------------------------
  await gotoReady(page, "/history");
  const items = page.locator(".history-list .history-item");
  await items.first().waitFor({ timeout: 30_000 });
  assert.equal(await items.count(), 1, `history showed ${await items.count()} items for an account with one rewrite`);

  // --- Open it --------------------------------------------------------------
  const [detailResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes(`/api/history/${jobId}`), { timeout: 30_000 }),
    items.first().getByRole("button", { name: /open full rewrite/i }).click(),
  ]);
  assert.equal(detailResponse.status(), 200, "the owner could not open their own rewrite");
  const detail = page.locator(".history-detail").first();
  await detail.waitFor({ timeout: 30_000 });
  const detailText = normalized(await detail.innerText());
  assert.ok(
    detailText.includes(normalized(tailWords(fullRewrite, 6))),
    "the opened history item did not contain the end of the rewrite it claims to hold",
  );
  assert.equal(
    await items.first().getByRole("button", { name: /open full rewrite|opened/i }).getAttribute("aria-expanded"),
    "true",
    "the open control did not report its expanded state to assistive technology",
  );

  // --- Delete it ------------------------------------------------------------
  const storedBefore = storedPayload(jobId);
  assert.ok(storedBefore, "the rewrite left no stored payload to delete");
  assert.ok(storedBefore.resultLength > 0, "the stored payload held no rewrite text before deletion");

  await items.first().getByRole("button", { name: /^delete$/i }).click();
  const [deleteResponse] = await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes(`/api/history/${jobId}`) && response.request().method() === "DELETE",
      { timeout: 30_000 },
    ),
    items.first().getByRole("button", { name: /delete permanently/i }).click(),
  ]);
  assert.equal(deleteResponse.status(), 200, "deleting an owned rewrite was refused");

  await page.locator(".status-line, .copy-status").filter({ hasText: /deleted/i }).first().waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => document.querySelectorAll(".history-list .history-item").length === 0, null, { timeout: 30_000 });

  // Inaccessible: the owner's own detail request now answers the same 404 a
  // stranger's would.
  const afterDelete = await context.request.get(`${BASE_URL}/api/history/${jobId}`);
  assert.equal(afterDelete.status(), 404, "a deleted rewrite is still readable by its owner");

  // Gone, not hidden. Lengths only — the assertion never handles the text it
  // is proving the absence of.
  const storedAfter = storedPayload(jobId);
  assert.ok(storedAfter, "the payload row vanished entirely, so its tombstone cannot be audited");
  assert.equal(storedAfter.resultLength, 0, `the rewrite text survived deletion (${storedAfter.resultLength} chars still stored)`);
  assert.equal(storedAfter.sourceLength, 0, `the customer's own draft survived deletion (${storedAfter.sourceLength} chars still stored)`);
  assert.equal(storedAfter.purged, true, "the payload was not stamped as purged, so the purge worker will never finish the job");

  // --- Sign out, and prove the session is dead server-side -------------------
  // Captured before the sign-out clears the jar. A live credential: it is put
  // straight into a request header and never printed.
  const staleCookie = await cookieHeaderFor(context);
  assert.ok(staleCookie.length > 0, "the browser held no cookie to replay, so the sign-out assertion would be vacuous");

  await gotoReady(page, "/signin");
  await page.locator("form.signin-signout button[type=submit]").first().click();
  await page.waitForURL((url) => new URL(url).pathname === "/", { timeout: 30_000 });

  assert.equal(
    liveSessionCount(account.userId),
    0,
    "signing out cleared the cookie but left the session row alive, so a captured cookie still works",
  );

  // The real assertion: replay the exact cookie the browser was holding.
  // Clearing a cookie only affects the copy in this browser.
  const replayed = await fetch(`${BASE_URL}/api/history`, {
    headers: { cookie: staleCookie, "cf-connecting-ip": "198.18.255.254" },
  });
  assert.equal(replayed.status, 401, `a signed-out session's cookie was still accepted (${replayed.status})`);
  const replayBody = (await replayed.json()) as { error?: string };
  assert.match(String(replayBody.error ?? ""), /sign in/i, "the refusal did not tell the caller to sign in");

  // And the browser itself is signed out.
  const finalState = await context.request.get(`${BASE_URL}/api/auth/session`);
  assert.equal(finalState.status(), 200, "the session endpoint failed after sign-out");
  assert.equal(((await finalState.json()) as { signedIn?: boolean }).signedIn, false, "the browser still reports a signed-in session after sign-out");
});
