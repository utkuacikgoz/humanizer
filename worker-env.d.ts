// Ambient shape of this Worker's bindings and secrets.
//
// `Env` is declared (empty) by @cloudflare/workers-types and is what
// `cloudflare:workers`'s `env` is typed as. Augmenting it here is what makes
// `env.DB` and the Stripe secrets type-check instead of erroring — without
// this, `tsc --noEmit` fails on every module that touches a binding.
//
// Keep in sync with vite.config.ts's binding config (D1) and the secrets set
// via `wrangler secret put` (Stripe). All secrets are optional: db/stripe-client.ts
// resolves them at runtime and fails closed when they are unset (D-013), so
// typing them as required here would misrepresent an unconfigured environment.
declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    STRIPE_PRICE_STARTER?: string;
    /** Required outside explicit local/test environments; >=32 random bytes. */
    PREVIEW_GUARD_SECRET?: string;
    /** Set to `production`, `development`, `local`, or `test`. */
    ENVIRONMENT?: string;
  }
}
