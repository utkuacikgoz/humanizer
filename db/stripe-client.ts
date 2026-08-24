// Resolves Stripe secrets from the Workers runtime `env` and constructs a
// client. This module is the ONLY place billing code should import
// `cloudflare:workers` for Stripe secrets — routes must lazy-import it
// (same pattern as db/index.ts's getDb(), see app/api/humanize/route.ts's
// tryPersist for precedent) so a plain-Node test importing a route
// directly doesn't crash at module load.
//
// All validation logic lives in src/lib/stripe-config.ts, which is a pure
// module with no `cloudflare:workers` dependency and is therefore directly
// unit-testable (tests/stripe-config.test.mts). This file is only the
// runtime-environment adapter around it.
import { env } from "cloudflare:workers";
import Stripe from "stripe";
import { validateStripeConfig, type StripeConfig, type StripeEnvSource } from "@/src/lib/stripe-config";

export {
  StripeNotConfiguredError,
  StripeConfigInvalidError,
  stripeModeFromSecretKey,
  type StripeConfig,
  type StripeMode,
} from "@/src/lib/stripe-config";

export function resolveStripeConfig(): StripeConfig {
  return validateStripeConfig(env as unknown as StripeEnvSource);
}

export function getStripeClient(): { stripe: Stripe; config: StripeConfig } {
  const config = resolveStripeConfig();
  const stripe = new Stripe(config.secretKey, {
    httpClient: Stripe.createFetchHttpClient(),
    // Pinned to the version bundled with the installed `stripe` package
    // (node_modules/stripe/esm/apiVersion.d.ts) so a Stripe API upgrade
    // never silently changes webhook/object shape underneath this app;
    // bump deliberately, alongside a `npm install stripe@latest` and review.
    apiVersion: "2026-07-29.dahlia",
  });
  return { stripe, config };
}
