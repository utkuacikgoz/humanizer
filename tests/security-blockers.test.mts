// Regression tests for the blockers in docs/SECURITY.md's 2026-08-24
// pre-launch review. Each asserts the specific behavior that was exploitable.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { MIN_HIDDEN_WORDS, projectPreview, shouldOfferUnlock } from "../src/lib/preview-projection";
import { isTrustedIdentityHost, resolveChatGPTUserFromHeaders } from "../src/lib/chatgpt-identity";

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
  const split = projectPreview(words(200));
  assert.equal(split.paywallable, true);
  assert.ok(split.hiddenWordCount >= MIN_HIDDEN_WORDS);
  assert.ok(split.preview.length > 0);
});

test("SEC-02: hidden count plus visible count equals the whole rewrite", () => {
  const split = projectPreview(words(100));
  assert.equal(split.preview.split(/\s+/).length + split.hiddenWordCount, 100);
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

// SEC-01 — identity headers are only honored on the trusted production
// host. Off it (a *.workers.dev URL, a preview alias) the caller is
// anonymous, so a forged user id buys nothing.

test("SEC-01: forged identity headers are ignored off the production host", () => {
  const forged = {
    "oai-authenticated-user-id": "victim-subject-9001",
    "oai-authenticated-user-email": "attacker@evil.test",
  };
  for (const host of ["ownword.pro.workers.dev", "humanizer.workers.dev", "evil.test", ""]) {
    const headers = new Headers({ ...forged, ...(host ? { host } : {}) });
    assert.equal(isTrustedIdentityHost(headers), false, `${host || "(no host)"} must not be trusted`);
    assert.equal(resolveChatGPTUserFromHeaders(headers), null, `${host || "(no host)"} must resolve no identity`);
  }
});

test("SEC-01: the production host and localhost still resolve identity", () => {
  for (const host of ["ownword.pro", "www.ownword.pro", "OWNWORD.PRO", "ownword.pro:443", "localhost:3000"]) {
    const headers = new Headers({
      host,
      "oai-authenticated-user-id": "real-subject",
      "oai-authenticated-user-email": "person@example.com",
    });
    assert.equal(isTrustedIdentityHost(headers), true, `${host} should be trusted`);
    assert.equal(resolveChatGPTUserFromHeaders(headers)?.userId, "real-subject");
  }
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
