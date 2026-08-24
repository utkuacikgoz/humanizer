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
  } catch {
    return {
      available: false,
      signInRequired: true,
      message: "Checkout is temporarily unavailable. Your preview is still yours to review.",
    };
  }
}
