// M1 phase-exit gate (docs/QA.md): "Network/render/storage inspection proves
// the hidden result is not shipped."
//
// This is the highest-severity thing this suite can catch. If any part of the
// withheld rewrite is recoverable in the browser, the paywall is decorative,
// the anonymous preview leaks the paid product, and the release is blocked.
//
// The test does not settle for "the locked text isn't rendered". It computes
// the exact rewrite the server generated, isolates the part of it that was
// withheld, and then searches every surface the browser can reach for it:
// rendered text, serialized DOM, every same-origin response body (HTML, the
// RSC flight payload, every JS module, and the JSON API response),
// localStorage, sessionStorage, and cookies.
import assert from "node:assert/strict";
import test from "node:test";
import {
  clientVisibleSurface,
  closeBrowser,
  comparisonPanels,
  environmentBlocker,
  gotoHydrated,
  openSession,
  submitDraft,
  wordNgrams,
} from "./helpers/harness.mts";
import { REWRITABLE_DRAFT, fullRewriteOf, hiddenTailOf, withheldOnlyTokens } from "./helpers/fixtures.mts";

const blocker = await environmentBlocker();

test("the withheld remainder of the rewrite never reaches the browser", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());

  await gotoHydrated(session.page, "/");

  // Everything the browser already held before this visitor submitted
  // anything: page chrome, marketing copy, framework bundles, the RSC payload
  // of the empty workspace. A word present here cannot be evidence that the
  // withheld rewrite leaked, so it is subtracted from the probe set below.
  // This keeps the search over every received byte while making a hit mean
  // exactly one thing.
  const baseline = await clientVisibleSurface(session);

  const { status, body } = await submitDraft(session.page, REWRITABLE_DRAFT);
  assert.equal(status, 200, `preview request failed: ${JSON.stringify(body)}`);

  const preview = body.preview as string;
  const hiddenWordCount = body.hiddenWordCount as number;
  assert.equal(typeof preview, "string", "the fixture must produce a preview to have a remainder at all");
  assert.ok(hiddenWordCount > 0, `the fixture must withhold something; hiddenWordCount was ${hiddenWordCount}`);

  const fullRewrite = await fullRewriteOf(REWRITABLE_DRAFT);
  assert.ok(
    fullRewrite.startsWith(preview.trim().slice(0, 40)),
    "the locally computed rewrite diverged from the server's — the fixture or the engine config is out of sync, " +
      "so this test would be searching for the wrong string. Fix that before trusting a pass.",
  );

  const hiddenTail = hiddenTailOf(preview, fullRewrite);
  assert.ok(hiddenTail.length > 20, `expected a substantial withheld tail, got ${JSON.stringify(hiddenTail)}`);

  // Words the rewriter introduced past the preview boundary. Words the
  // visitor typed are legitimately on screen, so only these are evidence.
  const probes = withheldOnlyTokens(REWRITABLE_DRAFT, preview, fullRewrite).filter(
    (token) => !baseline.combined.includes(token),
  );
  assert.ok(
    probes.length >= 2,
    `the fixture must introduce new vocabulary in the withheld region for this test to mean anything; got ${JSON.stringify(probes)}`,
  );

  await session.page.waitForTimeout(500);
  const surface = await clientVisibleSurface(session);

  // Negative control. A passing leak test is only meaningful if the search it
  // performs can find anything at all, so prove the machinery works on text
  // that is *supposed* to be visible before trusting it about text that is
  // not. Without this, a broken locator or an empty surface would read as a
  // clean bill of health.
  const controlPhrase = wordNgrams(preview, 3).find((gram) => !REWRITABLE_DRAFT.includes(gram));
  assert.ok(controlPhrase, "the exposed preview must contain rewritten wording for the control to work");
  assert.ok(
    surface.innerText.replace(/\s+/g, " ").includes(controlPhrase),
    `control failed: exposed preview phrase ${JSON.stringify(controlPhrase)} was not found in the rendered page, ` +
      "so this test cannot detect a leak either. Fix the harness before reading the result below.",
  );

  assert.ok(
    !surface.combined.includes(hiddenTail),
    "CRITICAL: the complete withheld remainder was recoverable from the browser.",
  );

  // Sweep 1 — every byte the browser received, searched for any contiguous
  // three-word sequence from the withheld region. Broad surface, phrase-level
  // probe: a three-word run of a specific rewrite does not occur by accident
  // inside a framework bundle, so this stays strict without false alarms.
  //
  // N-grams that the rewriter left byte-identical to the visitor's own draft
  // are excluded: that text is the visitor's, it is legitimately on screen in
  // the Original panel, and finding it there proves nothing. What is withheld
  // — and what is being sold — is the rewritten wording, which is precisely
  // what remains after this filter.
  const normalizedOriginal = REWRITABLE_DRAFT.replace(/\s+/g, " ");
  const grams = wordNgrams(hiddenTail, 3).filter((gram) => !normalizedOriginal.includes(gram));
  assert.ok(
    grams.length >= 3,
    `the fixture must withhold rewritten wording, not just a verbatim tail; got ${grams.length} distinct phrases`,
  );
  for (const gram of grams) {
    assert.ok(
      !surface.combined.includes(gram),
      `CRITICAL: withheld rewrite phrase ${JSON.stringify(gram)} was recoverable from the browser.`,
    );
  }

  // Sweep 2 — single words the rewriter introduced, searched across every
  // surface that can carry this visitor's content: rendered text, the
  // serialized DOM and RSC flight payload, JSON API replies, storage, cookies.
  for (const probe of probes) {
    const where = [
      surface.innerText.includes(probe) && "rendered text",
      surface.html.includes(probe) && "serialized DOM / RSC payload",
      surface.responseBodies.includes(probe) && "an HTTP response body",
      surface.storage.includes(probe) && "local/session storage",
      surface.cookies.includes(probe) && "cookies",
    ].filter(Boolean);
    assert.deepEqual(
      where,
      [],
      `CRITICAL: withheld rewrite token ${JSON.stringify(probe)} was recoverable from ${where.join(", ")}.`,
    );
  }

  assert.deepEqual(session.pageErrors, [], "the journey produced uncaught page errors");
});

