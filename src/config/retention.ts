// How long a preview stays reachable, in one place.
//
// The capability token minted with an anonymous preview is what lets a
// visitor come back to their half read rewrite, so its lifetime is both an
// enforced value (db/repository.ts stamps `capability_expires_at` from it)
// and a customer-facing claim: /privacy states it, and the pricing band
// states it as the one real deadline in the purchase decision.
//
// docs/ACTIVATION.md forbids fabricated urgency. A true deadline is only
// usable as one while the number on screen is the number the database
// enforces, which is what this module exists to guarantee. Two copies of it
// would drift, and the drifted copy would be the invented scarcity the rule
// is about.
export const PREVIEW_LINK_TTL_MS = 24 * 60 * 60 * 1000;

/** The same lifetime in whole hours, for copy that has to say it out loud. */
export const PREVIEW_LINK_TTL_HOURS = PREVIEW_LINK_TTL_MS / (60 * 60 * 1000);
