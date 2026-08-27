// Keyboard-only traversal of the two signed-in surfaces: the sign-in form and
// the history list.
//
// The existing accessibility suite covers the anonymous workspace. These are
// the pages a customer who has paid actually lives on, and they carry the
// same repository-wide rule: no focusable control ever gets the native
// `disabled` attribute, because a control that becomes `disabled` while
// focused drops focus to <body> and strands a keyboard or screen-reader user
// mid-flow. `aria-disabled` plus a JavaScript re-entrancy guard is used
// instead (app/signin/page.tsx and app/history/page.tsx both say so), and
// that is only a correct choice if the guard actually holds — so it is tested
// rather than assumed.
//
// Every interaction below is Tab and Enter. Nothing is clicked.
//
// The reachability tests and the focus-indicator tests are deliberately
// separate. A page can be perfectly operable from the keyboard and still be
// unusable because nothing shows where the keyboard is, and folding both into
// one test means one defect hides the other's coverage. Two of the tests here
// are currently failing against real defects; see docs/QA.md's "Open
// accessibility defects".
import assert from "node:assert/strict";
import test from "node:test";
import { BASE_URL, closeBrowser, environmentBlocker, gotoReady, openSession } from "./helpers/harness.mts";
import { REWRITABLE_DRAFT } from "./helpers/fixtures.mts";
import {
  findAccount,
  grantEntitlement,
  identityBlocker,
  mintSignInLink,
  signInBrowser,
  ownedJobIds,
  purgeTestAccount,
  testEmail,
} from "./helpers/identity.mts";

const blocker = (await environmentBlocker()) ?? identityBlocker();

// Evaluated from a source string rather than a callback: the TypeScript
// loader this suite runs under rewrites named inner functions to reference an
// `__name` helper that does not exist in the page, so an evaluate callback
// with a named local throws ReferenceError inside the browser. Same reason as
// harness.mts's storage probe.
const ACTIVE_ELEMENT = `(() => {
  const a = document.activeElement;
  if (!a || a === document.body) return { tag: "BODY", selector: "", name: "", outline: "", shadow: "", visible: false, nativeDisabled: false, ariaDisabled: null };
  const s = getComputedStyle(a);
  const r = a.getBoundingClientRect();
  return {
    tag: a.tagName,
    selector: a.tagName.toLowerCase() + (a.className && typeof a.className === "string" ? "." + a.className.trim().split(/\\s+/).join(".") : ""),
    name: (a.getAttribute("aria-label") || a.getAttribute("placeholder") || a.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 60),
    outline: s.outlineStyle + " " + s.outlineWidth,
    shadow: s.boxShadow,
    visible: r.width > 0 && r.height > 0,
    nativeDisabled: a.hasAttribute("disabled"),
    ariaDisabled: a.getAttribute("aria-disabled"),
  };
})()`;

type Focused = {
  tag: string;
  selector: string;
  name: string;
  outline: string;
  shadow: string;
  visible: boolean;
  nativeDisabled: boolean;
  ariaDisabled: string | null;
};

type Keyboardable = {
  keyboard: { press(key: string): Promise<void>; type(text: string): Promise<void> };
  evaluate(source: string): Promise<unknown>;
};

function hasVisibleFocusRing(focused: Focused): boolean {
  const outlined = focused.outline !== "none 0px" && !focused.outline.startsWith("none");
  const shadowed = focused.shadow !== "none" && focused.shadow.length > 0;
  return outlined || shadowed;
}

function describe(focused: Focused): string {
  return `${focused.selector || focused.tag}${focused.name ? ` "${focused.name}"` : ""}`;
}

async function focusedNow(page: Keyboardable): Promise<Focused> {
  return (await page.evaluate(ACTIVE_ELEMENT)) as Focused;
}

/**
 * Tabs `limit` times and returns every distinct control focus landed on.
 *
 * Deliberately makes no assertions: the reachability tests and the
 * focus-indicator test both walk the same tab order and must be able to fail
 * independently of each other.
 */
async function collectTabStops(page: Keyboardable, limit = 24): Promise<Focused[]> {
  const stops: Focused[] = [];
  const seen = new Set<string>();
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press("Tab");
    const focused = await focusedNow(page);
    if (focused.tag === "BODY") continue; // the tab order passed through browser chrome
    const key = describe(focused);
    if (seen.has(key)) continue; // the order has wrapped
    seen.add(key);
    stops.push(focused);
  }
  return stops;
}

/** Tabs until `matches` is true, leaving focus on that control. Asserts nothing about how it looks. */
async function tabTo(
  page: Keyboardable,
  matches: (focused: Focused) => boolean,
  what: string,
  limit = 40,
): Promise<Focused> {
  const visited: string[] = [];
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press("Tab");
    const focused = await focusedNow(page);
    if (focused.tag === "BODY") continue;
    visited.push(describe(focused));
    assert.equal(focused.nativeDisabled, false, `the native disabled attribute is on a focusable control: ${describe(focused)}`);
    assert.ok(focused.visible, `focus landed on a zero-size element: ${describe(focused)}`);
    if (matches(focused)) return focused;
  }
  throw new assert.AssertionError({
    message: `${what} was never reached by Tab in ${limit} steps. Stops visited: ${visited.join(" -> ")}`,
  });
}

