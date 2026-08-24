// M1 gate (docs/QA.md) and ACT-03 (docs/ACTIVATION.md, launch blocker).
//
// ACT-03 exists because a single CSS rule used to delete the Original panel
// below 760px, removing the side-by-side comparison — the product's stated
// activation moment — for every phone visitor. This asserts the structural
// property rather than the fix: at every supported width both panels are
// present, laid out without overlapping, and the page does not scroll
// sideways.
import assert from "node:assert/strict";
import test from "node:test";
import {
  billingEntryPoint,
  closeBrowser,
  comparisonPanels,
  environmentBlocker,
  gotoHydrated,
  openSession,
  resultHeading,
  submitDraft,
  unlockButton,
} from "./helpers/harness.mts";
import { REWRITABLE_DRAFT } from "./helpers/fixtures.mts";

const blocker = await environmentBlocker();

const WIDTHS = [360, 375, 768, 1440];

for (const width of WIDTHS) {
  test(`the result is readable and complete at ${width}px`, { skip: blocker ?? false }, async (t) => {
    t.after(closeBrowser);
    const session = await openSession({ viewport: { width, height: 800 } });
    t.after(() => session.close());
    const { page } = session;

    await gotoHydrated(page, "/");
    const { status } = await submitDraft(page, REWRITABLE_DRAFT);
    assert.equal(status, 200);
    await resultHeading(page).waitFor({ timeout: 15_000 });
    await page.waitForTimeout(300);

    // Both comparison panels exist and are actually rendered.
    const panels = comparisonPanels(page);
    assert.equal(await panels.count(), 2, `only ${await panels.count()} comparison panel(s) at ${width}px`);
    for (let index = 0; index < 2; index += 1) {
      const box = await panels.nth(index).boundingBox();
      assert.ok(box && box.width > 0 && box.height > 0, `comparison panel ${index} has no area at ${width}px`);
      assert.ok(await panels.nth(index).isVisible(), `comparison panel ${index} is not visible at ${width}px`);
    }

    // Below the stacking breakpoint they stack; above it they sit side by side.
    const [source, rewrite] = await Promise.all([panels.nth(0).boundingBox(), panels.nth(1).boundingBox()]);
    assert.ok(source && rewrite);
    if (width < 860) {
      assert.ok(
        rewrite.y >= source.y + source.height - 2,
        `panels overlap instead of stacking at ${width}px: source ${JSON.stringify(source)} rewrite ${JSON.stringify(rewrite)}`,
      );
    } else {
      assert.ok(rewrite.x > source.x, `panels are not side by side at ${width}px`);
    }

    // No sideways scrolling, at any width.
    const overflow = (await page.evaluate(
      `[document.documentElement.scrollWidth, document.documentElement.clientWidth]`,
    )) as [number, number];
    assert.ok(
      overflow[0] <= overflow[1] + 1,
      `the page scrolls horizontally at ${width}px (scrollWidth ${overflow[0]} vs clientWidth ${overflow[1]})`,
    );

    // Nothing that must be reachable is clipped off the right edge.
    for (const [name, locator] of [
      ["purchase control", unlockButton(page)],
      ["billing entry point", billingEntryPoint(page).locator("button").first()],
    ] as const) {
      if ((await locator.count()) === 0) continue;
      const box = await locator.boundingBox();
      assert.ok(box, `${name} has no box at ${width}px`);
      assert.ok(box.x >= -1, `${name} is clipped off the left edge at ${width}px (x=${box.x})`);
      assert.ok(
        box.x + box.width <= overflow[1] + 1,
        `${name} is clipped off the right edge at ${width}px (right=${box.x + box.width}, viewport=${overflow[1]})`,
      );
    }

    assert.deepEqual(session.pageErrors, [], `uncaught page errors at ${width}px`);
  });
}
