// Pure Stripe configuration validation, extracted from db/stripe-client.ts
// so it is testable under plain Node: db/stripe-client.ts imports
// `cloudflare:workers` at module load and therefore cannot be imported by
// tests/*.test.mts at all (see the CRITICAL PATTERN note in
// docs/ARCHITECTURE.md's configuration section and app/api/checkout/route.ts's
// lazy-import precedent). This module takes the environment record as a
// plain argument and never reads a global, so every fail-closed branch below
// is directly asserted in tests/stripe-config.test.mts.
//
// D-013 (docs/DECISIONS.md): these env vars are unset placeholders until real
// Stripe credentials are supplied. That is intentional, but validation still
// fails closed — it never falls back to a hardcoded or silently-optional
// secret.
import { STRIPE_PRICE_ENV_KEYS, type PlanId } from "@/src/config/stripe";

export class StripeNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Stripe is not configured: missing ${missing.join(", ")}.`);
    this.name = "StripeNotConfiguredError";
  }
}

export class StripeConfigInvalidError extends Error {
  constructor(reason: string) {
    super(`Stripe configuration is invalid: ${reason}.`);
    this.name = "StripeConfigInvalidError";
  }
}

// Secret keys self-report their mode (sk_test_/sk_live_), so a malformed or
// wrong-type value is caught here with a clear error instead of a cryptic
// Stripe API failure downstream. Price IDs and webhook signing secrets do NOT
// encode test/live mode in their string format, so full cross-field
// mode-consistency (ARCHITECTURE.md: "Production/test Stripe identifiers
// cannot be mixed") cannot be verified by static inspection. What *can* be
// verified at runtime is that each inbound webhook event's own `livemode`
// flag agrees with the mode of the configured secret key — see
// src/lib/stripe-webhook-projection.ts's expectedLivemode check, which is the
// enforcement point for docs/MONETIZATION.md's "Validate that each deployment
// uses Stripe objects from the correct test/live mode".
const SECRET_KEY_PATTERN = /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/;

export type StripeMode = "test" | "live";

export interface StripeEnvSource {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  [priceEnvKey: string]: string | undefined;
}

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  priceIds: Record<PlanId, string>;
  mode: StripeMode;
  /** True when the configured secret key is a live-mode key. */
  livemode: boolean;
}

/** Derives test/live mode from a validated Stripe secret key. */
export function stripeModeFromSecretKey(secretKey: string): StripeMode {
  return secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_") ? "live" : "test";
}

export function validateStripeConfig(source: StripeEnvSource): StripeConfig {
  const missing: string[] = [];

  const secretKey = source.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) missing.push("STRIPE_SECRET_KEY");
  const webhookSecret = source.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) missing.push("STRIPE_WEBHOOK_SECRET");

  const priceIds = {} as Record<PlanId, string>;
  for (const [planId, envKey] of Object.entries(STRIPE_PRICE_ENV_KEYS) as [PlanId, string][]) {
    const priceId = source[envKey]?.trim();
    if (!priceId) missing.push(envKey);
    else priceIds[planId] = priceId;
  }

  if (missing.length) throw new StripeNotConfiguredError(missing);
  if (!SECRET_KEY_PATTERN.test(secretKey!)) {
    throw new StripeConfigInvalidError("STRIPE_SECRET_KEY does not look like a real Stripe secret key (expected sk_test_... or sk_live_...)");
  }
  if (!webhookSecret!.startsWith("whsec_")) {
    throw new StripeConfigInvalidError("STRIPE_WEBHOOK_SECRET does not look like a real Stripe webhook signing secret (expected whsec_...)");
  }

  const mode = stripeModeFromSecretKey(secretKey!);
  return { secretKey: secretKey!, webhookSecret: webhookSecret!, priceIds, mode, livemode: mode === "live" };
}
