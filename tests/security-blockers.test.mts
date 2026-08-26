// Regression tests for the blockers in docs/SECURITY.md's 2026-08-24
// pre-launch review. Each asserts the specific behavior that was exploitable.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { MIN_HIDDEN_WORDS, projectPreview, shouldOfferUnlock } from "../src/lib/preview-projection";
import { isTrustedIdentityHost, readSessionCookie, DEV_SESSION_COOKIE, SESSION_COOKIE } from "../src/lib/identity";

function words(count: number) {
  return Array.from({ length: count }, (_, i) => `word${i}`).join(" ");
}

// SEC-02 — the paywall must withhold a meaningful amount or not exist.
// Previously a Math.max(8, …) floor returned any rewrite of <=8 words in
// full while the UI still rendered a purchase CTA over it.

test("SEC-02: a rewrite too short to withhold anything is not paywallable", () => {
  const split = projectPreview(words(7));
  assert.equal(split.paywallable, false);
  assert.equal(split.preview, "");
  assert.equal(split.hiddenWordCount, 0);
});

test("SEC-02: the preview never contains the entire rewrite", () => {
  // The old floor exposed every word at these lengths.
  for (const length of [1, 2, 5, 8, 9, 12, 15, 20]) {
    const rewrite = words(length);
    const split = projectPreview(rewrite);
    if (split.paywallable) {
      assert.ok(
        split.preview.split(/\s+/).length < length,
        `preview exposed all ${length} words`,
      );
      assert.ok(split.hiddenWordCount >= MIN_HIDDEN_WORDS, `withheld only ${split.hiddenWordCount} of ${length}`);
    } else {
      assert.equal(split.preview, "", `non-paywallable result still leaked a preview at ${length} words`);
    }
  }
});

test("SEC-02: a paywallable rewrite withholds at least the minimum", () => {
  const split = projectPreview(`${words(80)}. ${words(120)}.`);
  assert.equal(split.paywallable, true);
  assert.ok(split.hiddenWordCount >= MIN_HIDDEN_WORDS);
  assert.ok(split.preview.length > 0);
});

test("SEC-02: hidden count plus visible count equals the whole rewrite", () => {
  const rewrite = `${words(40)}. ${words(60)}.`;
  const split = projectPreview(rewrite);
  assert.equal(split.preview.split(/\s+/).length + split.hiddenWordCount, 100);
});

test("ACT-05: a paywallable preview ends at the last complete sentence inside its safe budget", () => {
  const first = "Clear writing helps every reader understand the important point quickly.";
  const second = "A careful editor also removes vague filler and keeps each supporting detail precise.";
  const third = "The complete rewrite still contains enough additional material to make the locked remainder meaningful for a paying customer.";
  const split = projectPreview(`${first} ${second} ${third}`);

  assert.equal(split.paywallable, true);
  assert.equal(split.preview, first);
  assert.match(split.preview, /[.!?]$/);
  assert.ok(split.hiddenWordCount >= MIN_HIDDEN_WORDS);
});

test("ACT-05: sentence-boundary projection preserves original punctuation and whitespace within the visible sentence", () => {
  const first = "A careful rewrite keeps 2026 figures, names, and deliberate punctuation intact!";
  const remainder = "The rest of this rewritten passage contains several more useful details for readers who decide to unlock the complete result today.";
  const split = projectPreview(`  ${first}\n\n${remainder}`);

  assert.equal(split.paywallable, true);
  assert.equal(split.preview, first);
  assert.ok(split.hiddenWordCount >= MIN_HIDDEN_WORDS);
});

test("ACT-05: no preview is exposed when the first complete sentence exceeds the safe visible budget", () => {
  const longFirstSentence = `${words(35)}.`;
  const shortSecondSentence = `${words(15)}.`;
  const split = projectPreview(`${longFirstSentence} ${shortSecondSentence}`);

  assert.deepEqual(split, { preview: "", hiddenWordCount: 0, paywallable: false });
});

test("ACT-05: an unterminated prefix is never presented as a complete-sentence preview", () => {
  const split = projectPreview(words(100));
  assert.deepEqual(split, { preview: "", hiddenWordCount: 0, paywallable: false });
});

test("SEC-02: chunking a document into minimum-length windows never reconstructs it", () => {
  // The original attack: split a document into ~12-word windows, submit
  // each, concatenate the previews. Every window must now be unsellable
  // rather than returned whole.
  // Windows this short are rejected at input validation now, but the
  // projection must independently refuse them too — defense in depth, so a
  // future caller that skips validation still cannot leak a rewrite.
  const windows = Array.from({ length: 10 }, () => words(15));
  const recovered = windows.map((w) => projectPreview(w)).filter((s) => s.paywallable || s.preview);
  assert.equal(recovered.length, 0, "chunked windows still yielded preview text");
});