/** Signs a browser in and gives it one history item to traverse. Returns the job id. */
async function seedSignedInHistory(session: Awaited<ReturnType<typeof openSession>>, email: string): Promise<{ jobId: string; userId: string }> {
  const { page, context } = session;
  const link = await mintSignInLink(BASE_URL, email, "/");
  await signInBrowser(page, link);
  const account = findAccount(email);
  assert.ok(account, "sign-in did not create an account");
  grantEntitlement(account.userId);

  // Produced through the API rather than the workspace UI: these tests are
  // about the history list's keyboard behaviour, and the anonymous
  // workspace's is already covered by tests/e2e/accessibility.e2e.test.mts.
  const rewrite = await context.request.post(`${BASE_URL}/api/humanize`, {
    headers: { "content-type": "application/json", "x-idempotency-key": crypto.randomUUID() },
    data: { text: REWRITABLE_DRAFT, mode: "natural" },
  });
  assert.equal(rewrite.status(), 200, `seeding a history item answered ${rewrite.status()}`);
  const jobIds = ownedJobIds(account.userId);
  assert.equal(jobIds.length, 1, `expected one history item to traverse, found ${jobIds.length}`);
  return { jobId: jobIds[0], userId: account.userId };
}

// ---------------------------------------------------------------------------
// Reachability and operability
// ---------------------------------------------------------------------------

test("the sign-in form can be completed with the keyboard alone", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const email = testEmail("a11y-signin");
  t.after(() => purgeTestAccount(email));

  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;
  await gotoReady(page, "/signin?return_to=%2Fhistory");

  await tabTo(page, (focused) => focused.tag === "INPUT", "the email field");
  assert.ok(
    await page.locator("label[for=signin-email]").first().isVisible(),
    "the email field has no visible <label> pointing at it",
  );

  // Typed, not filled: `fill` sets the value directly and would not prove the
  // field is reachable and editable from the keyboard.
  await page.keyboard.type(email);
  assert.equal(await page.locator("#signin-email").inputValue(), email, "typing into the focused field did not reach it");

  const submit = await tabTo(page, (focused) => focused.tag === "BUTTON", "the submit control");
  assert.equal(submit.nativeDisabled, false, "the submit control uses the native disabled attribute");

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/auth/request-link"), { timeout: 30_000 }),
    page.keyboard.press("Enter"),
  ]);
  assert.ok(
    response.status() === 200 || response.status() === 503,
    `submitting the form from the keyboard answered ${response.status()}`,
  );

  // The re-entrancy guard is a ref, not a `disabled` attribute, so focus must
  // still be on the control the customer pressed.
  const afterSubmit = await focusedNow(page);
  assert.notEqual(afterSubmit.tag, "BODY", "keyboard focus was stranded on <body> by submitting the sign-in form");
  assert.equal(afterSubmit.nativeDisabled, false, "the submit control became natively disabled, dropping keyboard focus");

  // The outcome is announced in a live region rather than only by a visual
  // change, so a screen-reader user learns what happened.
  const live = page.locator("[role=status], [role=alert]").filter({ hasText: /\S/ }).first();
  await live.waitFor({ timeout: 30_000 });
  assert.match((await live.innerText()).trim(), /\S/, "the sign-in result was not announced in a live region");

  assert.deepEqual(session.pageErrors, [], `the sign-in page raised page errors: ${session.pageErrors.join(" | ")}`);
});

