// M1 gate (docs/QA.md): "Core input/result states pass responsive
// keyboard/accessibility review."
//
// The repo deliberately uses `aria-disabled` plus a JavaScript re-entrancy
// guard instead of the native `disabled` attribute, because a button that
// becomes `disabled` while focused drops focus to <body> and strands a
// keyboard or screen-reader user with no landmark. That choice is only
// correct if the guard actually holds, so it is tested here rather than
// assumed.
import assert from "node:assert/strict";
import test from "node:test";
import {
  closeBrowser,
  draftInput,
  environmentBlocker,
  gotoHydrated,
  openSession,
  resultHeading,
  submitButton,
  unlockButton,
} from "./helpers/harness.mts";
import { REWRITABLE_DRAFT } from "./helpers/fixtures.mts";

const blocker = await environmentBlocker();

const ACTIVE_ELEMENT = `(() => {
  const a = document.activeElement;
  if (!a || a === document.body) return { tag: "BODY", name: "", outline: "", shadow: "", visible: false };
  const s = getComputedStyle(a);
  return {
    tag: a.tagName,
    name: (a.getAttribute("aria-label") || a.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 60),
    outline: s.outlineStyle + " " + s.outlineWidth,
    shadow: s.boxShadow,
    visible: a.getBoundingClientRect().width > 0,
  };
})()`;

type Focused = { tag: string; name: string; outline: string; shadow: string; visible: boolean };

function hasVisibleFocusRing(focused: Focused) {
  const outlined = focused.outline !== "none 0px" && !focused.outline.startsWith("none");
  const shadowed = focused.shadow !== "none" && focused.shadow.length > 0;
  return outlined || shadowed;
}

test("every interactive control is keyboard reachable with a visible focus indicator", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;
  await gotoHydrated(page, "/");

  const stops: Focused[] = [];
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press("Tab");
    const focused = (await page.evaluate(ACTIVE_ELEMENT)) as Focused;
    if (focused.tag === "BODY" && stops.length > 0) break; // tab order left the document
    stops.push(focused);
  }

  assert.ok(stops.length >= 8, `expected a substantial tab order, reached ${stops.length} stops`);
  for (const stop of stops) {
    assert.ok(stop.visible, `focus landed on a zero-size element: ${JSON.stringify(stop)}`);
    assert.ok(
      hasVisibleFocusRing(stop),
      `no visible focus indicator on ${stop.tag} "${stop.name}" (outline=${stop.outline}, boxShadow=${stop.shadow})`,
    );
  }

  // The editor and the submit control are both in the tab order.
  const tags = stops.map((s) => s.tag);
  assert.ok(tags.includes("TEXTAREA"), "the draft editor is not keyboard reachable");
  assert.ok(tags.filter((tag) => tag === "BUTTON").length >= 5, "the mode controls and submit are not all reachable");
});

test("the whole journey is operable from the keyboard alone", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;
  await gotoHydrated(page, "/");

  await draftInput(page).focus();
  await page.keyboard.insertText(REWRITABLE_DRAFT);

  // Tab to the submit control rather than clicking it.
  let reachedSubmit = false;
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    if (await submitButton(page).evaluate((node) => node === document.activeElement)) {
      reachedSubmit = true;
      break;
    }
  }
  assert.ok(reachedSubmit, "the submit control could not be reached by Tab from the editor");

  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/humanize"), { timeout: 30_000 }),
    page.keyboard.press("Enter"),
  ]);
  await resultHeading(page).waitFor({ timeout: 15_000 });

  // Focus was routed to the result, not dropped.
  const afterResult = (await page.evaluate(ACTIVE_ELEMENT)) as Focused;
  assert.equal(afterResult.tag, "H2", `focus was not moved to the result heading, it was on ${JSON.stringify(afterResult)}`);
  assert.ok(hasVisibleFocusRing(afterResult), "the result heading takes focus with no visible indicator");

  // Tabbing on from the result reaches the purchase control.
  let reachedUnlock = false;
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Tab");
    if (await unlockButton(page).evaluate((node) => node === document.activeElement)) {
      reachedUnlock = true;
      break;
    }
  }
  assert.ok(reachedUnlock, "the purchase control is not reachable by keyboard from the result heading");
  assert.deepEqual(session.pageErrors, []);
});

