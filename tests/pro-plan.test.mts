// Pro is purchasable (M2-02 follow-on). These assert the three things that
// have to be true at once for that to be safe rather than merely possible:
// the catalog and the Stripe env mapping agree, the deploy actually carries
// the plan's price secret, and the ledger admits the larger allowance the
// plan is sold on.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { STRIPE_PRICE_ENV_KEYS, isPurchasablePlan, type PlanId } from "../src/config/stripe";
import { pricingConfig } from "../src/config/pricing";
import { assertPriceMatchesCatalog, expectedMinorUnits, PriceMismatchError } from "../src/lib/price-integrity";
import { validateStripeConfig, StripeNotConfiguredError } from "../src/lib/stripe-config";
import { getOrCreateUserByExternalSubject, upsertSubscriptionFromStripe } from "../db/billing-repository";
import { commitPaidUsage, reservePaidUsage } from "../src/lib/paid-usage";
import { createTestDatabase } from "./helpers/sqlite-db.mjs";

const PERIOD_START = new Date("2026-08-01T00:00:00Z");
const PERIOD_END = new Date("2026-09-01T00:00:00Z");
const planIds = Object.keys(STRIPE_PRICE_ENV_KEYS) as PlanId[];

// ---------------------------------------------------------------- catalog

test("Pro is a plan the server will actually sell", () => {
  assert.equal(pricingConfig.plans.pro.availability, "active");
  assert.equal(isPurchasablePlan("pro"), true);
  assert.equal(isPurchasablePlan("starter"), true);
});

test("nothing outside the catalog is purchasable", () => {
  for (const planId of ["enterprise", "PRO", "Pro", "", "pro ", "constructor", "toString"]) {
    assert.equal(isPurchasablePlan(planId), false, `${JSON.stringify(planId)} must not be purchasable`);
  }
});

test("every purchasable plan has a price env key, and every price env key names a real plan", () => {
  for (const [planId, plan] of Object.entries(pricingConfig.plans)) {
    assert.equal(
      planId in STRIPE_PRICE_ENV_KEYS,
      plan.availability === "active",
      `${planId} is availability "${plan.availability}" but ${planId in STRIPE_PRICE_ENV_KEYS ? "has" : "has no"} STRIPE_PRICE_ENV_KEYS entry`,
    );
  }
  for (const planId of planIds) assert.ok(pricingConfig.plans[planId], `${planId} has no catalog entry`);
});

// The plan is sold on its allowance, so the allowance is the one number the
// card must not be able to misstate. It appears twice in the catalog (the
// enforced `wordLimit` and the displayed feature bullet) and this is what
// stops the two drifting.
test("each plan's displayed word allowance is the allowance the ledger enforces", () => {
  for (const plan of Object.values(pricingConfig.plans)) {
    const shown = plan.features.find((feature) => /words/i.test(feature));
    assert.ok(shown, `${plan.id} does not tell the customer its word allowance`);
    assert.ok(
      shown.includes(plan.wordLimit.toLocaleString("en-US")),
      `${plan.id} advertises "${shown}" but enforces ${plan.wordLimit}`,
    );
  }
});

test("no plan sells a capability it has not built", () => {
  for (const plan of Object.values(pricingConfig.plans)) {
    for (const feature of plan.features) {
      assert.doesNotMatch(feature, /coming later|coming soon|planned|beta/i, `${plan.id} sells "${feature}" as if it existed`);
    }
    const planned = new Set<string>(plan.plannedFeatures.map((item) => item.toLowerCase()));
    for (const feature of plan.features) {
      assert.equal(planned.has(feature.toLowerCase()), false, `${plan.id} lists "${feature}" as both included and planned`);
    }
  }
});

test("Pro differs from Starter only by its allowance", () => {
  const shape = (plan: (typeof pricingConfig.plans)[keyof typeof pricingConfig.plans]) =>
    plan.features.filter((feature) => !/words/i.test(feature));
  assert.deepEqual(shape(pricingConfig.plans.pro), shape(pricingConfig.plans.starter));
  assert.ok(pricingConfig.plans.pro.wordLimit > pricingConfig.plans.starter.wordLimit);
});

// -------------------------------------------------------- price integrity

test("a Pro Stripe price is validated against the catalog like every other plan", () => {
  assert.equal(expectedMinorUnits("pro"), 1900);
  const valid = { unit_amount: 1900, currency: "usd", active: true, recurring: { interval: "month" as const } };
  assert.doesNotThrow(() => assertPriceMatchesCatalog("pro", valid));

  // A misconfigured Pro price must close checkout, never sell at the wrong
  // amount. Each of these is a way the live price could disagree.
  assert.throws(() => assertPriceMatchesCatalog("pro", { ...valid, unit_amount: 999 }), PriceMismatchError);
  assert.throws(() => assertPriceMatchesCatalog("pro", { ...valid, currency: "eur" }), PriceMismatchError);
  assert.throws(() => assertPriceMatchesCatalog("pro", { ...valid, recurring: null }), PriceMismatchError);
  assert.throws(() => assertPriceMatchesCatalog("pro", { ...valid, recurring: { interval: "year" } }), PriceMismatchError);
  assert.throws(() => assertPriceMatchesCatalog("pro", { ...valid, active: false }), PriceMismatchError);
});

test("every purchasable plan's expected amount comes from the catalog, not a literal", () => {
  for (const planId of planIds) {
    assert.equal(expectedMinorUnits(planId), Math.round(pricingConfig.plans[planId].monthlyPrice * 100));
  }
});