test("the API response itself carries no field holding the full rewrite", { skip: blocker ?? false }, async (t) => {
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());

  await gotoHydrated(session.page, "/");
  const { body } = await submitDraft(session.page, REWRITABLE_DRAFT);
  const fullRewrite = await fullRewriteOf(REWRITABLE_DRAFT);
  const hiddenTail = hiddenTailOf(body.preview as string, fullRewrite);

  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes(hiddenTail), "the preview response contained the withheld remainder");
  assert.ok(!serialized.includes(fullRewrite), "the preview response contained the complete rewrite");

  // Whatever fields exist, none of them may be a longer rewrite than the
  // preview. This keeps catching leaks after new fields are added.
  for (const [key, value] of Object.entries(body)) {
    if (key === "original" || typeof value !== "string") continue;
    assert.ok(
      !value.includes(hiddenTail),
      `field ${JSON.stringify(key)} of the preview response leaked the withheld remainder`,
    );
  }
});

test("change marking in the comparison is clipped to the exposed preview", { skip: blocker ?? false }, async (t) => {
  // docs/ACTIVATION.md ACT-04 / docs/MONETIZATION.md: "Diff metadata is
  // clipped to exposed regions so it cannot reconstruct hidden text." If the
  // comparison ever renders marks computed against the *full* rewrite, the
  // hidden text walks out through the diff.
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());

  await gotoHydrated(session.page, "/");
  const { body } = await submitDraft(session.page, REWRITABLE_DRAFT);
  const preview = (body.preview as string) ?? "";

  const panels = comparisonPanels(session.page);
  assert.equal(await panels.count(), 2, "expected an Original panel and a rewrite panel");

  const rewritePanelText = (await panels.nth(1).innerText()).replace(/\s+/g, " ").trim();
  const normalizedPreview = preview.replace(/\s+/g, " ").trim();
  const fullRewrite = await fullRewriteOf(REWRITABLE_DRAFT);
  const hiddenTail = hiddenTailOf(preview, fullRewrite);

  assert.ok(
    !rewritePanelText.includes(hiddenTail),
    "the rewrite panel rendered text from beyond the preview boundary",
  );

  // Every insertion mark must be text the visitor is already allowed to see.
  const insertions: string[] = await session.page.$$eval(".comparison ins", (nodes) =>
    nodes.map((node) => (node.textContent ?? "").trim()),
  );
  for (const insertion of insertions) {
    if (!insertion) continue;
    assert.ok(
      normalizedPreview.includes(insertion.replace(/\s+/g, " ").trim()),
      `an insertion mark carried text that is not in the exposed preview: ${JSON.stringify(insertion)}`,
    );
  }
});
