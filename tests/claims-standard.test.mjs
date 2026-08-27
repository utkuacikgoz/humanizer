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

test("the claims standard does not claim an approval it has not been given", () => {
  assert.match(
    claims,
    /^\*\*Status: DRAFT — awaiting Legal approval\./m,
    "docs/CLAIMS.md must open with its draft status: SEO-011's missing artefact is the approval, not the document",
  );
  assert.match(
    claims,
    /^\| Approved \| \*\*No\.\*\*/m,
    "docs/CLAIMS.md's approval table must record that it is not approved",
  );

  // The failure this is really guarding: a well-meaning edit that reads as a
  // sign-off. Section 0 and Section 3.2 both quote the forbidden phrasing to
  // rule it out, so matches are only counted outside those quotations.
  const prose = claims
    .replace(/Do not cite this document as a Legal sign-?off\./g, "")
    .replace(/^.*not an approval.*$/gm, "");
  assert.doesNotMatch(
    prose,
    /\b(approved by Legal|Legal has approved|Legal approval (?:is )?(?:complete|obtained|granted)|Legal sign-?off (?:is )?(?:complete|obtained|granted))\b/i,
    "docs/CLAIMS.md asserts a Legal approval; only Legal can record one, in Section 7",
  );
});
