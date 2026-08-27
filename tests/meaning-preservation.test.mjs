import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// SEO-019. docs/MEANING-PRESERVATION.md is the meaning-preservation checklist:
// the classes of content a rewrite can quietly destroy, what the product does
// about each, and what a person still has to check.
//
// Its acceptance criterion is that it covers ALL protected claim classes. That
// is the one clause a build can hold, and it is the clause most likely to rot:
// the classes live in a TypeScript union and in an extractor's rule table, and
// both get extended. A class added to the code and not to the checklist leaves
// a document that reads complete and is not, which is worse than an obviously
// partial one - a reader who trusted it would skip a check nobody told them to
// make.
//
// So this compares the document against the code in both directions. The
// document is not held to the code's wording, only to naming every class.

const doc = await readFile(new URL("../docs/MEANING-PRESERVATION.md", import.meta.url), "utf8");
const types = await readFile(new URL("../src/lib/humanization/types.ts", import.meta.url), "utf8");
const extractor = await readFile(new URL("../src/lib/humanization/protected-content.ts", import.meta.url), "utf8");

/** The declared union in src/lib/humanization/types.ts. */
function declaredClasses() {
  const block = types.match(/export type ProtectedContentKind =([\s\S]*?);/);
  assert.ok(block, "src/lib/humanization/types.ts no longer declares ProtectedContentKind");
  return new Set([...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]));
}

/** The classes the checklist documents, from its marked section. */
function documentedClasses() {
  const block = doc.match(/<!-- protected-classes:start -->([\s\S]*?)<!-- protected-classes:end -->/);
  assert.ok(block, "docs/MEANING-PRESERVATION.md no longer marks its protected-class section");
  return new Set([...block[1].matchAll(/^### `([^`]+)`$/gm)].map((match) => match[1]));
}

test("the checklist covers every protected content class the code defines", () => {
  const declared = declaredClasses();
  const documented = documentedClasses();

  assert.ok(declared.size >= 13, `only ${declared.size} protected classes were read from the type union`);

  for (const kind of declared) {
    assert.ok(
      documented.has(kind),
      `src/lib/humanization/types.ts protects "${kind}" and docs/MEANING-PRESERVATION.md does not cover it: ` +
        "a checklist that reads complete and is not sends a reader past a check nobody told them to make",
    );
  }
  for (const kind of documented) {
    assert.ok(
      declared.has(kind),
      `docs/MEANING-PRESERVATION.md documents "${kind}" as protected and no such class exists in the code`,
    );
  }
});

// The extractor is where a class is actually implemented. A kind in the union
// with no rule behind it is protected in name only, and the checklist would
// describe a protection the pipeline never applies.
test("every documented class has a rule behind it in the extractor", () => {
  const implemented = new Set(
    [...extractor.matchAll(/\bkind:\s*"([^"]+)"/g)].map((match) => match[1]),
  );
  for (const kind of documentedClasses()) {
    assert.ok(
      implemented.has(kind),
      `docs/MEANING-PRESERVATION.md documents "${kind}" and src/lib/humanization/protected-content.ts has no rule for it`,
    );
  }
});

// The checklist's method note quotes the verifier's thresholds and its issue
// vocabulary. Quoted numbers drift silently, and a method note that misstates
// the pass rule is a claim about the product that is not true.
test("the method note quotes the verifier's real thresholds and issue kinds", async () => {
  const verification = await readFile(
    new URL("../src/lib/humanization/verification.ts", import.meta.url),
    "utf8",
  );

  const issueKinds = types.match(/export type VerificationIssueKind =([\s\S]*?);/);
  assert.ok(issueKinds, "src/lib/humanization/types.ts no longer declares VerificationIssueKind");
  for (const [, kind] of issueKinds[1].matchAll(/"([^"]+)"/g)) {
    assert.ok(
      doc.includes(`\`${kind}\``),
      `the verifier can report "${kind}" and the method note does not mention it`,
    );
  }

  for (const threshold of ["0.72", "0.45", "0.23", "0.05"]) {
    assert.ok(
      verification.includes(threshold),
      `docs/MEANING-PRESERVATION.md quotes ${threshold} as a verifier constant and verification.ts no longer contains it`,
    );
    assert.ok(doc.includes(threshold), `the method note no longer quotes the verifier constant ${threshold}`);
  }

  assert.ok(
    doc.includes("deterministic-semantic-v1") && verification.includes("deterministic-semantic-v1"),
    "the method note and the verifier disagree about the provider name",
  );
});
