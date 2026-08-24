// Failure paths, driven through the real UI.
//
// Server-shaped failures (429, 503, 504, 422) are injected at the network
// layer rather than provoked for real, because provoking a rate limit against
// a shared dev server makes every other test in the suite flaky and leaves the
// limiter primed for the next run. The real limiter is exercised once, in its
// own test, against a client identity nothing else uses.
//
// What is asserted is the same for every failure: the visitor is told
// something they can act on, never a developer's error string, and the
// workspace stays usable so they can retry.
import assert from "node:assert/strict";
import test from "node:test";
import {
  BASE_URL,
  closeBrowser,
  draftInput,
  environmentBlocker,
  errorMessage,
  gotoHydrated,
  openSession,
  resultHeading,
  resultRegion,
  submitButton,
} from "./helpers/harness.mts";
import { REWRITABLE_DRAFT } from "./helpers/fixtures.mts";

const blocker = await environmentBlocker();

/** A message a person can act on: no stack noise, no parser output, not empty. */
const DEVELOPER_NOISE = /\bundefined\b|\[object |TypeError|SyntaxError|Unexpected token|Failed to fetch|NetworkError|JSON\.parse|is not valid JSON/i;

const INJECTED_FAILURES = [
  {
    name: "429 rate limited",
    fulfill: {
      status: 429,
      contentType: "application/json",
      headers: { "retry-after": "60" },
      body: JSON.stringify({ error: "Too many previews were requested. Please wait a moment and try again." }),
    },
  },
  {
    name: "503 service unavailable",
    fulfill: {
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "This is temporarily unavailable. Please try again shortly." }),
    },
  },
  {
    name: "504 preview deadline",
    fulfill: {
      status: 504,
      contentType: "application/json",
      body: JSON.stringify({ error: "The preview took too long. No usage was charged; please try again." }),
    },
  },
  {
    name: "422 verification failure",
    fulfill: {
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ error: "We could not verify this rewrite without changing the meaning. No usage was charged." }),
    },
  },
] as const;

for (const failure of INJECTED_FAILURES) {
  test(`${failure.name} is reported in terms the visitor can act on`, { skip: blocker ?? false }, async (t) => {
    t.after(closeBrowser);
    const session = await openSession();
    t.after(() => session.close());
    const { page } = session;
    await gotoHydrated(page, "/");

    await page.route("**/api/humanize", (route) => route.fulfill(failure.fulfill));
    await draftInput(page).fill(REWRITABLE_DRAFT);
    await submitButton(page).click();
    await errorMessage(page).waitFor({ timeout: 15_000 });

    const message = (await errorMessage(page).innerText()).trim();
    assert.ok(message.length > 0, "no message was shown");
    assert.ok(!DEVELOPER_NOISE.test(message), `developer-facing message shown: ${JSON.stringify(message)}`);
    assert.equal(
      await errorMessage(page).getAttribute("role"),
      "alert",
      "the failure must be exposed through an assertive live region",
    );
    assert.equal(await resultRegion(page).count(), 0, "a failed request rendered a result region");

    // The workspace stays usable and the visitor can recover.
    assert.equal(await submitButton(page).getAttribute("aria-disabled"), "false", "the submit control stayed blocked after a failure");
    await page.unroute("**/api/humanize");
    await draftInput(page).fill(`${REWRITABLE_DRAFT} A second attempt after the failure.`);
    await submitButton(page).click();
    await resultHeading(page).waitFor({ timeout: 20_000 });
    assert.deepEqual(session.pageErrors, []);
  });
}

test("a non-JSON server error is not surfaced as a parser message", { skip: blocker ?? false }, async (t) => {
  // KNOWN FAILURE, reported by MQA. The client parses the response body before
  // checking `response.ok`, and its catch block forwards whatever `Error`
  // reaches it. An edge or proxy 5xx returns an HTML error page, so the
  // visitor is shown: Unexpected token '<', "<html><bod"... is not valid JSON.
  // That is the single most likely production failure mode and it produces the
  // least usable message in the product.
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;
  await gotoHydrated(page, "/");

  await page.route("**/api/humanize", (route) =>
    route.fulfill({ status: 502, contentType: "text/html", body: "<html><body>Bad Gateway</body></html>" }),
  );
  await draftInput(page).fill(REWRITABLE_DRAFT);
  await submitButton(page).click();
  await errorMessage(page).waitFor({ timeout: 15_000 });

  const message = (await errorMessage(page).innerText()).trim();
  assert.ok(!DEVELOPER_NOISE.test(message), `developer-facing message shown for an HTML 502: ${JSON.stringify(message)}`);
});

