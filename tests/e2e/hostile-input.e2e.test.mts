// The input half of docs/QA.md's manual destructive charter, automated:
// boundaries, byte-heavy Unicode, bidi, markup, markdown, and fact-dense
// prose, driven through the real editor rather than posted at the API.
//
// Two properties matter for every input: the product never executes what the
// visitor pasted, and it never silently loses it.
import assert from "node:assert/strict";
import test from "node:test";
import {
  closeBrowser,
  draftInput,
  environmentBlocker,
  errorMessage,
  gotoHydrated,
  openSession,
  resultRegion,
  submitButton,
  submitDraft,
  unlockButton,
} from "./helpers/harness.mts";
import { HOSTILE_DRAFTS } from "./helpers/fixtures.mts";

const blocker = await environmentBlocker();

/** Submits without waiting for a network call — for drafts the client rejects. */
async function submitLocally(page: Awaited<ReturnType<typeof openSession>>["page"], text: string) {
  const calls: string[] = [];
  const record = (request: { url(): string }) => {
    if (request.url().includes("/api/humanize")) calls.push(request.url());
  };
  page.on("request", record);
  await draftInput(page).fill(text);
  await submitButton(page).click();
  await page.waitForTimeout(800);
  page.off("request", record);
  return calls.length;
}

test("drafts below the minimum are refused by the client without a network call", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;
  await gotoHydrated(page, "/");

  for (const [name, draft] of [
    ["empty", HOSTILE_DRAFTS.empty],
    ["one word", HOSTILE_DRAFTS.oneWord],
    ["eleven words", HOSTILE_DRAFTS.elevenWords],
    ["a single 5000-character word", HOSTILE_DRAFTS.giantSingleWord],
  ] as const) {
    const calls = await submitLocally(page, draft);
    assert.equal(calls, 0, `${name} should not reach the API`);
    assert.equal(await resultRegion(page).count(), 0, `${name} produced a result region`);
    assert.ok(await errorMessage(page).isVisible(), `${name} produced no visible message`);
    const message = (await errorMessage(page).innerText()).trim();
    assert.ok(message.length > 0, `${name} produced an empty message`);
    assert.ok(
      !/undefined|null|\[object|Error:|TypeError|SyntaxError/.test(message),
      `${name} surfaced a developer-facing message: ${JSON.stringify(message)}`,
    );
  }
});

test("the word-count boundary is enforced at exactly the documented limit", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;
  await gotoHydrated(page, "/");

  // One word over: refused by the client, no request made.
  const overCalls = await submitLocally(page, HOSTILE_DRAFTS.threeHundredOneWords);
  assert.equal(overCalls, 0, "301 words should be refused before the network");
  assert.ok(await errorMessage(page).isVisible(), "301 words produced no message");

  // Exactly at the limit: accepted and sent.
  const atLimit = await submitLocally(page, HOSTILE_DRAFTS.threeHundredWords);
  assert.equal(atLimit, 1, "300 words is inside the documented limit and must be accepted");
});

test("the editor never silently discards part of a paste", { skip: blocker ?? false }, async (t) => {
  // KNOWN FAILURE, reported by MQA. The textarea carries maxlength=2400 while
  // the visible contract is a word count. A 300-word draft of ordinary English
  // exceeds 2400 characters, so the browser truncates it mid-word on paste —
  // and because the resulting text is *shorter*, the word meter drops to a
  // number under the limit and shows a green, in-range state. The visitor gets
  // no character counter, no warning, and no way to know that the end of their
  // draft is gone; they can then be charged for a rewrite of a document that
  // was quietly cut. This test asserts the honest behaviour and fails today.
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;
  await gotoHydrated(page, "/");

  const realisticDraft = Array.from({ length: 300 }, (_, i) => (i % 9 === 8 ? "communication." : "communication")).join(" ");
  assert.ok(realisticDraft.length > 2_400, "fixture must exceed the textarea character cap to exercise the defect");

  await draftInput(page).fill(realisticDraft);
  const kept = await draftInput(page).inputValue();
  assert.equal(
    kept.length,
    realisticDraft.length,
    `the editor kept ${kept.length} of ${realisticDraft.length} characters. ` +
      "Either the whole draft must survive, or the loss must be visible to the visitor.",
  );
});

test("pasted markup is rendered as text and never executed", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;
  await gotoHydrated(page, "/");

  const { status } = await submitDraft(page, HOSTILE_DRAFTS.markup);
  assert.equal(status, 200);
  await page.waitForTimeout(600);

  const executed = (await page.evaluate(
    `[!!window.__xssScript, !!window.__xssHandler, !!window.__xssSvg]`,
  )) as boolean[];
  assert.deepEqual(executed, [false, false, false], "pasted markup executed in the page");

  // Scoped to the surface that renders the visitor's text, because the dev
  // server legitimately serves its own module scripts on the surrounding page.
  // Nothing the visitor pasted may have become an element or an event handler.
  const injected = (await page.evaluate(
    `(() => { const r = document.querySelector("#result, section.result"); if (!r) return ["no-result-region"];
      return [r.querySelectorAll("script").length, r.querySelectorAll("[onerror], [onload], [onclick]").length,
              r.querySelectorAll("iframe, object, embed").length]; })()`,
  )) as unknown[];
  assert.deepEqual(injected, [0, 0, 0], "pasted markup became live DOM nodes or event handlers in the result");

  // And it is still shown to the visitor as the literal text they pasted.
  const shown = await resultRegion(page).innerText();
  assert.ok(shown.includes("<script>"), "the pasted markup must be visible as text, not swallowed");
  assert.ok(shown.includes("onerror="), "the pasted attribute payload must be visible as text");
  assert.deepEqual(session.pageErrors, []);
});

test("byte-heavy, bidirectional and fact-dense drafts either succeed or fail comprehensibly", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const outcomes: Array<[string, string]> = [];

  // belowMinimum is deliberately absent: it is under the 25-word server
  // minimum, so the client refuses it without a network call and there is
  // no response for this test to assert on. That path is covered by
  // "drafts below the minimum are refused by the client without a network call".
  for (const name of ["emoji", "rightToLeft", "markdown", "citationHeavy"] as const) {
    const session = await openSession();
    t.after(() => session.close());
    const { page } = session;
    await gotoHydrated(page, "/");
    const { status, body } = await submitDraft(page, HOSTILE_DRAFTS[name]);
    await page.waitForTimeout(500);

    if (status === 200) {
      assert.equal(await resultRegion(page).count(), 1, `${name}: a 200 must render a result region`);
      // Whatever the outcome, the paywall invariant holds.
      const withheld = typeof body.hiddenWordCount === "number" ? body.hiddenWordCount : 0;
      assert.equal(
        (await unlockButton(page).count()) > 0,
        withheld > 0,
        `${name}: purchase control rendered without a withheld remainder`,
      );
      outcomes.push([name, "preview"]);
    } else {
      const message = (await errorMessage(page).innerText()).trim();
      assert.ok(message.length > 0, `${name}: status ${status} produced no visible message`);
      assert.ok(
        !/undefined|\[object|TypeError|SyntaxError|Unexpected token|Failed to fetch/.test(message),
        `${name}: status ${status} surfaced a developer-facing message: ${JSON.stringify(message)}`,
      );
      outcomes.push([name, `error ${status}`]);
    }
    assert.deepEqual(session.pageErrors, [], `${name}: uncaught page errors`);
  }

  t.diagnostic(`outcomes: ${outcomes.map(([n, o]) => `${n}=${o}`).join(", ")}`);
  await closeBrowser();
});