test("SEC-02: empty or whitespace-only input is not paywallable", () => {
  for (const input of ["", "   ", "\n\t "]) {
    const split = projectPreview(input);
    assert.equal(split.paywallable, false);
    assert.equal(split.hiddenWordCount, 0);
  }
});

// SEC-01 / SEC-07 — deploy-configuration guards. These assert against the
// build config source, because the failure mode is a misconfigured deploy
// rather than a runtime branch.

test("SEC-01: the workers.dev origin stays disabled", () => {
  const config = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.match(
    config,
    /workers_dev:\s*false/,
    "workers_dev must stay false: that origin bypasses the hosting boundary that injects the identity headers, leaving the app with no authentication at all",
  );
});

test("SEC-07: migrations point at the directory drizzle-kit actually writes to", () => {
  const config = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.match(config, /migrations_dir:\s*"drizzle"/);
});

test("every secret the Worker needs survives a deploy", () => {
  // `wrangler deploy --secrets-file` REPLACES the Worker's entire secret set.
  // A secret the code reads but the workflow does not write is not merely
  // unset on a new environment — it is deleted from the running one on the
  // next deploy. RESEND_API_KEY gates sign-in, and sign-in gates every
  // purchase, so its absence would take the product offline commercially.
  const workflow = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  for (const secret of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_STARTER", "STRIPE_PRICE_PRO", "PREVIEW_GUARD_SECRET", "RESEND_API_KEY", "ANTHROPIC_API_KEY"]) {
    assert.match(workflow, new RegExp(`"${secret}=\\$${secret}"`), `${secret} must be written into the secrets file`);
    assert.match(workflow, new RegExp(`env\\.${secret} != ''`), `${secret} must gate the deploy`);
    assert.match(workflow, new RegExp(`env\\.${secret} == ''`), `${secret} must fail the "not configured" check`);
  }
});

// SEC-01 — the host gate. It began as containment for forgeable identity
// headers; those are gone, and it now contains the session cookie: a real
// session presented on an origin this app does not claim is not read at all.

test("SEC-01: a session cookie is not read off the production host", () => {
  const cookie = `${SESSION_COOKIE}=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
  for (const host of ["ownword.pro.workers.dev", "humanizer.workers.dev", "evil.test", ""]) {
    const headers = new Headers({ cookie, ...(host ? { host } : {}) });
    assert.equal(isTrustedIdentityHost(headers), false, `${host || "(no host)"} must not be trusted`);
    assert.equal(readSessionCookie(headers), null, `${host || "(no host)"} must resolve no session`);
  }
});

test("SEC-01: the production host and localhost do read the session cookie", () => {
  const value = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  for (const host of ["ownword.pro", "www.ownword.pro", "OWNWORD.PRO", "ownword.pro:443", "localhost:3000"]) {
    const headers = new Headers({ host, cookie: `${SESSION_COOKIE}=${value}` });
    assert.equal(isTrustedIdentityHost(headers), true, `${host} should be trusted`);
    assert.equal(readSessionCookie(headers), value);
  }
});

test("SEC-01: the unprefixed dev cookie name is never honored in production", () => {
  // `__Host-` is what makes a subdomain unable to plant a session for the
  // apex. The unprefixed fallback exists only because Secure cookies are not
  // set over plain http, and it must therefore never be read off a dev host.
  const value = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const production = new Headers({ host: "ownword.pro", cookie: `${DEV_SESSION_COOKIE}=${value}` });
  assert.equal(readSessionCookie(production), null);

  const development = new Headers({ host: "localhost:3000", cookie: `${DEV_SESSION_COOKIE}=${value}` });
  assert.equal(readSessionCookie(development), value);
});

// KI-01 — measured improvement and material change must agree before
// anything is sold.

test("KI-01: a rewrite measured at zero improvements is never sold", () => {
  assert.equal(shouldOfferUnlock({ preview: "a real preview", hiddenWordCount: 40, issuesImproved: 0 }), false);
  assert.equal(shouldOfferUnlock({ preview: "a real preview", hiddenWordCount: 40 }), false);
});

test("KI-01: a genuine rewrite with measured improvements is still sellable", () => {
  assert.equal(shouldOfferUnlock({ preview: "a real preview", hiddenWordCount: 40, issuesImproved: 3 }), true);
});
