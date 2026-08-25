import assert from "node:assert/strict";
import test from "node:test";

import { createHumanizationPipeline } from "../src/lib/humanization/index";

const pipeline = createHumanizationPipeline();
const rewrite = async (text: string) => (await pipeline.humanize({ text, mode: "natural" })).text;

// Every case below is output the engine actually shipped, in the same class
// as the "...robust frameworks To facilitate..." defect: wrong in a way an
// ordinary reader notices immediately.

test('"In addition to" keeps its preposition', async () => {
  // The deletion rule matched the preposition as well as the sentence
  // adverbial, so the head of the phrase vanished and the customer got
  // "To the survey, we interviewed 12 residents."
  const result = await rewrite("In addition to the survey, we interviewed 12 residents. Furthermore, the panel met twice.");
  assert.match(result, /^In addition to the survey, we interviewed 12 residents\./);
  assert.doesNotMatch(result, /^To the survey/);
});

test('"In addition," as a sentence adverbial is still removed', async () => {
  const result = await rewrite("The panel met twice. In addition, the team interviewed 12 residents about the market.");
  assert.doesNotMatch(result, /In addition,/);
  assert.match(result, /The team interviewed 12 residents/);
});

test('"moving forward" as a gerund subject is left alone', async () => {
  // Substituting the adverbial here produced "from here, is not always possible".
  const result = await rewrite("In order to be clear: moving forward is not always possible. Furthermore, we must decide.");
  assert.match(result, /moving forward is not always possible/);
  assert.doesNotMatch(result, /from here, is/i);
});

test('"Moving forward," as a sentence adverbial is still replaced', async () => {
  const result = await rewrite("Moving forward, procurement will require weekly status notes from every vendor on the list.");
  assert.match(result, /^From here, procurement will require/);
});

test("the noun \"leverage\" is not turned into \"use\"", async () => {
  // "The team gained leverage in the negotiation" shipped as "gained use".
  const result = await rewrite("The team gained leverage in the negotiation. Furthermore, they utilize that position well.");
  assert.match(result, /gained leverage in the negotiation/);
  assert.doesNotMatch(result, /gained use/);
  // The verb in the same passage is still rewritten.
  assert.match(result, /they use that position/);
});

test("the verb \"leverage\" is still rewritten in its ordinary filler shapes", async () => {
  for (const [text, expected] of [
    ["Furthermore, organizations can leverage the existing workflow to reach every team in the company.", /can use the existing workflow/],
    ["Furthermore, the operations team will leverage our current process across the whole organization.", /will use our current process/],
    ["Furthermore, join the 12,000 creators who leverage BrightDesk every single day of the working week.", /who use BrightDesk/],
  ] as const) {
    assert.match(await rewrite(text), expected);
  }
});

test("an abbreviation mid-sentence does not get capitalized as a sentence start", async () => {
  // Capitalization used to fire after any stop followed by whitespace, so
  // the engine shipped "e.g. Spreadsheets" and "i.e. Only".
  const eg = await rewrite("Moreover, teams use lightweight tools, e.g. spreadsheets, to track work across the organization.");
  assert.match(eg, /e\.g\. spreadsheets/);
  assert.doesNotMatch(eg, /e\.g\. Spreadsheets/);

  const ie = await rewrite("Furthermore, the study shows a link. It is important to note that the sample was small, i.e. only 12 subjects.");
  assert.match(ie, /i\.e\. only 12 subjects/);
  assert.doesNotMatch(ie, /i\.e\. Only/);
});

test("a word that spells itself with an internal capital is not re-capitalized", async () => {
  // Deleting a lead-in promotes the next word to the front of the sentence.
  // Upper-casing it blindly produced "EBay", "PH" and "IPhone".
  for (const [text, expected, wrong] of [
    ["The board met on Tuesday. It is important to note that eBay listings recovered within two days of the cutover.", /eBay listings/, /EBay/],
    ["The lab ran the assay twice. It should be noted that pH readings stayed within the expected range all week.", /pH readings/, /PH readings/],
    ["The launch went well. It is worth mentioning that iPhone sales rose sharply last quarter across the region.", /iPhone sales/, /IPhone/],
  ] as const) {
    const result = await rewrite(text);
    assert.match(result, expected);
    assert.doesNotMatch(result, wrong);
  }
});

test("an ordinary lower-case word promoted to a sentence start is still capitalized", async () => {
  // The guard above must not become a licence to leave sentences uncapitalized.
  const result = await rewrite("The board met on Tuesday. It is important to note that revenue recovered within two days of the cutover.");
  assert.match(result, /\. Revenue recovered/);
});

test("already-natural prose is returned unchanged", async () => {
  // The engine is penalized for unnecessary rewriting: when there is nothing
  // to fix, the right answer is to change nothing at all.
  const text = "The rain stopped just after lunch. We walked down to the harbour and watched the boats come in.";
  assert.equal(await rewrite(text), text);
});
