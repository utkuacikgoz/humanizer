// Deterministic fixtures for the browser suite.
//
// None of these is customer writing (docs/QA.md: "Never put customer writing
// into test fixtures"). They are synthetic drafts written to exercise a
// specific engine path, and each one names the path it exercises.
import { createHumanizationPipeline } from "../../../src/lib/humanization/index";

/**
 * The route builds its pipeline with this exact config
 * (app/api/humanize/route.ts), so the suite must too — otherwise the
 * "expected full rewrite" it computes would not be the one the server
 * produced, and the leak assertions would be checking the wrong string.
 */
const pipeline = createHumanizationPipeline({ config: { maxInputCharacters: 2_400 } });

/**
 * An AI-flavoured draft that the deterministic engine rewrites heavily and
 * that carries protected facts (a person, a date, a percentage, a citation).
 * Long enough that the 46%-of-words preview leaves a substantial locked tail.
 */
export const REWRITABLE_DRAFT =
  "In today's fast-paced world, it is important to note that our team must leverage every available channel. " +
  "Furthermore, Dr. Sarah Chen reported on March 14, 2024 that 87% of the pilot group delved into the multifaceted dashboard. " +
  "Moreover, the study (Chen et al., 2024) underscores a pivotal shift in how teams work. " +
  "In conclusion, moving forward we will drive value at scale for each and every customer.";

/**
 * Ordinary human prose containing none of the marker phrases in
 * src/lib/humanization/analysis.ts, so the engine flags no sentence, rewrites
 * nothing, and the ACT-01 guard must return the terminal unchanged outcome.
 */
export const ALREADY_NATURAL_DRAFT =
  "The bakery on Mill Street opens at six. I walked past it this morning and the smell of bread was " +
  "already spilling onto the pavement. Two men were unloading crates from a small blue van parked on " +
  "the corner near the pharmacy, and neither of them looked awake yet.";

/**
 * A draft whose only engine edit is cosmetic: the sentence is flagged by the
 * `excessive-qualifier` marker ("very"), so the rewriter runs over it, but no
 * phrase in the substitution table matches. The only thing that changes is the
 * post-processing rule that deletes whitespace before punctuation.
 */
export const COSMETIC_ONLY_DRAFT =
  "The quarterly report was very long , and the team read it twice before the meeting on Tuesday " +
  "morning in the small room near the stairs, and nobody raised a single question about it afterwards.";

// Fixtures below MIN_PAYWALLABLE_INPUT_WORDS (25) are deliberately short —
// they exercise input validation. Every other draft here must clear that
// minimum, or it is refused client-side and never reaches the engine path it
// was written to stress.
export const HOSTILE_DRAFTS = {
  empty: "",
  oneWord: "hello",
  elevenWords: "one two three four five six seven eight nine ten eleven",
  // Under MIN_PAYWALLABLE_INPUT_WORDS (25). Named for its role, not its
  // length, so a future change to the minimum cannot leave the name lying.
  belowMinimum: "It is important to note that the team should leverage new tools daily",
  threeHundredWords: Array.from({ length: 300 }, (_, i) => (i % 12 === 11 ? "clear." : "clear")).join(" "),
  threeHundredOneWords: Array.from({ length: 301 }, (_, i) => (i % 12 === 11 ? "clear." : "clear")).join(" "),
  giantSingleWord: "a".repeat(5_000),
  emoji:
    "Furthermore 🎉🎉 the team 🚀 must leverage 💡 every channel 🔥 in today's fast-paced world 😀 because " +
    "it is important to note that 🧠 results matter a great deal here. " +
    "Moreover, stakeholders should utilize robust frameworks in order to facilitate optimal outcomes across the wider organization moving forward together this quarter.",
  rightToLeft:
    "Furthermore, it is important to note that مرحبا بالعالم هذا اختبار للغة العربية والنص ثنائي الاتجاه " +
    "and the team must leverage every available channel today. " +
    "Moreover, stakeholders should utilize robust frameworks in order to facilitate optimal outcomes across the wider organization moving forward together this quarter.",
  markup:
    "Furthermore, it is important to note that <script>window.__xssScript = 1</script> " +
    "<img src=x onerror=\"window.__xssHandler = 1\"> <svg onload=\"window.__xssSvg = 1\"></svg> " +
    "the team must leverage <b>bold</b> channels every single day. " +
    "Moreover, stakeholders should utilize robust frameworks in order to facilitate optimal outcomes across the wider organization moving forward together this quarter.",
  markdown:
    "# Heading\n\nFurthermore, it is important to note that **bold** and _italic_ text with `code` and a " +
    "[link](https://example.org/x?y=1&z=2) must leverage lists:\n\n- one\n- two\n\n> a quoted line here.\n\n" +
    "Moreover, stakeholders should utilize robust frameworks in order to facilitate optimal outcomes across the wider organization moving forward together this quarter.",
  citationHeavy:
    "Furthermore, it is important to note that Dr. O'Neill said “the 87% figure isn’t final” " +
    "(Chen et al., 2024, pp. 12–15); revenue was $2.3 million on March 14, 2024, per " +
    "https://example.org/data?q=1&r=2 and the team must leverage that finding. " +
    "Moreover, stakeholders should utilize robust frameworks in order to facilitate optimal outcomes across the wider organization moving forward together this quarter.",
} as const;

/**
 * The complete rewrite the server generated but never shipped, computed with
 * the same engine and config the route uses. This is what the M1 gate is
 * about: everything past the preview boundary must be unreachable from the
 * browser, and the only way to assert that honestly is to know the string.
 */
export async function fullRewriteOf(text: string, mode: "natural" | "professional" | "academic" | "casual" = "natural") {
  const result = await pipeline.humanize({ text, mode });
  return result.text;
}

/**
 * Tokens that exist in the withheld remainder of the rewrite and nowhere in
 * the visitor's own draft.
 *
 * The distinction is the whole point. Words the visitor typed are legitimately
 * on screen in the Original panel, so finding "customer" in the DOM proves
 * nothing. A word the *rewriter* introduced, past the preview boundary, has
 * exactly one place it could have come from.
 */
export function withheldOnlyTokens(original: string, preview: string, fullRewrite: string): string[] {
  const previewWords = preview.trim().split(/\s+/).length;
  const hiddenTail = fullRewrite.trim().split(/\s+/).slice(previewWords).join(" ");
  const originalTokens = new Set(
    original.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [],
  );
  const previewTokens = new Set(preview.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []);
  const tokens = hiddenTail.match(/[\p{L}\p{N}']+/gu) ?? [];
  return [...new Set(tokens)]
    .filter((token) => token.length >= 4)
    .filter((token) => !originalTokens.has(token.toLowerCase()))
    .filter((token) => !previewTokens.has(token.toLowerCase()));
}

export function hiddenTailOf(preview: string, fullRewrite: string): string {
  const previewWords = preview.trim().split(/\s+/).length;
  return fullRewrite.trim().split(/\s+/).slice(previewWords).join(" ");
}