test("a dropped connection is not surfaced as a browser internal", { skip: blocker ?? false }, async (t) => {
  // KNOWN FAILURE, reported by MQA. Same root cause: an offline or dropped
  // request rejects with TypeError: Failed to fetch, and that string is put on
  // screen verbatim. docs/QA.md's manual charter names offline-transition and
  // interrupted networks explicitly.
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;
  await gotoHydrated(page, "/");

  await page.route("**/api/humanize", (route) => route.abort("failed"));
  await draftInput(page).fill(REWRITABLE_DRAFT);
  await submitButton(page).click();
  await errorMessage(page).waitFor({ timeout: 15_000 });

  const message = (await errorMessage(page).innerText()).trim();
  assert.ok(!DEVELOPER_NOISE.test(message), `developer-facing message shown for a dropped request: ${JSON.stringify(message)}`);
});

test("the real preview rate limiter refuses the burst and says how long to wait", { skip: blocker ?? false }, async (t) => {
  // The only test that provokes the genuine guard
  // (src/lib/preview-request-guard.ts: 12 requests / 60s per client). It runs
  // against a client IP nothing else in the suite uses, so it cannot spend
  // another test's budget, and it goes through fetch from inside the page so
  // the request carries the same identity the UI would.
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;
  await gotoHydrated(page, "/");

  const outcomes = (await page.evaluate(
    `(async () => {
       const out = [];
       for (let i = 0; i < 15; i += 1) {
         const key = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, "0")).join("");
         const response = await fetch("/api/humanize", {
           method: "POST",
           headers: { "content-type": "application/json", "x-idempotency-key": key },
           body: JSON.stringify({ text: ${JSON.stringify(REWRITABLE_DRAFT)} + " Burst " + i + ".", mode: "natural" }),
         });
         const body = await response.json().catch(() => ({}));
         out.push({ status: response.status, retryAfter: response.headers.get("retry-after"), error: body.error ?? null });
         if (response.status === 429) break;
       }
       return out;
     })()`,
  )) as Array<{ status: number; retryAfter: string | null; error: string | null }>;

  const limited = outcomes.find((outcome) => outcome.status === 429);
  assert.ok(limited, `the burst was never rate limited: ${JSON.stringify(outcomes.map((o) => o.status))}`);
  assert.ok(limited.retryAfter && Number(limited.retryAfter) > 0, "a 429 must carry a positive Retry-After");
  assert.ok(limited.error && limited.error.length > 0, "a 429 must carry an explanation");
  assert.ok(!DEVELOPER_NOISE.test(limited.error), `the 429 body is developer-facing: ${JSON.stringify(limited.error)}`);
  t.diagnostic(`limited after ${outcomes.length - 1} accepted previews, retry-after ${limited.retryAfter}s`);
});

test("the post-purchase page never parks the customer on a status that cannot resolve", { skip: blocker ?? false }, async (t) => {
  // KNOWN FAILURE, reported by MQA. /checkout/success reads the job id from
  // the query string and returns early when it is absent, so the polling
  // effect never starts. A customer who lands there without the parameter —
  // a link copied without its query string, a referrer-stripping redirect, a
  // bookmark — sits on "Confirming your payment" with a spinner, forever,
  // with zero network activity and no way forward. Verified holding for 30s.
  t.after(closeBrowser);
  const session = await openSession();
  t.after(() => session.close());
  const { page } = session;

  const resultCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/result")) resultCalls.push(request.url());
  });

  await page.goto(`${BASE_URL}/checkout/success`, { waitUntil: "domcontentloaded" });
  const heading = page.locator("#checkout-status-title, h2").first();
  await heading.waitFor({ timeout: 15_000 });
  const initial = (await heading.innerText()).trim();
  await page.waitForTimeout(8_000);
  const settled = (await heading.innerText()).trim();

  const stuck = settled === initial && resultCalls.length === 0;
  assert.ok(
    !stuck,
    `the page stayed on ${JSON.stringify(settled)} for 8s with no attempt to resolve it. ` +
      "A post-purchase page with a missing job reference must reach a terminal, actionable state.",
  );
});
