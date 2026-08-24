export type BillingReadiness =
  | {
      available: true;
      signInRequired: true;
      message: string;
    }
  | {
      available: false;
      signInRequired: true;
      message: string;
    };

/**
 * Converts a server-side readiness probe into the only public states the
 * landing page needs. Configuration details stay private and every failure
 * closes checkout instead of leaving a button that cannot complete.
 */
export async function resolveBillingReadiness(probe: () => Promise<void>): Promise<BillingReadiness> {
  try {
    await probe();
    return {
      available: true,
      signInRequired: true,
      message: "You will sign in with ChatGPT before checkout.",
    };
  } catch (error) {
    // The customer-facing message stays deliberately generic — which check
    // failed is configuration detail and must not be published. But an
    // operator staring at a disabled button needs to know WHY, so the reason
    // goes to the Worker log where `wrangler tail` can see it and the browser
    // cannot. Only the error name and message: never the secret values, and
    // never the full error, whose cause chain can carry request details.
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error("[billing-readiness] checkout is closed:", reason);
    return {
      available: false,
      signInRequired: true,
      message: "Checkout is temporarily unavailable. Your preview is still yours to review.",
    };
  }
}
