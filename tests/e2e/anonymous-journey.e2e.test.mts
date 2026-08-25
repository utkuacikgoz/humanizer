// Journey 1 of docs/QA.md's browser E2E list: an anonymous visitor pastes a
// draft, picks a mode, and receives a verified partial preview with a paywall
// on the remainder.
//
// Assertions here are about behaviour and structure, never about wording. The
// visual design of this page is under active change, so the tests ask "is
// there a purchase control, and does it disclose the recurring terms drawn
// from the plan catalog" rather than matching a marketing sentence.
import assert from "node:assert/strict";
import test from "node:test";
import { pricingConfig } from "../../src/config/pricing.ts";
import { subscriptionDisclosure } from "../../src/lib/subscription-disclosure.ts";
import {
  billingEntryPoint,
  closeBrowser,
  comparisonPanels,
  environmentBlocker,
  gotoHydrated,
  openSession,
  resultHeading,
  resultRegion,
  submitDraft,
  unlockButton,
} from "./helpers/harness.mts";
import { REWRITABLE_DRAFT } from "./helpers/fixtures.mts";

const blocker = await environmentBlocker();
const starter = pricingConfig.plans.starter;

test("anonymous visitor: paste, humanize, compare, hit the paywall", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;

  await page.route("**/api/billing/readiness", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ available: true, signInRequired: true, message: "You will sign in with your email before checkout." }),
  }));
  await gotoHydrated(page, "/");
  assert.equal(await resultRegion(page).count(), 0, "no result region should exist before a submission");

  const { status, body } = await submitDraft(page, REWRITABLE_DRAFT);
  assert.equal(status, 200, `preview request failed: ${JSON.stringify(body)}`);

  await resultHeading(page).waitFor({ timeout: 15_000 });

  // Both sides of the comparison exist. The comparison is the product's
  // stated activation moment (docs/ACTIVATION.md §1); a rewrite with nothing
  // to compare it against is not a preview.
  const panels = comparisonPanels(page);
  assert.equal(await panels.count(), 2, "the comparison must show the source and the rewrite");
  const sourceText = (await panels.nth(0).innerText()).replace(/\s+/g, " ");
  const rewriteText = (await panels.nth(1).innerText()).replace(/\s+/g, " ");
  assert.ok(sourceText.includes("Dr. Sarah Chen"), "the source panel must show the visitor's own draft");
  assert.ok(rewriteText.length > 0, "the rewrite panel must show the preview");
  assert.ok(await panels.nth(0).isVisible(), "the source panel must be visible");
  assert.ok(await panels.nth(1).isVisible(), "the rewrite panel must be visible");

  // A withheld remainder implies a purchase control, and the reverse.
  const hiddenWordCount = body.hiddenWordCount as number;
  assert.ok(hiddenWordCount > 0, "this fixture is expected to withhold part of the rewrite");
  const unlock = unlockButton(page);
  assert.equal(await unlock.count(), 1, "a withheld remainder must come with exactly one purchase control");
  assert.ok(await unlock.isEnabled(), "the purchase control must be operable");

  // ACT-10: the recurring terms are disclosed at the decision point, and they
  // come from the plan catalog rather than being typed into the page.
  const unlockCardText = (await unlock.locator("xpath=..").innerText()).replace(/\s+/g, " ");
  assert.ok(
    unlockCardText.includes(subscriptionDisclosure(starter)),
    `the purchase card must carry the catalog disclosure. Card read: ${JSON.stringify(unlockCardText)}`,
  );
  assert.ok(
    unlockCardText.includes(String(starter.monthlyPrice)),
    "the purchase card must state the price",
  );
  assert.ok(
    unlockCardText.includes(starter.wordLimit.toLocaleString("en-US")),
    "the purchase card must state the monthly word allowance, which is a material limit",
  );

  // ACT-09: the cancellation path is reachable from the page that sells.
  assert.equal(await billingEntryPoint(page).count(), 1, "a billing/cancel entry point must exist on the landing page");
  assert.ok(await billingEntryPoint(page).locator("button").first().isVisible(), "the billing entry point must be operable");

  assert.deepEqual(session.pageErrors, [], "the journey produced uncaught page errors");
});

test("every writing mode returns a preview for the same draft", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;
  await gotoHydrated(page, "/");

  const modeButtons = page.locator("[aria-pressed]");
  const modeCount = await modeButtons.count();
  assert.ok(modeCount >= 2, "the workspace must offer selectable writing modes");

  for (let index = 0; index < modeCount; index += 1) {
    const button = modeButtons.nth(index);
    const label = (await button.innerText()).trim();
    await button.click();
    assert.equal(await button.getAttribute("aria-pressed"), "true", `${label} did not report itself as selected`);
    const { status } = await submitDraft(page, `${REWRITABLE_DRAFT} Mode probe ${index}.`);
    assert.equal(status, 200, `mode ${label} failed with status ${status}`);
    await resultHeading(page).waitFor({ timeout: 15_000 });
  }
  assert.deepEqual(session.pageErrors, []);
});

test("a second generation in the same visit still returns a preview", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;
  await gotoHydrated(page, "/");

  const first = await submitDraft(page, REWRITABLE_DRAFT);
  assert.equal(first.status, 200, `first preview failed: ${JSON.stringify(first.body)}`);
  await resultHeading(page).waitFor({ timeout: 15_000 });

  const second = await submitDraft(page, `${REWRITABLE_DRAFT} A second pass for the same visitor.`);
  assert.equal(second.status, 200, `second preview failed: ${JSON.stringify(second.body)}`);
  await resultHeading(page).waitFor({ timeout: 15_000 });
  assert.ok(await unlockButton(page).count() >= 1 || (second.body.hiddenWordCount as number) === 0);
  assert.deepEqual(session.pageErrors, []);
});


test("the billing/cancel entry point is reachable from the post-purchase page too", { skip: blocker ?? false }, async (t) => {
  // ACT-09 requires the path on the product surface *and* on the page a
  // customer lands on immediately after being charged.
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;

  await page.goto("http://localhost:3000/checkout/success?job=e2e-nonexistent", { waitUntil: "domcontentloaded" });
  await billingEntryPoint(page).waitFor({ timeout: 15_000 });
  assert.equal(await billingEntryPoint(page).count(), 1);
  const button = billingEntryPoint(page).locator("button").first();
  assert.ok(await button.isVisible(), "the cancellation path must be operable on the post-purchase page");
  const stripText = (await billingEntryPoint(page).innerText()).replace(/\s+/g, " ");
  assert.ok(
    stripText.includes(subscriptionDisclosure(starter)),
    "the post-purchase page must restate the recurring terms from the catalog",
  );
});
