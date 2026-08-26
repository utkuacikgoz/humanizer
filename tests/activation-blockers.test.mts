// Regression coverage for the launch blockers in docs/ACTIVATION.md:
// ACT-01 (never paywall an unchanged rewrite), ACT-02 (report the measured
// improvement count), ACT-03 (the Original panel survives on mobile),
// ACT-09 (a reachable cancellation path) and ACT-10 (the recurring charge
// disclosed at the decision point).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { POST } from "../app/api/humanize/route";
import { createHumanizationPipeline } from "../src/lib/humanization/index";
import { improvementLabel, isMateriallyUnchanged, shouldOfferUnlock } from "../src/lib/preview-projection";
import { describePortalFailure } from "../src/lib/billing-portal";
import { subscriptionDisclosure } from "../src/lib/subscription-disclosure";
import { pricingConfig } from "../src/config/pricing";

type PreviewBody = {
  original?: string;
  unchanged?: boolean;
  preview?: string;
  hiddenWordCount?: number;
  issuesImproved?: number;
  capability?: string;
  capabilityExpiresAt?: string;
  error?: string;
};

function request(body: unknown) {
  return new Request("http://localhost/api/humanize", {
    method: "POST",
    headers: { "content-type": "application/json", "x-idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
}

async function humanize(text: string): Promise<PreviewBody> {
  const response = await POST(request({ text, mode: "natural" }));
  assert.equal(response.status, 200, `expected 200, got ${response.status}`);
  return (await response.json()) as PreviewBody;
}

// ---------------------------------------------------------------------
// ACT-01 — never paywall an unchanged rewrite
// ---------------------------------------------------------------------

// Ordinary human-sounding prose containing none of the marker phrases in
// src/lib/humanization/analysis.ts, so the deterministic provider's
// substitution table matches nothing and hands the input straight back.
const UNTOUCHED_FIXTURES = [
  "The team reviewed the quarterly report on Monday and agreed the regional numbers looked right. Sarah asked for a second pass on the northern breakdown before it goes out to anyone else. We will send the final version to the board on Friday morning after one more careful read.",
  "I walked down to the harbour before breakfast because the light is better there early. Two fishing boats were unloading crates onto the pier and a gull kept circling the winch. On the way back I bought bread from the bakery near the tram stop.",
  "Our landlord replaced the boiler last week and the radiators finally heat the back bedroom. The plumber said the old unit had been leaking slowly for months behind the panel. We should see a smaller bill once the winter rates come through.",
];

test("ACT-01: a rewrite that changed nothing is never truncated, priced, or given a capability", async () => {
  for (const fixture of UNTOUCHED_FIXTURES) {
    const body = await humanize(fixture);
    assert.equal(body.unchanged, true, `fixture was rewritten after all: ${fixture.slice(0, 48)}…`);
    assert.equal("preview" in body, false, "an unchanged result must carry no truncated preview");
    assert.equal("hiddenWordCount" in body, false, "an unchanged result withholds nothing, so it has no hidden-word count");
    assert.equal("capability" in body, false, "an unchanged result must never mint a checkout capability");
    assert.equal("capabilityExpiresAt" in body, false);
    assert.equal("issuesImproved" in body, false, "an unchanged result must not carry an improvement claim");
    assert.equal(body.original, fixture, "the visitor's own text is still echoed back");
  }
});

test("ACT-01: no unlock CTA can be produced for an unchanged rewrite", async () => {
  for (const fixture of UNTOUCHED_FIXTURES) {
    assert.equal(shouldOfferUnlock(await humanize(fixture)), false);
  }
});

test("ACT-01: a cosmetic edit with zero measured improvements is never sold", async () => {
  const cosmeticOnly =
    "The quarterly report was very long , and the team read it twice before the meeting on Tuesday " +
    "morning in the small room near the stairs, and nobody raised a single question about it afterwards.";
  const body = await humanize(cosmeticOnly);

  assert.equal(body.unchanged, true);
  assert.equal(body.preview, undefined);
  assert.equal(body.hiddenWordCount, undefined);
  assert.equal(body.issuesImproved, undefined);
  assert.equal(body.capability, undefined);
  assert.equal(shouldOfferUnlock(body), false);
});

test("ACT-01: a genuine rewrite still produces a preview and an offer", async () => {
  const body = await humanize(
    "In today's fast-paced world, it is important to note that clear communication helps teams. Furthermore, people should utilize simple language whenever possible to avoid confusion. It should be emphasized that stakeholders must leverage robust frameworks in order to facilitate optimal outcomes across the organization moving forward together.",
  );
  assert.notEqual(body.unchanged, true);
  assert.ok(body.preview && body.preview.length > 0);
  assert.ok((body.hiddenWordCount ?? 0) > 0);
  assert.equal(shouldOfferUnlock(body), true);
});

test("ACT-01: the unchanged signal compares normalized text, not the improvement count", () => {
  assert.equal(isMateriallyUnchanged("Hello there, world.", "Hello there, world."), true);
  // Whitespace-only and smart-quote-only differences are still nothing to sell.
  assert.equal(isMateriallyUnchanged("Hello   there,\nworld.", "Hello there, world."), true);
  assert.equal(isMateriallyUnchanged("It's fine.", "It’s fine."), true);
  assert.equal(isMateriallyUnchanged("Hello there, world.", "Hi there, world."), false);
});

test("ACT-01: shouldOfferUnlock refuses every shape that withholds nothing", () => {
  assert.equal(shouldOfferUnlock(null), false);
  assert.equal(shouldOfferUnlock(undefined), false);
  assert.equal(shouldOfferUnlock({ unchanged: true }), false);
  assert.equal(shouldOfferUnlock({ preview: "", hiddenWordCount: 9 }), false);
  assert.equal(shouldOfferUnlock({ preview: "a rewrite", hiddenWordCount: 0, issuesImproved: 2 }), false);
  // KI-01: withholding text is necessary but not sufficient — the engine must
  // also have measured a real improvement.
  assert.equal(shouldOfferUnlock({ preview: "a rewrite", hiddenWordCount: 4, issuesImproved: 0 }), false);
  assert.equal(shouldOfferUnlock({ preview: "a rewrite", hiddenWordCount: 4 }), false);
  assert.equal(shouldOfferUnlock({ preview: "a rewrite", hiddenWordCount: 4, issuesImproved: 2 }), true);
});

// ---------------------------------------------------------------------
// ACT-02 — report the measured improvement count
// ---------------------------------------------------------------------

test("ACT-02: the projected count is exactly the engine's measured count, with no floor", async () => {
  const text =
    "In today's fast-paced world, it is important to note that clear communication helps teams. Furthermore, people should utilize simple language whenever possible to avoid confusion. It should be emphasized that stakeholders must leverage robust frameworks in order to facilitate optimal outcomes across the organization moving forward together.";
  // Same pipeline configuration the route constructs, so `improvements`
  // here is the number the route projected.
  const pipeline = createHumanizationPipeline({ config: { maxInputCharacters: 2_400 } });
  const measured = (await pipeline.humanize({ text, mode: "natural" })).improvements;
  const body = await humanize(text);
  assert.equal(body.issuesImproved, measured);
});

test("ACT-02: the floor is gone from the projection", async () => {
  const route = await readFile(new URL("../app/api/humanize/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(
    route,
    /issuesImproved:\s*Math\.max\(/,
    "a Math.max floor on issuesImproved fabricates an evidence claim (docs/MONETIZATION.md)",
  );
});

test("ACT-02: the improvement label pluralizes correctly", () => {
  assert.equal(improvementLabel(1), "1 improvement");
  assert.equal(improvementLabel(4), "4 improvements");
  assert.equal(improvementLabel(0), "0 improvements");
});

// ---------------------------------------------------------------------
// ACT-03 — the Original panel must survive on mobile
// ---------------------------------------------------------------------

test("ACT-03: no stylesheet rule removes a comparison panel at any viewport", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  for (const [, selector, declarations] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selector.includes(".comparison")) continue;
    assert.doesNotMatch(
      declarations,
      /display\s*:\s*none/,
      `"${selector.trim()}" hides a comparison panel — the side-by-side comparison is the activation moment (ACT-03)`,
    );
  }
});

test("ACT-03: the comparison stacks into one column instead of dropping a panel on narrow viewports", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const narrow = css.match(/@media \(max-width: 860px\) \{[\s\S]*?\n\}/);
  assert.ok(narrow, "expected a narrow-viewport block that restacks the comparison");
  assert.match(narrow[0], /\.comparison\s*\{[^}]*grid-template-columns:\s*1fr/);
});

// ---------------------------------------------------------------------
// ACT-09 — "Cancel anytime" has to be reachable
// ---------------------------------------------------------------------

test("ACT-09: every portal failure is an honest, actionable state rather than a silent no-op", () => {
  const signedOut = describePortalFailure(401, "Sign in to manage billing.", "/#manage-billing");
  assert.match(signedOut.message, /sign in/i);
  assert.equal(signedOut.action.kind, "sign-in");
  assert.ok(signedOut.action.kind === "sign-in" && signedOut.action.href.startsWith("/signin?return_to="));

  const noAccount = describePortalFailure(404, "No billing account found.");
  assert.ok(noAccount.message.trim().length > 0);
  assert.match(noAccount.message, /no subscription/i);

  const unconfigured = describePortalFailure(503, "Billing is not available yet.");
  assert.equal(unconfigured.action.kind, "email");
  assert.ok(unconfigured.action.kind === "email" && unconfigured.action.href === "mailto:support@ownword.pro");

  const failed = describePortalFailure(502, "Billing portal could not be opened. Please try again.");
  assert.match(failed.message, /could not be opened/i);

  const offline = describePortalFailure(0);
  assert.ok(offline.message.trim().length > 0, "a network failure must still say something");
});

test("ACT-09: the cancellation claim leads to a real portal", async () => {
  const [home, success, terms, component] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/checkout/success/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/terms/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/manage-billing.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(component, /fetch\("\/api\/billing\/portal"/);
  assert.match(success, /<ManageBilling/, "the post-purchase page must expose the billing portal (ACT-09)");

  // The control moved off the landing page: advertising cancellation to
  // people who have not bought anything is not what ACT-09 asked for. It now
  // sits on /terms beside the cancellation clause. What ACT-09 actually
  // requires is unchanged and still asserted here — the claim and a reachable
  // path ship together, or neither ("Keeping the claim without the path is
  // not an acceptable outcome").
  assert.match(terms, /<ManageBilling/, "the billing portal must be reachable from /terms (ACT-09)");
  assert.match(terms, /id="manage-billing"/, "the claim's anchor must exist on the page it points at");

  if (/Cancel anytime/.test(home)) {
    assert.match(
      home,
      /<Link href="\/terms#manage-billing">Cancel anytime<\/Link>/,
      "the hero claim must link to the portal, wherever it lives",
    );
  }
});

// ---------------------------------------------------------------------
// ACT-10 — disclose the recurring charge at the decision point
// ---------------------------------------------------------------------

test("ACT-10: the disclosure states the amount, the recurrence, and the monthly word allowance", () => {
  const plan = pricingConfig.plans.starter;
  const disclosure = subscriptionDisclosure(plan);
  assert.match(disclosure, new RegExp(`\\$${String(plan.monthlyPrice).replace(".", "\\.")}\\b`));
  assert.match(disclosure, new RegExp(`per ${plan.interval}\\b`));
  assert.match(disclosure, /recurring/i);
  assert.match(disclosure, /until you cancel/i);
  assert.match(disclosure, new RegExp(plan.wordLimit.toLocaleString("en-US").replace(",", ",")));
  assert.match(disclosure, /words each month/i);
});

test("ACT-10: the disclosure reads its values from the catalog, never a literal", async () => {
  const source = await readFile(new URL("../src/lib/subscription-disclosure.ts", import.meta.url), "utf8");
  const code = source.replace(/^\s*\/\/.*$/gm, ""); // prose in comments may name values; code may not
  assert.match(code, /pricingConfig/);
  assert.doesNotMatch(code, /9\.99|50[,_]?000|\$\d/, "plan values must come from pricingConfig, not literals");
});

test("ACT-10: the disclosure introduces no urgency, scarcity, or preselected upsell", () => {
  const disclosure = subscriptionDisclosure(pricingConfig.plans.starter);
  assert.doesNotMatch(disclosure, /limited time|hurry|only \d+ left|expires? (in|soon)|today only|free trial/i);
});

test("ACT-10: the disclosure sits with the unlock button, not only in the pricing section", async () => {
  const home = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  // Through the terms block, not to the first closing tag: the purchase
  // controls now sit in their own wrapper, so a lazy match to the first
  // </div> would stop before the disclosure it is looking for.
  const card = home.match(/<div className="unlock-card">[\s\S]*?<\/small>/);
  assert.ok(card, "expected an unlock card with a terms block in the result branch");
  // One disclosure per purchasable plan, beside the button that buys it.
  // A single plan's terms next to two priced buttons would leave the second
  // plan's recurring charge and allowance undisclosed at the decision point.
  assert.match(card[0], /purchasablePlans\.map\(\(plan\) => <span key=\{plan\.id\}>\{subscriptionDisclosure\(plan\)\}<\/span>\)/);
  assert.match(card[0], /Cancel anytime/);
});

test("ACT-10: every purchasable plan discloses its own recurring terms", () => {
  const purchasable = Object.values(pricingConfig.plans).filter((plan) => plan.availability === "active");
  assert.ok(purchasable.length > 0, "expected at least one purchasable plan");
  for (const plan of purchasable) {
    const disclosure = subscriptionDisclosure(plan);
    assert.match(disclosure, new RegExp(`\\$${String(plan.monthlyPrice).replace(".", "\\.")}\\b`), `${plan.id} must state its amount`);
    assert.match(disclosure, /recurring/i, `${plan.id} must state that it recurs`);
    assert.match(disclosure, /until you cancel/i, `${plan.id} must state how it ends`);
    assert.match(disclosure, new RegExp(plan.wordLimit.toLocaleString("en-US")), `${plan.id} must state its allowance`);
    assert.doesNotMatch(disclosure, /limited time|hurry|only \d+ left|expires? (in|soon)|today only|free trial/i);
  }
});
