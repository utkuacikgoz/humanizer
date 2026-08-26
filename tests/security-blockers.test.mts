// Regression tests for the blockers in docs/SECURITY.md's 2026-08-24
// pre-launch review. Each asserts the specific behavior that was exploitable.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { MIN_HIDDEN_WORDS, projectPreview, shouldOfferUnlock } from "../src/lib/preview-projection";
import { isTrustedIdentityHost, readSessionCookie, safeRelativeReturnPath, DEV_SESSION_COOKIE, SESSION_COOKIE } from "../src/lib/identity";

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
  for (const secret of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_STARTER", "PREVIEW_GUARD_SECRET", "RESEND_API_KEY"]) {
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

// SEC-21 — /signin re-implemented the return_to guard, and the copy was
// weaker than the original. The page's result is rendered directly as
// `<Link href={returnTo}>Continue</Link>`, a hop the server never sees, so
// "the server re-checks it" was not a defence.

/** Every value proven to survive the page's old `startsWith("/") && !startsWith("//")`. */
const PROVEN_RETURN_TO_BYPASSES = ["/\\evil.test", "/\t/evil.test", "/\n/evil.test", "/\\\\evil.test"];

test("SEC-21: every proven bypass resolves to another origin, which is why the old check was wrong", () => {
  // The premise, restated as a test so nobody "simplifies" the guard back.
  for (const value of PROVEN_RETURN_TO_BYPASSES) {
    assert.equal(value.startsWith("/") && !value.startsWith("//"), true, `${JSON.stringify(value)} passed the old check`);
    assert.equal(new URL(value, "https://ownword.pro").origin, "https://evil.test", `${JSON.stringify(value)} left the origin`);
  }
});

test("SEC-21: the one canonical guard refuses all of them", () => {
  for (const value of PROVEN_RETURN_TO_BYPASSES) {
    assert.equal(safeRelativeReturnPath(value), "/", `${JSON.stringify(value)} must not survive`);
  }
});

test("SEC-21: the sign-in page uses the canonical guard rather than a second copy of it", async () => {
  const page = await readFile(new URL("../app/signin/page.tsx", import.meta.url), "utf8");

  assert.match(
    page,
    /import\s*\{[^}]*\bsafeRelativeReturnPath\b[^}]*\}\s*from\s*"@\/src\/lib\/identity"/,
    "the page must call the server's guard",
  );
  // The specific shape of the weaker copy, in code rather than in prose.
  const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(
    code,
    /startsWith\(\s*"\/\/"\s*\)/,
    "a local protocol-relative check is the re-implementation this finding was about",
  );
  // And the value it renders is the guarded one, not the raw query parameter.
  assert.match(code, /href=\{returnTo\}/);
  assert.match(code, /safeReturnTo\s*=\s*\(value: string \| null\)/);
});

// SEC-17, aggravating factor — no surface outside /signin showed which
// account was signed in, so a victim pushed into someone else's session had
// no signal anywhere they actually work, and return_to let the attacker
// choose which page they landed on.

const SIGNED_IN_SURFACES = ["../app/page.tsx", "../app/history/page.tsx", "../app/checkout/success/page.tsx"];

test("SEC-17: every signed-in surface names the account and offers a way out", async () => {
  for (const path of SIGNED_IN_SURFACES) {
    const page = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(page, /<AccountIndicator\b/, `${path} must show which account is signed in`);
    assert.match(
      page,
      /import\s*\{[^}]*\bAccountIndicator\b[^}]*\}\s*from\s*"@\/src\/components\/account-indicator"/,
      `${path} must import the shared indicator rather than roll its own`,
    );
  }
});

test("SEC-17: the indicator shows the address itself, not a label that is true in any session", async () => {
  const component = await readFile(new URL("../src/components/account-indicator.tsx", import.meta.url), "utf8");
  const code = component.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // The address, because "Account" reads identically in the attacker's
  // session and the customer's. This is the documented deviation from
  // docs/SIGNED-IN.md's open decision O-1.
  assert.match(code, /\{session\.email\}/, "the indicator must render the address");
  // A route out, in the same glance, as a POST that a third-party page cannot
  // trigger.
  assert.match(code, /action="\/api\/auth\/signout"\s+method="post"/);
  assert.doesNotMatch(code, /\bdisabled(?![A-Za-z])/, "no focusable control may take the native disabled attribute");
  // It must not claim an identity before the server has confirmed one.
  assert.match(code, /session\.kind !== "signed-in"/);
});

test("SEC-17: the indicator survives the mobile header, where an emailed link is opened", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("../src/components/account-indicator.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  // `nav a:not(.sign-in) { display: none }` at 760px is still in force, so
  // the indicator must not be a nav link.
  const mobile = css.slice(css.indexOf("@media (max-width: 760px)"));
  assert.match(mobile, /nav a:not\(\.sign-in\)\s*\{\s*display:\s*none/, "the rule this has to survive is still there");
  assert.match(component, /<div className="account-indicator">/, "the indicator must not be a nav link");
  assert.match(mobile, /\.account-indicator\s*\{/, "the mobile header must lay the indicator out explicitly");

  // And it is never cut short: a truncated address answers the question badly.
  assert.match(css, /\.account-address\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(css, /\.account-address\s*\{[^}]*text-overflow:\s*ellipsis/);
});
