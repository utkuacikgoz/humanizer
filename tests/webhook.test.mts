import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";
import { POST } from "../app/api/webhooks/stripe/route";

function request(body: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/webhooks/stripe", { method: "POST", headers, body });
}

test("rejects a request with no stripe-signature header", async () => {
  const response = await POST(request("{}"));
  assert.equal(response.status, 400);
});

test(
  "returns a retryable 500 (not a silent 200) when Stripe/D1 are unconfigured",
  async () => {
    // Under plain Node (this test file), db/stripe-client.ts's
    // `cloudflare:workers` import can't resolve regardless of whether a
    // signature looks well-formed — this proves the route fails closed
    // (retryable) rather than silently acking, matching the "unsupported
    // events fail safely" and "transient processing failures remain
    // retryable" rules in docs/MONETIZATION.md.
    const response = await POST(request("{}", { "stripe-signature": "t=1,v1=deadbeef" }));
    assert.equal(response.status, 500);
  },
);

// The route resolves Stripe config (which needs `cloudflare:workers`,
// unavailable here) before verifying a signature, so the route-level
// tests above can't exercise real signature verification without masking
// it behind the config-unavailable path. This tests the exact Stripe SDK
// call the route makes — same method, same argument order, same async
// variant — in isolation, using a throwaway client that needs no env at
// all (webhook verification is pure local HMAC, no network call).
test("Stripe webhook signature verification: accepts a validly-signed payload and rejects a tampered one", async () => {
  const stripe = new Stripe("sk_test_dummy_key_not_a_real_secret", { httpClient: Stripe.createFetchHttpClient() });
  const secret = "whsec_test_dummy_secret_for_local_verification_only";
  const payload = JSON.stringify({ id: "evt_test_1", object: "event", type: "customer.subscription.updated", created: Math.floor(Date.now() / 1000), data: { object: { id: "sub_test_1" } } });

  const validHeader = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret });
  const event = await stripe.webhooks.constructEventAsync(payload, validHeader, secret);
  assert.equal(event.id, "evt_test_1");
  assert.equal(event.type, "customer.subscription.updated");

  await assert.rejects(() => stripe.webhooks.constructEventAsync(payload, validHeader, "whsec_a_completely_different_secret"));

  const tamperedPayload = payload.replace("sub_test_1", "sub_attacker_controlled");
  await assert.rejects(() => stripe.webhooks.constructEventAsync(tamperedPayload, validHeader, secret));
});