test("a missing Pro price id fails the whole Stripe configuration closed", () => {
  const complete = {
    STRIPE_SECRET_KEY: "sk_test_abc123",
    STRIPE_WEBHOOK_SECRET: "whsec_abc123",
    STRIPE_PRICE_STARTER: "price_starter",
    STRIPE_PRICE_PRO: "price_pro",
  };
  assert.deepEqual(validateStripeConfig(complete).priceIds, { starter: "price_starter", pro: "price_pro" });

  const { STRIPE_PRICE_PRO, ...withoutPro } = complete;
  void STRIPE_PRICE_PRO;
  assert.throws(
    () => validateStripeConfig(withoutPro),
    (error: unknown) => error instanceof StripeNotConfiguredError && /STRIPE_PRICE_PRO/.test(error.message),
    "an unset Pro price must take checkout down rather than leave Pro unpriced",
  );
});

// ------------------------------------------------------------ the deploy

test("the deploy carries a price secret for every purchasable plan", () => {
  // `wrangler deploy --secrets-file` REPLACES the Worker's entire secret set,
  // so a plan added to STRIPE_PRICE_ENV_KEYS without a line in the workflow
  // is not "unset in production" — it is deleted from production on the next
  // deploy. Derived from the catalog so the next plan cannot be forgotten.
  const workflow = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  for (const envKey of Object.values(STRIPE_PRICE_ENV_KEYS)) {
    assert.match(workflow, new RegExp(`${envKey}: \\$\\{\\{ secrets\\.${envKey} \\}\\}`), `${envKey} must be read from repository secrets`);
    assert.match(workflow, new RegExp(`"${envKey}=\\$${envKey}"`), `${envKey} must be written into the secrets file`);
    assert.match(workflow, new RegExp(`env\\.${envKey} != ''`), `${envKey} must gate the deploy`);
    assert.match(workflow, new RegExp(`env\\.${envKey} == ''`), `${envKey} must fail the "not configured" check`);
  }
});

test("the local secrets example documents every price a developer must set", () => {
  const example = readFileSync(new URL("../.dev.vars.example", import.meta.url), "utf8");
  for (const envKey of Object.values(STRIPE_PRICE_ENV_KEYS)) {
    assert.match(example, new RegExp(`^${envKey}=`, "m"), `${envKey} must appear in .dev.vars.example`);
  }
});

// ----------------------------------------------------------- entitlement

async function entitledOn(planId: PlanId) {
  const db = await createTestDatabase();
  const externalSubject = `${planId}-${crypto.randomUUID()}`;
  const { userId } = await getOrCreateUserByExternalSubject(db, { externalSubject, email: null });
  await upsertSubscriptionFromStripe(db, {
    userId,
    stripeCustomerId: `cus_${planId}`,
    stripeSubscriptionId: `sub_${crypto.randomUUID()}`,
    planId,
    catalogVersion: pricingConfig.catalogVersion,
    status: "active",
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
    cancelAtPeriodEnd: false,
    lastStripeEventId: `evt_${planId}`,
  });
  return { db, externalSubject, userId };
}

test("a Pro customer is admitted past the Starter allowance", async () => {
  const { db, externalSubject } = await entitledOn("pro");
  const starterCeiling = pricingConfig.plans.starter.wordLimit;

  // Spend the whole Starter allowance first, so the next request is only
  // admissible if the ledger is reading Pro's limit and not a 50,000 floor
  // left over from the one plan that used to be sellable.
  const first = await reservePaidUsage(db, { externalSubject, idempotencyKey: "pro-fill", words: starterCeiling });
  assert.equal(first.kind, "reserved");
  if (first.kind !== "reserved") return;
  assert.equal(first.reservation.allowance, pricingConfig.plans.pro.wordLimit);
  const afterFill = await commitPaidUsage(db, first.reservation, starterCeiling);
  assert.equal(afterFill.consumed, starterCeiling);
  assert.equal(afterFill.allowance, 200_000);
  assert.equal(afterFill.remaining, 200_000 - starterCeiling);

  const past = await reservePaidUsage(db, { externalSubject, idempotencyKey: "pro-past-starter", words: 5_000 });
  assert.equal(past.kind, "reserved", "a Pro customer must not be stopped at the Starter ceiling");
});

test("a Starter customer is still stopped at the Starter allowance", async () => {
  const { db, externalSubject } = await entitledOn("starter");
  const first = await reservePaidUsage(db, { externalSubject, idempotencyKey: "starter-fill", words: pricingConfig.plans.starter.wordLimit });
  assert.equal(first.kind, "reserved");
  if (first.kind !== "reserved") return;
  await commitPaidUsage(db, first.reservation, pricingConfig.plans.starter.wordLimit);

  const past = await reservePaidUsage(db, { externalSubject, idempotencyKey: "starter-past", words: 1 });
  assert.equal(past.kind, "quota-exceeded", "Pro's larger limit must not leak into Starter");
  if (past.kind !== "quota-exceeded") return;
  assert.equal(past.allowance, pricingConfig.plans.starter.wordLimit);
});

test("a Pro customer is still stopped at Pro's own ceiling", async () => {
  const { db, externalSubject } = await entitledOn("pro");
  const proCeiling = pricingConfig.plans.pro.wordLimit;
  const first = await reservePaidUsage(db, { externalSubject, idempotencyKey: "pro-fill-all", words: proCeiling });
  assert.equal(first.kind, "reserved");
  if (first.kind !== "reserved") return;
  await commitPaidUsage(db, first.reservation, proCeiling);

  const past = await reservePaidUsage(db, { externalSubject, idempotencyKey: "pro-overspend", words: 1 });
  assert.equal(past.kind, "quota-exceeded", "200,000 is a ceiling, not a suggestion");
  if (past.kind !== "quota-exceeded") return;
  assert.equal(past.allowance, proCeiling);
  assert.equal(past.remaining, 0);
});
