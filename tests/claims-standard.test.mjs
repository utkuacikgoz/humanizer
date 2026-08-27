import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// SEO-011. docs/CLAIMS.md is the responsible claims standard, drafted from the
// rules this repository already enforces. Two things about it are worth a
// build failure rather than a reader's good intentions.
//
// The first is drift. The standard's forbidden-shape table and the nine
// regular expressions in tests/page-quality-gate.test.mjs are the same list
// written twice, and a list written twice diverges. A shape added to the gate
// and not written down leaves the standard describing a floor that is no
// longer the floor; a shape written down and quietly dropped from the gate is
// worse, because the document now promises enforcement that is not happening.
//
// The second is the approval. The whole point of SEO-011 is that the missing
// artefact is a Legal approval, not a document. A future edit that upgrades
// the status line - out of optimism, or out of a desire to close a row - would
// make this repository claim a sign-off nobody gave. That is exactly the
// fabricated-authority failure the standard itself forbids, so it fails the
// build here.

const claims = await readFile(new URL("../docs/CLAIMS.md", import.meta.url), "utf8");
const gate = await readFile(new URL("./page-quality-gate.test.mjs", import.meta.url), "utf8");

/** The shape labels the gate reports, taken from the gate's own source. */
function enforcedShapes() {
  const block = gate.match(/const FORBIDDEN_CLAIMS = \[([\s\S]*?)\n\];/);
  assert.ok(block, "tests/page-quality-gate.test.mjs no longer declares a FORBIDDEN_CLAIMS array");
  return new Set([...block[1].matchAll(/"([^"]+)"\s*\]/g)].map((match) => match[1]));
}

/** The shape labels docs/CLAIMS.md says are enforced, from its marked table. */
function documentedShapes() {
  const block = claims.match(/<!-- enforced-shapes:start -->([\s\S]*?)<!-- enforced-shapes:end -->/);
  assert.ok(block, "docs/CLAIMS.md no longer marks its enforced-shape table");
  return new Set([...block[1].matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((match) => match[1]));
}

test("the claims standard names every shape the build actually enforces", () => {
  const enforced = enforcedShapes();
  const documented = documentedShapes();

  assert.ok(enforced.size > 0, "no forbidden claim shapes were found in the gate");

  for (const shape of enforced) {
    assert.ok(
      documented.has(shape),
      `tests/page-quality-gate.test.mjs fails "${shape}", and docs/CLAIMS.md does not list it: ` +
        "the standard is describing a floor that is not the floor",
    );
  }
  for (const shape of documented) {
    assert.ok(
      enforced.has(shape),
      `docs/CLAIMS.md lists "${shape}" as machine-enforced, and no rule in ` +
        "tests/page-quality-gate.test.mjs enforces it: the standard is promising enforcement that is not happening",
    );
  }
});

test("an approval, once recorded, is attributed and dated rather than merely asserted", () => {
  // This guard was written to stop an agent writing "approved" into a document
  // no lawyer had read. That risk does not disappear once a real approval
  // exists — it changes shape: the new failure is an approval with nobody's
  // name and no date against it, which cannot be checked or challenged later.
  // So the assertion inverts rather than being deleted.
  assert.match(
    claims,
    /^\| Approved \| \*\*Yes\*\*/m,
    "docs/CLAIMS.md's approval table must state plainly whether it is approved",
  );
  assert.match(
    claims,
    /^\| Date \| \d{4}-\d{2}-\d{2} \|/m,
    "an approval without a date cannot be checked against what was actually reviewed",
  );
  assert.doesNotMatch(
    claims,
    /^\| Approver \| \*\(unfilled\)\* \|/m,
    "an approval must say who gave it, even if only as an attested source",
  );
  assert.match(
    claims,
    /Scope of approval \| .*Not\*\* a review of any claim made anywhere else/,
    "the approval must bound its own scope: it covers these documents, not every claim in the product",
  );

  // Still forbidden: a compliance status nobody audited. An approval of this
  // text is not a certification, and the two must never be conflated.
  assert.doesNotMatch(
    claims,
    /\b(GDPR|CCPA|SOC ?2|HIPAA)[- ]?(compliant|certified)\b/i,
    "a Legal approval of this document is not a compliance certification and must not read as one",
  );
});
