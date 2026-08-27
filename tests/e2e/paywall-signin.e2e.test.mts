// The signed-out customer at the paywall, in a real browser.
//
//   paste -> read the preview -> click Unlock -> get a 401 -> sign in without
//   leaving the page -> have the checkout resume itself.
//
// The point under test is what the browser does with /api/checkout's 401. The
// route's own behaviour is covered by tests/checkout.test.mts; what was never
// covered is the client, and the client is where the defect was: it followed
// the 401 with a full navigation to /signin, which discarded the preview.
// The preview is React state on that page, so leaving is losing it, and the
// customer came back to an empty rewriter having already been ready to pay.
//
// WHAT IS STUBBED, AND WHY THAT IS HONEST HERE. Three endpoints are answered
// by the test rather than the app:
//
//   /api/billing/readiness — a dev worker has no Stripe keys, so the real
//     answer is `available: false` and the unlock control is inert. The
//     paywall cannot be reached at all without this.
//   /api/checkout — the 401 this test is about, and later a success whose
//     `url` points back at this origin. A real Stripe URL would navigate the
//     browser off the app and out of the test.
//   /api/auth/request-link and /api/auth/session — no mail is sent, and the
//     link is "opened" by flipping the session answer, which is exactly what
//     opening it in another tab would look like from this tab.
//
// Everything between them is real: the rewrite, the preview, the components,
// the native <dialog>, the poll, and the resumed checkout call with the
// capability the first attempt was holding.
import assert from "node:assert/strict";
import test from "node:test";
import {
  closeBrowser,
  environmentBlocker,
  gotoHydrated,
  openSession,
  resultRegion,
  submitDraft,
  unlockButton,
  BASE_URL,
} from "./helpers/harness.mts";
import { REWRITABLE_DRAFT } from "./helpers/fixtures.mts";

const blocker = await environmentBlocker();

const READINESS = {
  available: true,
  signInRequired: true,
  message: "Checkout is open. Cancel anytime.",
};

test("a signed-out customer signs in at the paywall without losing the rewrite", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;

  await page.route(`${BASE_URL}/api/billing/readiness`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(READINESS) }));

  // What the app really answers a signed-out caller: 401 with a path, and no
  // checkout URL.
  let signedIn = false;
  const checkoutBodies: Array<Record<string, unknown>> = [];
  await page.route(`${BASE_URL}/api/checkout`, async (route) => {
    checkoutBodies.push(JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>);
    if (!signedIn) {
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Sign in to continue.", signInPath: "/signin?return_to=%2F" }),
      });
    }
    // Stands in for a Stripe Checkout URL, on this origin so the browser
    // stays where the test can see it.
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: `${BASE_URL}/terms?stub=checkout` }),
    });
  });

  await page.route(`${BASE_URL}/api/auth/request-link`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ message: "Check your inbox for the sign-in link." }) }));
  await page.route(`${BASE_URL}/api/auth/session`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(signedIn ? { signedIn: true, email: "paywall@example.test" } : { signedIn: false }),
    }));

  await gotoHydrated(page, "/");
  const submitted = await submitDraft(page, REWRITABLE_DRAFT);
  assert.equal(submitted.status, 200, "the draft was not rewritten, so there is no paywall to reach");

  const preview = (await resultRegion(page).innerText()).trim();
  assert.ok(preview.length > 0, "the preview is empty before the paywall is even reached");

  await unlockButton(page).click();

  const dialog = page.locator("dialog.auth-dialog");
  await dialog.waitFor({ state: "visible", timeout: 10_000 });

  // The defect, stated as an assertion: the customer is still on the page
  // holding their rewrite, and the rewrite is still on it.
  assert.equal(new URL(page.url()).pathname, "/", "the paywall navigated away from the preview");
  assert.ok(await dialog.evaluate((node: HTMLDialogElement) => node.open), "the dialog is in the DOM but not open");
  assert.equal(
    (await resultRegion(page).innerText()).trim(),
    preview,
    "the rewrite changed while the customer was signing in",
  );

  // showModal() is what puts focus in the dialog and makes the rest of the
  // page inert. Both are the browser's, and both are why this is a <dialog>.
  assert.ok(
    await page.evaluate(() => document.querySelector("dialog.auth-dialog")?.contains(document.activeElement) ?? false),
    "focus stayed outside the dialog, so the background is still reachable",
  );

  // One checkout attempt so far, carrying a capability the page never showed.
  assert.equal(checkoutBodies.length, 1);
  assert.equal(typeof checkoutBodies[0].capability, "string");

  // A way out that does not depend on this dialog working.
  await assert.doesNotReject(page.locator('dialog.auth-dialog a[href^="/signin"]').first().waitFor({ timeout: 5_000 }));

  await page.locator("#signin-dialog-email").fill("paywall@example.test");
  await page.locator("dialog.auth-dialog button.auth-submit").click();
  await page.locator("dialog.auth-dialog .auth-dialog-wait").waitFor({ state: "visible", timeout: 10_000 });

  // The link is opened somewhere else. From this tab that is one thing: the
  // session endpoint starts saying yes.
  signedIn = true;

  // And the checkout the 401 interrupted finishes itself, with no second
  // click from the customer.
  await page.waitForURL(/\/terms\?stub=checkout/, { timeout: 20_000 });
  assert.equal(checkoutBodies.length, 2, "the checkout was not resumed, or was started more than once");
  assert.deepEqual(checkoutBodies[1], checkoutBodies[0], "the resumed checkout is not the one that was interrupted");

  assert.deepEqual(session.pageErrors, [], "the page threw while signing in at the paywall");
});