test("the history list can be traversed, opened and deleted with the keyboard alone", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const email = testEmail("a11y-history");
  t.after(() => purgeTestAccount(email));

  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;
  const { jobId } = await seedSignedInHistory(session, email);

  await gotoReady(page, "/history");
  await page.locator(".history-list .history-item").first().waitFor({ timeout: 30_000 });

  // Open it, by Tab and Enter.
  const openControl = await tabTo(page, (focused) => /open full rewrite/i.test(focused.name), "the open control");
  assert.equal(openControl.nativeDisabled, false, "the open control uses the native disabled attribute");
  const [detailResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes(`/api/history/${jobId}`), { timeout: 30_000 }),
    page.keyboard.press("Enter"),
  ]);
  assert.equal(detailResponse.status(), 200, "opening an owned rewrite from the keyboard was refused");
  await page.locator(".history-detail").first().waitFor({ timeout: 30_000 });

  const afterOpen = await focusedNow(page);
  assert.notEqual(afterOpen.tag, "BODY", "opening a history item stranded keyboard focus on <body>");
  assert.equal(afterOpen.ariaDisabled, null, "the open control advertises itself as disabled after opening");

  // Delete it, by Tab and Enter, through the confirmation step.
  await tabTo(page, (focused) => /^delete$/i.test(focused.name), "the delete control");
  await page.keyboard.press("Enter");
  await page.locator(".history-confirm").first().waitFor({ timeout: 30_000 });

  // The confirmation must be announced, not merely drawn.
  assert.equal(
    await page.locator(".history-confirm").first().getAttribute("role"),
    "status",
    "the destructive-action warning is not in a live region, so a screen-reader user is not told it appeared",
  );

  const confirm = await tabTo(page, (focused) => /delete permanently/i.test(focused.name), "the delete confirmation");
  assert.equal(confirm.nativeDisabled, false, "the delete confirmation uses the native disabled attribute");
  const [deleteResponse] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/api/history/${jobId}`) && r.request().method() === "DELETE",
      { timeout: 30_000 },
    ),
    page.keyboard.press("Enter"),
  ]);
  assert.equal(deleteResponse.status(), 200, "deleting from the keyboard was refused");

  await page.waitForFunction(() => document.querySelectorAll(".history-list .history-item").length === 0, null, { timeout: 30_000 });
  const notice = page.locator(".surface-notice").filter({ hasText: /deleted/i }).first();
  await notice.waitFor({ timeout: 30_000 });
  assert.equal(
    await notice.getAttribute("aria-live"),
    "polite",
    "the deletion outcome is not announced politely, so a keyboard user gets no confirmation",
  );

  assert.deepEqual(session.pageErrors, [], `the history page raised page errors: ${session.pageErrors.join(" | ")}`);
});

// ---------------------------------------------------------------------------
// Visible focus
// ---------------------------------------------------------------------------

test("every keyboard stop on the sign-in page shows where the keyboard is", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;
  await gotoReady(page, "/signin?return_to=%2Fhistory");

  const stops = await collectTabStops(page);
  assert.ok(stops.length >= 4, `expected the sign-in page to have a real tab order, reached ${stops.length} stops`);

  const unmarked = stops.filter((stop) => !hasVisibleFocusRing(stop));
  assert.deepEqual(
    unmarked.map(describe),
    [],
    "controls take keyboard focus with no visible indicator (WCAG 2.4.7): "
      + unmarked.map((stop) => `${describe(stop)} [outline=${stop.outline}, boxShadow=${stop.shadow}]`).join("; "),
  );
});

test("every keyboard stop on the history page shows where the keyboard is", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const email = testEmail("a11y-focus-history");
  t.after(() => purgeTestAccount(email));

  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;
  await seedSignedInHistory(session, email);

  await gotoReady(page, "/history");
  await page.locator(".history-list .history-item").first().waitFor({ timeout: 30_000 });

  const stops = await collectTabStops(page);
  assert.ok(stops.length >= 3, `expected the history page to have a real tab order, reached ${stops.length} stops`);

  const unmarked = stops.filter((stop) => !hasVisibleFocusRing(stop));
  assert.deepEqual(
    unmarked.map(describe),
    [],
    "controls take keyboard focus with no visible indicator (WCAG 2.4.7): "
      + unmarked.map((stop) => `${describe(stop)} [outline=${stop.outline}, boxShadow=${stop.shadow}]`).join("; "),
  );
});

// ---------------------------------------------------------------------------
// Focus continuity across a destructive action
// ---------------------------------------------------------------------------

test("deleting the last history item does not strand keyboard focus", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const email = testEmail("a11y-focus-delete");
  t.after(() => purgeTestAccount(email));

  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;
  const { jobId } = await seedSignedInHistory(session, email);

  await gotoReady(page, "/history");
  await page.locator(".history-list .history-item").first().waitFor({ timeout: 30_000 });

  await tabTo(page, (focused) => /^delete$/i.test(focused.name), "the delete control");
  await page.keyboard.press("Enter");
  await page.locator(".history-confirm").first().waitFor({ timeout: 30_000 });
  await tabTo(page, (focused) => /delete permanently/i.test(focused.name), "the delete confirmation");
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/api/history/${jobId}`) && r.request().method() === "DELETE",
      { timeout: 30_000 },
    ),
    page.keyboard.press("Enter"),
  ]);
  await page.waitForFunction(() => document.querySelectorAll(".history-list .history-item").length === 0, null, { timeout: 30_000 });
  await page.locator(".surface-notice").filter({ hasText: /deleted/i }).first().waitFor({ timeout: 30_000 });

  // The control the customer pressed has just been unmounted along with the
  // row it lived in. Something has to catch the focus it was holding — the
  // list heading, the empty-state message, the workspace — or the next Tab
  // restarts from the top of the document and the customer has to hunt for
  // their place again. This is the same failure the repository already
  // refuses to accept from `disabled` (see the header of this file); the
  // route into it is different, the outcome for the customer is not.
  const afterDelete = await focusedNow(page);
  assert.notEqual(
    afterDelete.tag,
    "BODY",
    "deleting the last history item dropped keyboard focus to <body>, with nothing to continue from",
  );
});
