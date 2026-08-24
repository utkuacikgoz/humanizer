// Journey 2/3 fragments from docs/QA.md: checkout cancel return.
// Refresh cannot restore a preview from browser storage (D-004 forbids
// putting writing there); cancel returns to a usable empty workspace.
import assert from "node:assert/strict";
import test from "node:test";
import {
  closeBrowser,
  draftInput,
  environmentBlocker,
  gotoHydrated,
  openSession,
} from "./helpers/harness.mts";

const blocker = await environmentBlocker();

test("canceled checkout returns to an honest workspace, not a dead paywall", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;

  await gotoHydrated(page, "/?checkout=canceled");
  const notice = page.getByRole("status").filter({ hasText: /canceled/i });
  await notice.waitFor({ timeout: 15_000 });
  assert.ok(await draftInput(page).isVisible(), "the editor must still be usable after cancel");
  assert.match(await notice.innerText(), /nothing was charged/i);
  assert.deepEqual(session.pageErrors, []);
});
