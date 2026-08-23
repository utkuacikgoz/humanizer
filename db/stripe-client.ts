// Resolves Stripe secrets from the Workers runtime `env` and constructs a
// client. This module is the ONLY place billing code should import
// `cloudflare:workers` for Stripe secrets — routes must lazy-import it
// (same pattern as db/index.ts's getDb(), see app/api/humanize/route.ts's
// tryPersist for precedent) so a plain-Node test importing a route
// directly doesn't crash at module load.
//
// D-013 (docs/DECISIONS.md): these env vars are unset placeholders until
// real Stripe credentials are supplied. That is intentional for now, but
// this module still fails closed — it never falls back to a hardcoded or
// silently-optional secret. A checkout/webhook route calling this with an
// unconfigured environment gets a clear, typed failure, not a
// half-working client.
import { env } from "cloudflare:workers";
import Stripe from "stripe";
import { STRIPE_PRICE_ENV_KEYS, type PlanId } from "@/src/config/stripe";

export class StripeNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Stripe is not configured: missing ${missing.join(", ")}.`);
    this.name = "StripeNotConfiguredError";
  }
}

interface StripeEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  [priceEnvKey: string]: string | undefined;
}

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  priceIds: Record<PlanId, string>;
}

export function resolveStripeConfig(): StripeConfig {
  const source = env as unknown as StripeEnv;
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
  return { secretKey: secretKey!, webhookSecret: webhookSecret!, priceIds };
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
