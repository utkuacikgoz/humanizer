// The Workers-runtime-bound half of magic-link sign-in.
//
// Everything that needs `cloudflare:workers` or the D1 binding is behind a
// lazy `await import(...)` called from inside a handler, because both of
// those crash at import time under plain Node — which is what
// tests/magic-link.test.mts runs under. src/lib/magic-link.ts holds the
// actual flow and knows nothing about any of this.
import { productConfig } from "@/src/config/product";
import { createResendSender, type EmailSender } from "@/src/lib/email-sender";
import type { MagicLinkDeps } from "@/src/lib/magic-link";

/**
 * The envelope sender. `AUTH_EMAIL_FROM` overrides it; the default is derived
 * from the configured domain so there is one less thing to set, and so it
 * cannot drift from the brand.
 *
 * Whatever it is, the domain must be verified with the mail provider or every
 * send fails — see README's operator notes.
 */
function senderAddress(runtime: Record<string, string | undefined>): string {
  const configured = runtime.AUTH_EMAIL_FROM?.trim();
  if (configured) return configured;
  return `${productConfig.productName} <no-reply@${productConfig.domain.trim().toLowerCase()}>`;
}

/**
 * Resolves the mail sender, or null when nothing is configured.
 *
 * Null is not a silent no-op: src/lib/magic-link.ts turns it into a 503 and a
 * console.error naming the missing secret, so an operator watching
 * `wrangler tail` sees exactly why nobody can sign in.
 */
function resolveSender(runtime: Record<string, string | undefined>): EmailSender | null {
  const apiKey = runtime.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  return createResendSender({ apiKey, from: senderAddress(runtime) });
}

export async function loadMagicLinkDeps(): Promise<MagicLinkDeps> {
  const [{ getDb }, auth] = await Promise.all([
    import("../../../db/index"),
    import("../../../db/auth-repository"),
  ]);

  let runtime: Record<string, string | undefined> = {};
  try {
    const { env } = await import("cloudflare:workers");
    runtime = env as unknown as Record<string, string | undefined>;
  } catch {
    // Plain Node (route-level tests) has no `cloudflare:workers` module. No
    // secrets means no sender, which fails closed.
  }

  return { db: getDb(), auth, sender: resolveSender(runtime), from: senderAddress(runtime) };
}
