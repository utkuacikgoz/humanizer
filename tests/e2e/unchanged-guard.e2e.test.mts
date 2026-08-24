// ACT-01 (docs/ACTIVATION.md, launch blocker): never paywall a rewrite that
// did not rewrite anything.
//
// The failure this guards against is not cosmetic. Before the guard, ordinary
// prose that the deterministic engine leaves untouched was projected into a
// truncated "preview", labelled with an improvement count, covered with a
// lock, and sold for a recurring $9.99 — the visitor paying to unlock words
// they wrote themselves. docs/MONETIZATION.md's dark-pattern list makes that
// a release blocker, so the browser-level proof lives here.
import assert from "node:assert/strict";
import test from "node:test";
import {
  closeBrowser,
  draftInput,
  environmentBlocker,
  gotoHydrated,
  openSession,
  resultHeading,
  resultRegion,
  submitDraft,
  unlockButton,
} from "./helpers/harness.mts";
import { ALREADY_NATURAL_DRAFT, COSMETIC_ONLY_DRAFT } from "./helpers/fixtures.mts";

const blocker = await environmentBlocker();

test("prose the engine leaves alone is never priced, locked, or counted", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;

  await gotoHydrated(page, "/");
  const { status, body } = await submitDraft(page, ALREADY_NATURAL_DRAFT);
  assert.equal(status, 200, `request failed: ${JSON.stringify(body)}`);

  // The server's terminal shape: the draft back, a flag, and nothing sellable.
  assert.equal(body.unchanged, true, "the server must flag a materially unchanged rewrite");
  assert.equal(body.preview, undefined, "an unchanged result must carry no truncated preview");
  assert.equal(body.hiddenWordCount, undefined, "an unchanged result must carry no hidden-word count");
  assert.equal(body.capability, undefined, "an unchanged result must mint no unlock capability");
  assert.equal(body.issuesImproved, undefined, "an unchanged result must carry no improvement count");

  await resultHeading(page).waitFor({ timeout: 15_000 });
  const region = resultRegion(page);
  const regionText = (await region.innerText()).replace(/\s+/g, " ");

  // Nothing on screen may offer, imply, or price a purchase.
  assert.equal(await unlockButton(page).count(), 0, "an unchanged result rendered a purchase control");
  assert.equal(await page.locator(".locked-copy").count(), 0, "an unchanged result rendered a lock overlay");
  assert.ok(!/\$\s*\d/.test(regionText), `an unchanged result showed a price: ${JSON.stringify(regionText)}`);
  assert.ok(
    !/\bimprovements?\b/i.test(regionText),
    `an unchanged result showed an improvement count: ${JSON.stringify(regionText)}`,
  );

  // The terminal state must not cost the visitor their work: the draft stays
  // in the editor, so they can switch mode or keep editing rather than
  // starting over.
  assert.equal(
    await draftInput(page).inputValue(),
    ALREADY_NATURAL_DRAFT,
    "the unchanged terminal state discarded the visitor's draft",
  );
  // The server echoed the draft back untouched, byte for byte.
  assert.equal(body.original, ALREADY_NATURAL_DRAFT, "the server altered a draft it reported as unchanged");
  assert.deepEqual(session.pageErrors, []);
});

test("a purchase control is only ever rendered when something is actually withheld", { skip: blocker ?? false }, async (t) => {
  // The invariant, stated once and checked against whatever the engine does:
  // the unlock CTA exists if and only if hiddenWordCount > 0. This is the
  // assertion that keeps catching ACT-01 regressions on inputs nobody thought
  // to write a fixture for.
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;
  await gotoHydrated(page, "/");

  for (const draft of [ALREADY_NATURAL_DRAFT, COSMETIC_ONLY_DRAFT]) {
    const { body } = await submitDraft(page, draft);
    await resultHeading(page).waitFor({ timeout: 15_000 });
    const withheld = typeof body.hiddenWordCount === "number" ? body.hiddenWordCount : 0;
    const controls = await unlockButton(page).count();
    assert.equal(
      controls > 0,
      withheld > 0,
      `paywall/withholding mismatch for ${JSON.stringify(draft.slice(0, 48))}…: ` +
        `hiddenWordCount=${withheld} but ${controls} purchase control(s) rendered`,
    );
  }
});

test("a rewrite whose only edit is cosmetic is not sold as a rewrite", { skip: blocker ?? false }, async (t) => {
  // KNOWN FAILURE, reported by MQA: the unchanged guard compares normalized
  // strings, and normalization folds whitespace runs but not whitespace
  // *before punctuation*. A draft flagged only by the `excessive-qualifier`
  // marker matches no entry in the substitution table, so the single edit the
  // engine makes is the post-processing rule that deletes the space in " ,".
  // That is enough to clear the guard: the visitor is shown a truncated
  // preview, a lock, and a recurring charge in exchange for one deleted space,
  // with `issuesImproved: 0` so the Changes tile is correctly suppressed —
  // leaving a paywall that states no improvement at all.
  //
  // This test asserts the honest behaviour. It fails today. Do not relax it.
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;

  await gotoHydrated(page, "/");
  const { body } = await submitDraft(page, COSMETIC_ONLY_DRAFT);
  await resultHeading(page).waitFor({ timeout: 15_000 });

  const improved = typeof body.issuesImproved === "number" ? body.issuesImproved : 0;
  const withheld = typeof body.hiddenWordCount === "number" ? body.hiddenWordCount : 0;
  const sold = (await unlockButton(page).count()) > 0;

  assert.ok(
    !(sold && improved === 0),
    `a purchase control was rendered for a rewrite the engine measured as zero improvements ` +
      `(hiddenWordCount=${withheld}, issuesImproved=${improved}). ` +
      `Preview shown: ${JSON.stringify(body.preview)}`,
  );
});
