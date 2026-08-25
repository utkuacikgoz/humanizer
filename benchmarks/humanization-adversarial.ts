import type { AdversarialPassage } from "../src/lib/humanization/benchmark";

/**
 * Hard cases: text the engine is expected to handle badly, plus text where
 * the correct answer is to change nothing.
 *
 * This is the adversarial set docs/BENCHMARKS.md's change protocol asks for
 * ("a development set ..., a frozen release set, and a small hidden
 * holdout/adversarial set to detect overfitting"). It is deliberately kept
 * out of HUMANIZATION_BENCHMARK_PASSAGES so the 100-passage release set stays
 * frozen and comparable across runs.
 *
 * Expectations describe what a CORRECT humanizer must do, not what the
 * current deterministic engine happens to do. Several of these fail today.
 * That is the point: a suite nothing fails measures nothing. Do not relax an
 * expectation to turn a run green — fix the engine, or record the failure as
 * a known limitation with a reason.
 *
 * No customer writing. Every passage is purpose-written for this repository.
 */
export const HUMANIZATION_ADVERSARIAL_PASSAGES: AdversarialPassage[] = [
  {
    id: "adv-quote-01",
    category: "nested quotation",
    mode: "professional",
    note: "A quotation is a verbatim record. Filler inside it belongs to the speaker, not the engine.",
    text: 'Furthermore, the chair reported that the memo said "we must, in order to comply, utilize the new form" before the vote.',
    expectedProtectedFacts: [],
    expectation: {
      outcome: "rewrite",
      mustPreserve: ['"we must, in order to comply, utilize the new form"'],
    },
  },
  {
    id: "adv-quote-02",
    category: "nested quotation",
    mode: "professional",
    note: "Single quotes nested inside double quotes; the inner span is still a quotation.",
    text: 'It is important to note that she wrote: "The report called it \'a robust solution\' and moved on." That framing stuck.',
    expectedProtectedFacts: [],
    expectation: {
      outcome: "rewrite",
      mustPreserve: ["'a robust solution'"],
    },
  },
  {
    id: "adv-quote-03",
    category: "nested quotation",
    mode: "natural",
    note: "A stop inside a quotation ends the quoted sentence, not necessarily the outer one.",
    text: 'Furthermore, she said "Stop." Then she left the room without saying anything else at all.',
    expectedProtectedFacts: [],
    expectation: {
      outcome: "rewrite",
      mustPreserve: ['"Stop."', "Then she left"],
      mustNotProduce: ['"stop."'],
    },
  },
  {
    id: "adv-citation-01",
    category: "citation",
    mode: "academic",
    note: "Multiple citation formats in one passage, including a semicolon-separated pair and an et al. form.",
    text: "Furthermore, the effect held across settings (Mayer, 1995; Chen & Rao, 2004). It is important to note that later work (Li et al. 2019) disagreed.",
    expectedProtectedFacts: [],
    expectation: {
      outcome: "rewrite",
      mustPreserve: ["(Mayer, 1995; Chen & Rao, 2004)", "(Li et al. 2019)"],
    },
  },
  {
    id: "adv-citation-02",
    category: "citation",
    mode: "academic",
    note: "A DOI and a URL both contain rewrite triggers as path segments.",
    text: "Furthermore, see https://example.org/in-order-to/leverage and doi:10.1000/xyz.123 for the full derivation of the model.",
    expectedProtectedFacts: [],
    expectation: {
      outcome: "rewrite",
      mustPreserve: ["https://example.org/in-order-to/leverage", "doi:10.1000/xyz.123"],
    },
  },
  {
    id: "adv-number-01",
    category: "numbers and units",
    mode: "academic",
    note: "Decimals, thousands separators, units and percentages, all of which a stop-based segmenter can split through.",
    text: "Moreover, the reactor ran at 1,250 °C for 3.5 h and produced 0.42 mol of product. Furthermore, the yield was 92.7% against a 95% target.",
    expectedProtectedFacts: [],
    expectation: {
      outcome: "rewrite",
      mustPreserve: ["1,250 °C", "3.5 h", "0.42 mol", "92.7%", "95%"],
    },
  },
  {
    id: "adv-number-02",
    category: "numbers and units",
    mode: "professional",
    note: "A sentence ending in a percentage: the stop follows '%', not a letter.",
    text: "Furthermore, growth reached 12%. It is important to note that the forecast assumed 8% and the board approved $1.2 million.",
    expectedProtectedFacts: [],
    expectation: {
      outcome: "rewrite",
      mustPreserve: ["12%", "8%", "$1.2 million"],
    },
  },
  {
    id: "adv-acronym-01",
    category: "mixed-case acronym",
    mode: "professional",
    note: "Words that spell themselves with an internal capital must never be re-capitalized.",
    text: "It is important to note that eBay, iOS and pH sensors were all affected. Furthermore, the SDK and API teams shipped a fix.",
    expectedProtectedFacts: [],
    expectation: {
      outcome: "rewrite",
      mustPreserve: ["eBay", "iOS", "pH sensors", "SDK", "API"],
      mustNotProduce: ["EBay", "IOS", "PH sensors"],
    },
  },
  {
    id: "adv-list-01",
    category: "list",
    mode: "professional",
    note: "A numbered list: the markers are not sentence boundaries, and item 2 contains the preposition 'in addition to'.",
    text: "Furthermore, the checklist is short:\n1. Confirm the invoice total.\n2. In addition to the invoice, attach the purchase order.\n3. Utilize the shared folder for every file.",
    expectedProtectedFacts: [],
    expectation: {
      outcome: "rewrite",
      mustPreserve: ["In addition to the invoice, attach the purchase order."],
      mustNotProduce: ["To the invoice"],
    },
  },
  {
    id: "adv-long-01",
    category: "very long sentence",
    mode: "academic",
    note: "One 80-word sentence with several filler spans; readability is scored per sentence, so length alone drags the score.",
    text: "It is important to note that the committee, having reviewed the submissions in order to establish a consistent basis for comparison across the four regions, and having consulted the finance group about the 2026 budget, concluded that the pilot should continue for a further 18 months, although members disagreed about whether the reporting cadence ought to remain monthly or move to a quarterly rhythm that would reduce administrative load without obscuring early warning signs.",
    expectedProtectedFacts: [],
    expectation: {
      outcome: "rewrite",
      mustPreserve: ["18 months", "2026", "four regions"],
    },
  },
  {
    id: "adv-meaning-01",
    category: "meaning-breaking rewrite",
    mode: "natural",
    note: "'In addition to' is a preposition here; deleting it destroys the sentence.",
    text: "In addition to the survey, we interviewed 12 residents. Furthermore, the panel met twice during the same week.",
    expectedProtectedFacts: [],
    expectation: {
      outcome: "rewrite",
      mustPreserve: ["In addition to the survey, we interviewed 12 residents."],
      mustNotProduce: ["To the survey"],
    },
  },
  {
    id: "adv-meaning-02",
    category: "meaning-breaking rewrite",
    mode: "natural",
    note: "'leverage' is a noun and 'moving forward' a gerund subject; both look like filler and are not.",
    text: "Furthermore, the team gained leverage in the negotiation, and moving forward is not always possible in a fixed contract.",
    expectedProtectedFacts: [],
    expectation: {
      outcome: "rewrite",
      mustPreserve: ["gained leverage in the negotiation", "moving forward is not always possible"],
      mustNotProduce: ["gained use", "from here, is"],
    },
  },
  {
    id: "adv-meaning-03",
    category: "meaning-breaking rewrite",
    mode: "academic",
    note: "A negation and a hedge carry the claim; dropping either reverses or overstates it.",
    text: "It is important to note that the study does not show that sleep improves recall. Furthermore, the association was not statistically significant.",
    expectedProtectedFacts: [],
    expectation: {
      outcome: "rewrite",
      mustPreserve: ["does not show", "was not statistically significant"],
    },
  },
  {
    id: "adv-meaning-04",
    category: "meaning-breaking rewrite",
    mode: "professional",
    note: "Filler-looking words inside inline code are program text and must survive byte-for-byte.",
    text: "Furthermore, call `utilize(inOrderTo)` before the retry. It is important to note that `leverage_at_scale` was renamed last week.",
    expectedProtectedFacts: [],
    expectation: {
      outcome: "rewrite",
      mustPreserve: ["`utilize(inOrderTo)`", "`leverage_at_scale`"],
    },
  },
  {
    id: "adv-natural-01",
    category: "already natural",
    mode: "natural",
    note: "Nothing here is wrong. The correct output is the input.",
    text: "The rain stopped just after lunch. We walked down to the harbour and watched the boats come in.",
    expectedProtectedFacts: [],
    expectation: { outcome: "preserve" },
  },
  {
    id: "adv-natural-02",
    category: "already natural",
    mode: "natural",
    note: "Varied rhythm, concrete detail, no stock vocabulary. Any change here is an unnecessary change.",
    text: "She left the office at six, walked to the river, and sat on the bench until the light went. A heron worked the far bank. Nobody bothered her.",
    expectedProtectedFacts: [],
    expectation: { outcome: "preserve" },
  },
  {
    id: "adv-natural-03",
    category: "already natural",
    mode: "professional",
    note: "Plain, well-formed business writing with real numbers and no filler.",
    text: "We closed 14 of the 20 open tickets this week. The remaining six need input from the vendor, who has promised an answer by Thursday.",
    expectedProtectedFacts: [],
    expectation: { outcome: "preserve" },
  },
  {
    id: "adv-nonnative-01",
    category: "non-native grammar",
    mode: "natural",
    note: "Tense and agreement errors. A rule-based substitution engine cannot repair grammar; this case is expected to fail until a model provider is selected.",
    text: "Yesterday I go to the bank because my card was not working. The employee explain the problem and now it works good.",
    expectedProtectedFacts: [],
    expectation: {
      outcome: "rewrite",
      mustRemove: ["I go to the bank", "The employee explain"],
    },
  },
  {
    id: "adv-nonnative-02",
    category: "non-native grammar",
    mode: "natural",
    note: "Preposition and plural errors that no substitution table covers.",
    text: "I am living in this neighborhood since three years. It is convenient because many shop are near my apartment.",
    expectedProtectedFacts: [],
    expectation: {
      outcome: "rewrite",
      mustRemove: ["since three years", "many shop are"],
    },
  },
  {
    id: "adv-rhythm-01",
    category: "structural monotony",
    mode: "natural",
    note: "Analysis reports repetitive-opening and repetitive-length. There is no rewrite rule for either: the engine substitutes phrases, it cannot restructure a sentence.",
    text: "The team met on Monday. The team reviewed the plan. The team agreed on scope. The team set a date. The team went home.",
    expectedProtectedFacts: [],
    expectation: { outcome: "rewrite" },
  },
  {
    id: "adv-qualifier-01",
    category: "structural monotony",
    mode: "natural",
    note: "Analysis reports excessive-qualifier. No substitution table removes a qualifier, because removing one safely needs judgement about emphasis.",
    text: "The results were very promising and really quite significant, though somewhat limited by the rather small sample of participants.",
    expectedProtectedFacts: [],
    expectation: { outcome: "rewrite", mustRemove: ["very promising and really quite significant"] },
  },
  {
    id: "adv-conclusion-01",
    category: "structural monotony",
    mode: "natural",
    note: "Analysis reports generic-conclusion and has no rule to replace one; a specific conclusion has to be written, not substituted.",
    text: "We tested the prototype for six weeks with eight households. The possibilities are endless and only time will tell.",
    expectedProtectedFacts: [],
    expectation: {
      outcome: "rewrite",
      mustPreserve: ["six weeks", "eight households"],
      mustRemove: ["The possibilities are endless"],
    },
  },
  {
    id: "adv-parallel-01",
    category: "structural monotony",
    mode: "professional",
    note: "Analysis reports parallel-structure. Varying it means rebuilding the clause, which substitution cannot do.",
    text: "The programme not only reduced waiting times across the three clinics but also improved staff retention over the same period.",
    expectedProtectedFacts: [],
    expectation: { outcome: "rewrite", mustPreserve: ["three clinics"], mustRemove: ["not only reduced"] },
  },
  {
    id: "adv-vocab-01",
    category: "undetected AI vocabulary",
    mode: "natural",
    note: "The robotic-vocabulary marker matches delve/delves/delved into but not 'delving into', so this is not even reported as an issue.",
    text: "Delving into the subject reveals a number of interesting questions that deserve a much closer look from researchers.",
    expectedProtectedFacts: [],
    expectation: { outcome: "rewrite", mustRemove: ["Delving into"] },
  },
  {
    id: "adv-tone-01",
    category: "tone mismatch",
    mode: "academic",
    note: "Casual register requested in academic mode. Tone is scored but never repaired, so the gate rejects every attempt and the customer gets an error instead of a rewrite.",
    text: "The study looked at a bunch of awesome results. The sample was super small so we cannot say much about it.",
    expectedProtectedFacts: [],
    expectation: { outcome: "rewrite", mustRemove: ["a bunch of", "awesome", "super small"] },
  },
];
