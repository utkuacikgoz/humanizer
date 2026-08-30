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
    /**
     * Resend API key. Without it magic-link sign-in fails closed with a
     * console.error naming this variable (src/lib/magic-link.ts) rather than
     * silently accepting sign-ins nobody can complete.
     */
    RESEND_API_KEY?: string;
    /** Envelope sender. Optional: defaults to no-reply@<productConfig.domain>. */
    AUTH_EMAIL_FROM?: string;
    /**
     * Humanization engine provider selection (M4-01). "claude" opts into the
     * model-backed rewriter; anything else, including unset, keeps the
     * deterministic engine. Selection is explicit: a present
     * ANTHROPIC_API_KEY alone never switches a deployment onto a metered
     * provider (src/lib/humanization/provider-config.ts).
     */
    HUMANIZATION_PROVIDER?: string;
    /** Required only when HUMANIZATION_PROVIDER is "claude"; fails closed to deterministic otherwise. */
    ANTHROPIC_API_KEY?: string;
    /** Optional depth control: low | medium | high | xhigh | max. Defaults to medium. */
    HUMANIZATION_EFFORT?: string;
    /**
     * Optional single-model serving model: claude-opus-5 | claude-sonnet-5 |
     * claude-haiku-4-5. Unset keeps the provider default (claude-opus-5); an
     * unrecognised value fails closed to deterministic with a logged reason.
     */
    HUMANIZATION_MODEL?: string;
    /** Set to `production`, `development`, `local`, or `test`. */
    ENVIRONMENT?: string;
  }
}
