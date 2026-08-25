import assert from "node:assert/strict";
import test from "node:test";
import { SAMPLE_TEXT } from "../../src/config/sample.ts";
import {
  closeBrowser,
  draftInput,
  environmentBlocker,
  gotoHydrated,
  openSession,
  resultHeading,
  unlockButton,
} from "./helpers/harness.mts";

const blocker = await environmentBlocker();

test("Try an example loads and submits once with privacy-safe attribution", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;

  await page.addInitScript(`window.__ownwordEvents = []; window.addEventListener("humanizer:analytics", event => window.__ownwordEvents.push(event.detail));`);
  await gotoHydrated(page, "/");

  let previewRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/humanize")) previewRequests += 1;
  });
  const previewResponse = page.waitForResponse((response) => response.url().includes("/api/humanize"), { timeout: 30_000 });
  await page.locator("button.sample-button").click({ clickCount: 2 });
  const response = await previewResponse;
  assert.equal(response.status(), 200);
  await resultHeading(page).waitFor({ timeout: 15_000 });

  assert.equal(await draftInput(page).inputValue(), SAMPLE_TEXT);
  assert.equal(previewRequests, 1, "a same-render double click submitted the sample more than once");
  const events = await page.evaluate(`window.__ownwordEvents` ) as Array<{ event: string; properties: Record<string, unknown> }>;
  const starts = events.filter((event) => event.event === "humanization_started");
  assert.equal(starts.length, 1);
  assert.equal(starts[0].properties.source, "sample");
  assert.equal("text" in starts[0].properties, false, "analytics must not contain the sample or customer writing");
  assert.deepEqual(session.pageErrors, []);
});

test("an unavailable server probe leaves no active purchase CTA", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;
  await page.route("**/api/billing/readiness", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({
      available: false,
      signInRequired: true,
      message: "Checkout is temporarily unavailable. Your preview is still yours to review.",
    }),
  }));
  await gotoHydrated(page, "/");
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/humanize"), { timeout: 30_000 }),
    page.locator("button.sample-button").click(),
  ]);
  await resultHeading(page).waitFor({ timeout: 15_000 });

  const unlock = unlockButton(page);
  assert.equal(await unlock.count(), 1, "the withheld result should still explain the unavailable purchase path");
  assert.equal(await unlock.isDisabled(), true);
  assert.match(await unlock.locator("xpath=..").innerText(), /temporarily unavailable/i);
  assert.deepEqual(session.pageErrors, []);
});

test("a verified purchase CTA explains sign-in before the click", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;
  await page.route("**/api/billing/readiness", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      available: true,
      signInRequired: true,
      message: "You will sign in with your email before checkout.",
    }),
  }));
  await gotoHydrated(page, "/");
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/humanize"), { timeout: 30_000 }),
    page.locator("button.sample-button").click(),
  ]);
  await resultHeading(page).waitFor({ timeout: 15_000 });

  const unlock = unlockButton(page);
  assert.equal(await unlock.isEnabled(), true);
  assert.match(await unlock.locator("xpath=..").innerText(), /sign in with your email before checkout/i);
  assert.deepEqual(session.pageErrors, []);
});
