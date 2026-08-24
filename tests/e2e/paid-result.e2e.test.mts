import assert from "node:assert/strict";
import test from "node:test";
import { closeBrowser, environmentBlocker, gotoHydrated, openSession } from "./helpers/harness.mts";

const blocker = await environmentBlocker();
const JOB_ID = "9a3a2a68-ec26-49a3-a8b3-fbd5950d88e6";
const FULL_RESULT = "Dr. Sarah Chen approved the 12% improvement on March 14, 2024. The team published the complete report after the final review.";

test("the paid result proves quality, copies accessibly, and fires completion events once", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;

  await page.addInitScript(`
    window.__ownwordEvents = [];
    window.addEventListener("humanizer:analytics", event => window.__ownwordEvents.push(event.detail.event));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async value => { window.__ownwordCopied = value; } }
    });
  `);
  await page.route("**/api/result?job=*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      original: "It is important to note that Dr. Sarah Chen approved the 12% improvement on March 14, 2024. Furthermore, the team published the complete report after the final review.",
      result: FULL_RESULT,
      issuesImproved: 2,
      naturalness: "Strong",
      meaningPreservation: "High",
      protectedItems: ["Dr. Sarah Chen", "12%", "March 14, 2024", "14", "2024"],
    }),
  }));

  await gotoHydrated(page, `/checkout/success?job=${JOB_ID}`);
  await page.getByRole("heading", { name: "Your full rewrite is unlocked" }).waitFor({ timeout: 15_000 });
  assert.match(await page.locator(".checks").innerText(), /Strong[\s\S]*High[\s\S]*2 improvements/);
  assert.match(await page.locator(".protected-note").innerText(), /Dr\. Sarah Chen[\s\S]*12%[\s\S]*March 14, 2024/);

  const copy = page.getByRole("button", { name: "Copy full rewrite" });
  await copy.focus();
  await page.keyboard.press("Enter");
  await page.getByText("Copied to your clipboard.").waitFor();
  assert.equal(await page.evaluate("window.__ownwordCopied"), FULL_RESULT);

  const events = await page.evaluate("window.__ownwordEvents");
  assert.equal(events.filter((event: string) => event === "checkout_completed").length, 1);
  assert.equal(events.filter((event: string) => event === "full_result_unlocked").length, 1);
  assert.equal(events.filter((event: string) => event === "result_copied").length, 1);
  assert.deepEqual(session.pageErrors, []);
});
