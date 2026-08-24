import assert from "node:assert/strict";
import test from "node:test";
import { assertPriceMatchesCatalog, expectedMinorUnits, PriceMismatchError } from "../src/lib/price-integrity";
import { pricingConfig } from "../src/config/pricing";

function validPrice(overrides: Partial<Parameters<typeof assertPriceMatchesCatalog>[1]> = {}) {
  return {
    unit_amount: expectedMinorUnits("starter"),
    currency: pricingConfig.currency,
    active: true,
    recurring: { interval: pricingConfig.plans.starter.interval },
    ...overrides,
  };
}

test("rounds float prices to minor units without truncation", () => {
  // 9.99 * 100 is 998.9999999999999 in IEEE-754 — a truncating conversion
  // would silently under-charge by a cent.
  assert.equal(expectedMinorUnits("starter"), 999);
});

test("accepts a Stripe price matching the published catalog", () => {
  assert.doesNotThrow(() => assertPriceMatchesCatalog("starter", validPrice()));
});

test("rejects a price charging a different amount", () => {
  assert.throws(() => assertPriceMatchesCatalog("starter", validPrice({ unit_amount: 900 })), PriceMismatchError);
});

test("rejects a price in a different currency", () => {
  assert.throws(() => assertPriceMatchesCatalog("starter", validPrice({ currency: "eur" })), PriceMismatchError);
});

test("accepts an uppercase currency from Stripe", () => {
  assert.doesNotThrow(() => assertPriceMatchesCatalog("starter", validPrice({ currency: "USD" })));
});

test("rejects a one-off price where the catalog promises a subscription", () => {
  assert.throws(() => assertPriceMatchesCatalog("starter", validPrice({ recurring: null })), PriceMismatchError);
});

test("rejects a price billed on the wrong interval", () => {
  assert.throws(() => assertPriceMatchesCatalog("starter", validPrice({ recurring: { interval: "year" } })), PriceMismatchError);
});

test("rejects an archived price", () => {
  assert.throws(() => assertPriceMatchesCatalog("starter", validPrice({ active: false })), PriceMismatchError);
});

test("does not require the active flag to be present", () => {
  const { active, ...withoutActive } = validPrice();
  void active;
  assert.doesNotThrow(() => assertPriceMatchesCatalog("starter", withoutActive));
});

test("mismatch messages never leak the price ID or secret material", () => {
  try {
    assertPriceMatchesCatalog("starter", validPrice({ unit_amount: 1 }));
    assert.fail("expected a mismatch");
  } catch (error) {
    assert.ok(error instanceof PriceMismatchError);
    assert.doesNotMatch(error.message, /price_|sk_|whsec_/);
  }
});
