import assert from "node:assert/strict";
import test from "node:test";
import { ANALYTICS_EVENTS } from "../src/lib/analytics";

test("defines the complete privacy-safe V1 funnel vocabulary", () => {
  assert.deepEqual(ANALYTICS_EVENTS, [
    "landing_view",
    "text_pasted",
    "humanization_started",
    "humanization_completed",
    "preview_viewed",
    "checkout_started",
    "checkout_completed",
    "full_result_unlocked",
    "result_copied",
    "second_humanization",
    "subscription_cancelled",
  ]);
});
