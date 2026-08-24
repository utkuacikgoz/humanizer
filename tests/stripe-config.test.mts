// M2-11 environment-mismatch coverage for configuration (docs/QA.md:
// "plan mapping rejects unknown/mismatched environments"; ARCHITECTURE.md:
// "Startup/deploy validation fails closed for missing or mismatched
// required configuration"). The runtime half of the same requirement — a
// live event delivered to a test deployment — is in
// tests/webhook-adversarial.test.mts.
import assert from "node:assert/strict";
import test from "node:test";
import {
  StripeConfigInvalidError,
  StripeNotConfiguredError,
  stripeModeFromSecretKey,
  validateStripeConfig,
} from "../src/lib/stripe-config";

const VALID = {
  STRIPE_SECRET_KEY: "sk_test_51AbCdEf",
  STRIPE_WEBHOOK_SECRET: "whsec_abc123",
  STRIPE_PRICE_STARTER: "price_123",
};

test("accepts a fully configured test environment and reports its mode", () => {
  const config = validateStripeConfig({ ...VALID });
  assert.equal(config.mode, "test");
  assert.equal(config.livemode, false);
  assert.equal(config.priceIds.starter, "price_123");
});

test("reports live mode for a live secret key", () => {
  const config = validateStripeConfig({ ...VALID, STRIPE_SECRET_KEY: "sk_live_51AbCdEf" });
  assert.equal(config.mode, "live");
  assert.equal(config.livemode, true);
});

test("accepts a restricted key and derives its mode", () => {
  assert.equal(validateStripeConfig({ ...VALID, STRIPE_SECRET_KEY: "rk_test_abc" }).mode, "test");
  assert.equal(validateStripeConfig({ ...VALID, STRIPE_SECRET_KEY: "rk_live_abc" }).mode, "live");
});

test("fails closed when nothing is configured, naming every missing key", () => {
  assert.throws(
    () => validateStripeConfig({}),
    (error: unknown) => {
      assert.ok(error instanceof StripeNotConfiguredError);
      for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_STARTER"]) {
        assert.match(error.message, new RegExp(key));
      }
      return true;
    },
  );
});

test("fails closed on a missing price mapping even when the keys are present", () => {
  assert.throws(
    () => validateStripeConfig({ STRIPE_SECRET_KEY: VALID.STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET: VALID.STRIPE_WEBHOOK_SECRET }),
    StripeNotConfiguredError,
  );
});

test("treats a whitespace-only value as unset rather than as configuration", () => {
  assert.throws(() => validateStripeConfig({ ...VALID, STRIPE_PRICE_STARTER: "   " }), StripeNotConfiguredError);
  assert.throws(() => validateStripeConfig({ ...VALID, STRIPE_SECRET_KEY: "  " }), StripeNotConfiguredError);
});

test("rejects a value that is not a Stripe secret key", () => {
  // A publishable key is the classic paste error — it is not a secret, and
  // silently accepting it would fail much later with an opaque API error.
  for (const wrong of ["pk_test_abc", "sk_abc", "sk_test_", "whsec_abc", "sk_prod_abc", "SK_TEST_ABC"]) {
    assert.throws(
      () => validateStripeConfig({ ...VALID, STRIPE_SECRET_KEY: wrong }),
      StripeConfigInvalidError,
      `${wrong} must be rejected`,
    );
  }
});

test("rejects a webhook secret that is not a signing secret", () => {
  for (const wrong of ["sk_test_abc", "abc123", "whsec", "wh_sec_abc"]) {
    assert.throws(() => validateStripeConfig({ ...VALID, STRIPE_WEBHOOK_SECRET: wrong }), StripeConfigInvalidError);
  }
});

test("never returns a partially populated configuration", () => {
  // Fail-closed means no caller can ever observe a config object with an
  // empty secret or a missing price ID.
  for (const key of Object.keys(VALID)) {
    const partial = { ...VALID, [key]: undefined };
    assert.throws(() => validateStripeConfig(partial), StripeNotConfiguredError);
  }
});

test("mode derivation does not treat an unknown prefix as live", () => {
  assert.equal(stripeModeFromSecretKey("sk_test_abc"), "test");
  assert.equal(stripeModeFromSecretKey("sk_live_abc"), "live");
  assert.equal(stripeModeFromSecretKey("something_else"), "test", "an unrecognized key must never be assumed to be live");
});