test("aria-disabled plus the JS guard blocks re-submission without stranding focus", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;
  await gotoHydrated(page, "/");

  let calls = 0;
  await page.route("**/api/humanize", async (route) => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    await route.continue();
  });

  await draftInput(page).fill(REWRITABLE_DRAFT);
  await submitButton(page).focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);

  // In flight: advertised as unavailable, but still a real focusable button.
  assert.equal(await submitButton(page).getAttribute("aria-disabled"), "true", "the in-flight state is not announced");
  assert.equal(
    await submitButton(page).evaluate((node: HTMLButtonElement) => node.disabled),
    false,
    "the native disabled attribute is back — it drops keyboard focus to <body> mid-request",
  );
  const duringFlight = (await page.evaluate(ACTIVE_ELEMENT)) as Focused;
  assert.notEqual(duringFlight.tag, "BODY", "keyboard focus was stranded on <body> during the request");
  assert.ok(hasVisibleFocusRing(duringFlight), "the focused control lost its focus indicator while in flight");

  // Hammering it changes nothing.
  for (let i = 0; i < 5; i += 1) await page.keyboard.press("Enter");
  await submitButton(page).click({ force: true });
  await submitButton(page).click({ force: true });

  await resultHeading(page).waitFor({ timeout: 20_000 });
  assert.equal(calls, 1, `the guard let ${calls} requests through for one submission`);
  const afterResult = (await page.evaluate(ACTIVE_ELEMENT)) as Focused;
  assert.equal(afterResult.tag, "H2", "focus was not routed to the result after the guarded request");
});

test("the workspace carries the roles, labels and landmarks a screen reader needs", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;
  await gotoHydrated(page, "/");

  // Exactly one first-level heading, and a labelled editor.
  assert.equal(await page.locator("h1").count(), 1, "the page must have exactly one h1");
  const editorName = await draftInput(page).evaluate((node) => {
    const id = node.getAttribute("id");
    const label = id ? document.querySelector(`label[for="${id}"]`) : null;
    return node.getAttribute("aria-label") ?? label?.textContent ?? "";
  });
  assert.ok(editorName.trim().length > 0, "the draft editor has no accessible name");

  // Mode controls expose their selected state programmatically.
  const modes = page.locator("[aria-pressed]");
  const modeCount = await modes.count();
  assert.ok(modeCount >= 2, "the writing modes are not exposed as toggle controls");
  const pressed = await modes.evaluateAll((nodes) => nodes.filter((n) => n.getAttribute("aria-pressed") === "true").length);
  assert.equal(pressed, 1, "exactly one writing mode must report itself as selected");

  // KNOWN FAILURE, reported by MQA: the mode controls are wrapped in a plain
  // <div aria-label="Writing mode"> with no role. `aria-label` on an element
  // with no semantics is dropped by assistive technology, so the group has no
  // accessible name and the four buttons are announced as four unrelated
  // controls. A role of `group` (or a radiogroup) fixes it.
  const groupRole = await page.locator("[aria-label='Writing mode']").first().getAttribute("role");
  assert.ok(
    groupRole !== null,
    "the writing-mode group carries aria-label on a roleless element, so its name is not exposed",
  );
});

test("an async result is announced through a live region that already existed", { skip: blocker ?? false }, async (t) => {
  // KNOWN FAILURE, reported by MQA. The result is wrapped in a section that
  // carries aria-live, but the section itself is created at the same moment as
  // its content. Assistive technology observes mutations *inside* an existing
  // live region; a region inserted together with its text is generally not
  // announced. The mitigation in place is that focus is moved to the result
  // heading, which most screen readers will then read — so this is a
  // robustness gap rather than silence, but the live region as written does
  // not do the job it appears to do.
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;
  await gotoHydrated(page, "/");

  const liveBefore = await page.evaluate(
    `Array.from(document.querySelectorAll("[aria-live], [role=status], [role=alert]")).map(n => n.getAttribute("aria-live") || n.getAttribute("role"))`,
  );
  await draftInput(page).fill(REWRITABLE_DRAFT);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/humanize"), { timeout: 30_000 }),
    submitButton(page).click(),
  ]);
  await resultHeading(page).waitFor({ timeout: 15_000 });

  const resultIsInsidePreexistingLiveRegion = await page.evaluate(
    `(() => { const r = document.querySelector("#result, section.result"); if (!r) return false;
       return !!(r.closest("[aria-live], [role=status]") && r.closest("[aria-live], [role=status]") !== r); })()`,
  );
  assert.ok(
    resultIsInsidePreexistingLiveRegion,
    `the result region is itself the live region and is inserted with its content, so the update is not reliably ` +
      `announced. Live regions present before the request: ${JSON.stringify(liveBefore)}`,
  );
});
