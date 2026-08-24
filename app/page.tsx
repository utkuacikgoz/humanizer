"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MODES, productConfig } from "@/src/config/product";
import { pricingConfig } from "@/src/config/pricing";
import { SAMPLE_TEXT } from "@/src/config/sample";
import { track } from "@/src/lib/analytics";
import type { BillingReadiness } from "@/src/lib/billing-readiness";
import { improvementLabel, MIN_PAYWALLABLE_INPUT_WORDS, shouldOfferUnlock } from "@/src/lib/preview-projection";
import { subscriptionDisclosure } from "@/src/lib/subscription-disclosure";
import { ManageBilling } from "@/src/components/manage-billing";
import { MarkedText, describeMarks, diffRewrite, selectDisplayFacts } from "@/src/components/rewrite-marks";

type Mode = (typeof MODES)[number]["id"];
type UsageQuota = { consumed: number; allowance: number; remaining: number; periodEnd: string };
type UsageSummary = UsageQuota & { paidUseCount: number };
type PreviewResult = {
  original: string;
  unchanged?: false;
  preview: string;
  hiddenWordCount: number;
  issuesImproved: number;
  naturalness: "Strong" | "Good";
  meaningPreservation: "High" | "Review needed";
  protectedItems: string[];
  capability?: string;
  capabilityExpiresAt?: string;
};
type PaidResult = {
  original: string;
  unchanged?: false;
  result: string;
  paid: true;
  issuesImproved: number;
  naturalness: "Strong" | "Good";
  meaningPreservation: "High" | "Review needed";
  protectedItems: string[];
  usage: UsageSummary;
};
/**
 * ACT-01. The server's terminal "nothing was rewritten" outcome. It
 * carries no preview, no hidden-word count and no capability by
 * construction, so the union makes it a type error to render a price,
 * a lock, or an improvement count against it.
 */
type UnchangedResult = { original: string; unchanged: true };
type Result = PreviewResult | PaidResult | UnchangedResult;

function isPaidResult(result: Result): result is PaidResult {
  return "paid" in result && result.paid === true;
}

class UserFacingRequestError extends Error {}

async function readJsonResponse<T extends object>(response: Response): Promise<Partial<T>> {
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) return {};
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" ? value as Partial<T> : {};
  } catch {
    return {};
  }
}

const starterPlan = pricingConfig.plans.starter;

const MAX_FACT_CHIPS = 6;

function countWords(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

/* Line-drawn marks rather than emoji: emoji render as a different
   typeface at a different weight on every platform, and they cannot take
   the palette. These inherit `currentColor` and the type's optical size. */
function IconCheck() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.6 8.4 6.2 12l7.2-8" />
    </svg>
  );
}
function IconArrow() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12 12 4M5.6 4H12v6.4" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.8 13.2 4v4c0 3.1-2.1 5.3-5.2 6.2C4.9 13.3 2.8 11.1 2.8 8V4Z" />
      <path d="M5.9 8.1 7.4 9.6l2.9-3.2" />
    </svg>
  );
}
function IconLock() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.2" y="7" width="9.6" height="7" rx="2" />
      <path d="M5.6 7V4.9a2.4 2.4 0 0 1 4.8 0V7" />
    </svg>
  );
}

export default function Home() {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("natural");
  const [resultMode, setResultMode] = useState<Mode>("natural");
  const [result, setResult] = useState<Result | null>(null);
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [error, setError] = useState("");
  const [unlockStatus, setUnlockStatus] = useState<"idle" | "working" | "error">("idle");
  const [unlockError, setUnlockError] = useState("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [billingReadiness, setBillingReadiness] = useState<BillingReadiness | null>(null);
  const [notice, setNotice] = useState("");
  const hasTrackedText = useRef(false);
  const completedCount = useRef(0);
  const submissionInFlight = useRef(false);
  const idempotency = useRef<{ request: string; key: string } | null>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const wordCount = useMemo(() => countWords(text), [text]);

  // The AHA surface (docs/ACTIVATION.md §1): what changed, and what was
  // held still. Computed here from the original and the *exposed*
  // preview only, so no segment can carry text the server withheld.
  const marks = useMemo(() => {
    if (!result || result.unchanged) return null;
    return {
      ...diffRewrite(result.original, isPaidResult(result) ? result.result : result.preview),
      facts: selectDisplayFacts(result.protectedItems, result.original),
    };
  }, [result]);

  // Focus the result heading once a rewrite lands, instead of only
  // scrolling it into view: a native `disabled` button drops keyboard
  // focus to <body> when it becomes disabled (browsers force this), which
  // silently strands keyboard/screen-reader users with no landmark. This
  // routes focus explicitly to where the result actually appears.
  useEffect(() => {
    if (!result) return;
    resultHeadingRef.current?.focus();
  }, [result]);

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: productConfig.productName,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: "A writing tool that puts meaning first and turns generic AI assisted drafts into natural writing.",
    ...(productConfig.billingEnabled ? {
      offers: {
        "@type": "Offer",
        price: String(pricingConfig.plans.starter.monthlyPrice),
        priceCurrency: pricingConfig.currency.toUpperCase(),
        category: "subscription",
      },
    } : {}),
  };

  // Hydration marker. `motion-ready` no longer gates any animation. The
  // scroll reveal it was built for is gone, but it remains the documented
  // "this page is interactive" signal every automated check waits on
  // (tests/e2e/helpers/harness.mts), and it is the cheapest honest one:
  // it can only appear once a client effect has actually run.
  useEffect(() => { document.documentElement.classList.add("motion-ready"); }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "canceled") return;
    setNotice("Checkout was canceled. Nothing was charged. Paste your draft again if this page no longer shows the preview.");
    window.history.replaceState(null, "", "/");
  }, []);

  useEffect(() => { track("landing_view"); }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/billing/readiness", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const payload = await readJsonResponse<BillingReadiness>(response);
        if (typeof payload.available !== "boolean" || payload.signInRequired !== true || typeof payload.message !== "string") {
          throw new Error("Invalid billing readiness response");
        }
        setBillingReadiness(payload as BillingReadiness);
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setBillingReadiness({
          available: false,
          signInRequired: true,
          message: "Checkout is temporarily unavailable. Your preview is still yours to review.",
        });
      });
    return () => controller.abort();
  }, []);

  function trySample() {
    if (submissionInFlight.current) return;
    setText(SAMPLE_TEXT);
    setResult(null);
    setError("");
    void humanize({ draft: SAMPLE_TEXT, source: "sample" });
  }

  async function humanize({ draft = text, source = "manual" }: { draft?: string; source?: "manual" | "sample" } = {}) {
    // ACT-12. A ref closes the same-render double-click window that state
    // alone cannot: the sample control loads and submits exactly once.
    if (submissionInFlight.current) return;
    setError("");
    const draftWordCount = countWords(draft);
    // The server enforces MIN_PAYWALLABLE_INPUT_WORDS as a paywall-integrity
    // control (SEC-02). The client used to hardcode 12, so a 12-24 word draft
    // passed this check and came back as a server error the visitor could not
    // have predicted from anything on screen. One source of truth.
    if (draftWordCount < MIN_PAYWALLABLE_INPUT_WORDS) {
      setError(`Add a little more context. At least ${MIN_PAYWALLABLE_INPUT_WORDS} words works best.`);
      return;
    }
    if (draftWordCount > 300) {
      setError("Keep this first pass to 300 words or fewer.");
      return;
    }

    submissionInFlight.current = true;
    setCopyStatus("idle");
    setStatus("working");
    track("humanization_started", { mode, wordCount: draftWordCount, source });
    setResult(null);
    try {
      const requestIdentity = `${mode}\0${draft}`;
      if (idempotency.current?.request !== requestIdentity) {
        idempotency.current = { request: requestIdentity, key: crypto.randomUUID() };
      }
      const response = await fetch("/api/humanize", {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": idempotency.current.key },
        body: JSON.stringify({ text: draft, mode }),
      });
      const payload = await readJsonResponse<Result & { error?: string; usage?: UsageQuota }>(response);
      if (!response.ok) {
        const quotaDetail = response.status === 429 && payload.usage
          ? ` ${payload.usage.remaining.toLocaleString("en-US")} words remain. Your allowance renews on ${new Date(payload.usage.periodEnd).toLocaleDateString()}.`
          : "";
        throw new UserFacingRequestError(`${payload.error ?? "The rewrite could not be completed. Please try again."}${quotaDetail}`);
      }
      if (!("original" in payload)) throw new UserFacingRequestError("The rewrite could not be completed. Please try again.");
      const nextResult = payload as Result;
      setResultMode(mode);
      setResult(nextResult);
      completedCount.current += 1;
      const customerState = !nextResult.unchanged && isPaidResult(nextResult) ? "paid" : "anonymous";
      track("humanization_completed", { mode, wordCount: draftWordCount, issuesImproved: nextResult.unchanged ? 0 : nextResult.issuesImproved, source, customerState });
      if (!nextResult.unchanged && isPaidResult(nextResult)) {
        if (nextResult.usage.paidUseCount === 2) track("second_humanization", { customerState: "paid" });
      } else {
        track("preview_viewed", { mode, source });
        if (completedCount.current === 2) track("repeat_preview", { source: "anonymous_preview" });
      }
    } catch (caught) {
      setError(caught instanceof UserFacingRequestError ? caught.message : "The connection was interrupted. Please check your connection and try again.");
      setStatus("error");
      submissionInFlight.current = false;
      return;
    }
    submissionInFlight.current = false;
    setStatus("idle");
  }

  async function unlock(planId: string) {
    // ACT-01: an unchanged result has no capability and never reaches
    // checkout. This narrows the union as well as guarding reentry.
    if (!result || result.unchanged || isPaidResult(result) || unlockStatus === "working" || !billingReadiness?.available) return;
    setUnlockError("");
    if (!result.capability) {
      setUnlockError("Checkout is temporarily unavailable for this preview. Please try the rewrite again in a moment.");
      setUnlockStatus("error");
      return;
    }
    setUnlockStatus("working");
    track("checkout_started", { planId });
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ capability: result.capability, planId }),
      });
      const payload = await readJsonResponse<{ url?: string; signInPath?: string; error?: string }>(response);
      if (response.status === 401 && payload.signInPath) {
        window.location.href = payload.signInPath;
        return;
      }
      if (!response.ok || !payload.url) throw new UserFacingRequestError(payload.error ?? "Checkout could not be started. Please try again.");
      window.location.href = payload.url;
    } catch (caught) {
      setUnlockError(caught instanceof UserFacingRequestError ? caught.message : "The connection was interrupted. Please check your connection and try again.");
      setUnlockStatus("error");
    }
  }

  async function copyPaidResult() {
    if (!result || result.unchanged || !isPaidResult(result)) return;
    try {
      await navigator.clipboard.writeText(result.result);
      setCopyStatus("copied");
      track("result_copied", { customerState: "paid" });
    } catch {
      setCopyStatus("failed");
    }
  }

  const modeLabel = MODES.find((item) => item.id === resultMode)?.label ?? resultMode;

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
      <header className="site-header">
        <a className="brand" href="#top" aria-label={`${productConfig.productName} home`}>
          <span>{productConfig.productName}</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#pricing">Pricing</a>
          <a className="sign-in" href="/signin-with-chatgpt?return_to=%2F">Sign in</a>
        </nav>
      </header>

      {/* The pitch and the tool share the first screen. The workspace is
          the focal point. The hero sets it up; it does not replace it. */}
      <div className="stage" id="top">
        <section className="hero" aria-labelledby="hero-title">
          <h1 className="reveal-hero d2" id="hero-title">Keep your meaning.<br /><em>Lose the machine tone.</em></h1>
          <p className="hero-copy reveal-hero d3">Turn stiff, generic AI assisted drafts into clear writing that sounds like a person wrote it while keeping the facts intact.</p>
        </section>

        <section className="workspace reveal-hero d4" aria-labelledby="workspace-title">
          <div className="workspace-topline">
            <div>
              <span className="step-number">01</span>
              <h2 id="workspace-title">Paste your text</h2>
            </div>
            <div className="topline-meta">
              {/* Below the minimum the meter counts toward the minimum, not
                  toward the ceiling: the ceiling is not the constraint the
                  visitor is failing, and a bare "8 / 300" reads as plenty. */}
              <p className="word-meter">
                {wordCount < MIN_PAYWALLABLE_INPUT_WORDS ? (
                  <><span className="under">{wordCount}</span> / {MIN_PAYWALLABLE_INPUT_WORDS} words</>
                ) : (
                  <><span className={wordCount > 300 ? "over" : ""}>{wordCount}</span> / 300 words</>
                )}
              </p>
              <button
                className="sample-button"
                type="button"
                aria-disabled={status === "working"}
                onClick={trySample}
              >
                Try an example
              </button>
            </div>
          </div>

          <label className="sr-only" htmlFor="source-text">Text to humanize</label>
          <textarea
            id="source-text"
            value={text}
            onChange={(event) => {
              const nextText = event.target.value;
              setText(nextText);
              setResult(null);
              setError("");
              if (!hasTrackedText.current && nextText.trim()) {
                hasTrackedText.current = true;
                track("text_pasted");
              }
            }}
            placeholder="Paste an AI assisted draft here…"
          />

          <div className="editor-footer">
            <div className="mode-group" role="group" aria-label="Writing mode">
              {MODES.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  aria-pressed={mode === item.id}
                  onClick={() => setMode(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button className="humanize-button" type="button" onClick={() => void humanize()} aria-disabled={status === "working"}>
              {status === "working" ? (
                <>Checking meaning… <span className="dot-loader" aria-hidden="true"><span /><span /><span /></span></>
              ) : (
                <>Humanize <span className="fly-arrow"><IconArrow /></span></>
              )}
            </button>
            {status === "working" ? <div className="progress-track" aria-hidden="true"><div className="progress-fill" /></div> : null}
          </div>
          {status === "working" ? (
            <p className="status-line" role="status">
              <span className="dot-loader" aria-hidden="true"><span /><span /><span /></span> Verifying meaning and protecting your facts…
            </p>
          ) : null}
          {notice ? <p className="status-line" role="status">{notice}</p> : null}
          {error ? <p className="error" role="alert">{error}</p> : null}
        </section>

        <div className="result-announcer" aria-live="polite" aria-atomic="false">
        {result?.unchanged ? (
          // ACT-01. Terminal, honest, and unsellable: no preview, no lock,
          // no improvement count, no price. Nothing here can be paid for,
          // because nothing was withheld.
          <section className="result result-plain" id="result">
            <div className="result-heading">
              <div><span className="step-number">02</span><h2 ref={resultHeadingRef} tabIndex={-1}>No rewrite needed</h2></div>
              <p>Nothing to unlock, and nothing to pay for.</p>
            </div>
            <p className="no-change-note">
              This draft already reads naturally. We found nothing worth rewriting, so we left every word as you wrote it.
              Try another draft, or a different writing mode if you want a change in tone.
            </p>
          </section>
        ) : null}

        {result && !result.unchanged && marks ? (
          <section className="result" id="result">
            <div className="result-heading">
              <div><span className="step-number">02</span><h2 ref={resultHeadingRef} tabIndex={-1}>{isPaidResult(result) ? "Your full rewrite is ready" : "Your rewrite is ready"}</h2></div>
              <p>{isPaidResult(result) ? "This rewrite counts toward your monthly allowance." : "We rewrote the awkward parts and left the meaning alone."}</p>
            </div>
            {/* One ledger line, not three dashboard tiles: these are three
                readings taken on one rewrite, so they read as one row of
                findings. */}
            <div className="checks">
              <article><small>Naturalness</small><strong><IconCheck />{result.naturalness}</strong></article>
              <article><small>Meaning preservation</small><strong><IconCheck />{result.meaningPreservation}</strong></article>
              {/* ACT-02: the measured count, correctly pluralized, and shown
                  only when there is one to report, never a floored or
                  zero badge sitting next to a price. */}
              {result.issuesImproved > 0 ? (
                <article className="warm"><small>Changes</small><strong><IconArrow />{improvementLabel(result.issuesImproved)}</strong></article>
              ) : null}
            </div>
            <div className="comparison">
              <article>
                <div className="panel-label"><span>Original</span><small>{countWords(result.original)} words</small></div>
                <p><MarkedText segments={marks.source} facts={marks.facts} /></p>
                {marks.source.some((segment) => segment.kind === "pending") ? (
                  <p className="panel-note">The dimmed text is where the visible rewrite stops. Nothing there was removed.</p>
                ) : null}
              </article>
              <article className="humanized-panel">
                <div className="panel-label"><span>Humanized</span><small>{isPaidResult(result) ? "complete" : modeLabel}</small></div>
                <p className="sr-only">{describeMarks(marks.result)}</p>
                <p><MarkedText segments={marks.result} facts={marks.facts} /></p>
                {/* The withheld remainder, shown as shape only. It stays
                    inside the panel because it is evidence about *this*
                    rewrite. The offer to buy it does not. */}
                {!isPaidResult(result) && shouldOfferUnlock(result) ? (
                  <div className="locked-copy" aria-hidden="true">
                    {Array.from({ length: Math.min(56, Math.max(10, result.hiddenWordCount)) }, (_, index) => (
                      <span key={index} style={{ width: `${38 + ((index * 17) % 48)}px` }} />
                    ))}
                  </div>
                ) : null}
              </article>
            </div>

            {isPaidResult(result) ? (
              <div className="paid-result-actions">
                <p>{result.usage.remaining.toLocaleString("en-US")} of {result.usage.allowance.toLocaleString("en-US")} words remain this billing period.</p>
                <button type="button" className="copy-result" onClick={() => void copyPaidResult()}>Copy full rewrite</button>
                <p className="copy-status" role="status" aria-live="polite">
                  {copyStatus === "copied" ? "Copied to your clipboard." : copyStatus === "failed" ? "Copy was blocked. Select the text and copy it manually." : ""}
                </p>
              </div>
            ) : null}

            {/* ACT-04 + ACT-08. The marks explain themselves, and the facts
                the product held still are named rather than implied. The
                proof reads first and the key second: which facts survived is
                the claim, the colour key is only how to read it. */}
            <div className="evidence">
              {marks.facts.length ? (
                <div className="protected-note">
                  <b><IconShield /> Held exactly as you wrote them</b>
                  <ul>
                    {marks.facts.slice(0, MAX_FACT_CHIPS).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  {marks.facts.length > MAX_FACT_CHIPS ? (
                    <em>and {marks.facts.length - MAX_FACT_CHIPS} more</em>
                  ) : null}
                </div>
              ) : (
                <div className="protected-note">
                  <b><IconShield /> Nothing to hold</b>
                  <em>This passage has no names, dates, numbers, citations or URLs to protect. Paste a draft that does and they will be marked here.</em>
                </div>
              )}
              <p className="diff-legend" aria-hidden="true">
                <span><i className="k-cut" /> Cut</span>
                <span><i className="k-add" /> Rewritten</span>
                <span><i className="k-fact" /> Held exactly</span>
              </p>
            </div>

            {/* The offer sits after the rewrite and after the evidence, at the
                full width of the result, not stacked on top of the one
                paragraph the visitor came to judge, and not dressed as a
                poster. It is a footer to a decision the visitor has already
                been given everything to make. */}
            {!isPaidResult(result) && shouldOfferUnlock(result) ? (
              <div className="unlock-card">
                <strong><span className="lock" aria-hidden="true"><IconLock /></span>There’s more to this rewrite</strong>
                <p>{result.hiddenWordCount} more words of this rewrite are ready. The same protected facts were checked in the same way.</p>
                <button
                  type="button"
                  onClick={() => void unlock(starterPlan.id)}
                  aria-disabled={!billingReadiness?.available || unlockStatus === "working"}
                >
                  {unlockStatus === "working"
                    ? "Redirecting to checkout…"
                    : billingReadiness?.available
                      ? `Unlock full rewrite for $${starterPlan.monthlyPrice}/mo`
                      : billingReadiness
                        ? "Checkout temporarily unavailable"
                        : "Checking checkout availability…"}
                </button>
                {/* ACT-10: the whole offer before the click includes the amount, that it
                    recurs, the included monthly allowance, and the cancellation
                    path (ACT-09). No countdown, no scarcity, no preselected
                    upsell. */}
                <small className="unlock-terms">
                  <span role="status">{billingReadiness?.message ?? "Checking checkout availability before you continue."}</span><br />
                  {subscriptionDisclosure(starterPlan)}{" "}
                  <a href="#manage-billing">Cancel anytime</a>. No cancellation fee.
                </small>
                {unlockStatus === "error" ? <small role="alert">{unlockError}</small> : null}
              </div>
            ) : null}
          </section>
        ) : null}
        </div>
      </div>

      <section className="how" id="how-it-works">
        <div className="section-intro"><p className="eyebrow"><span /> How it works</p><h2>Rewrite less.<br />Protect more.</h2></div>
        <div className="how-grid">
          <article><b>01</b><h3>Find the stiff parts</h3><p>We flag robotic patterns, filler, repetition, and forced transitions instead of rewriting every sentence.</p></article>
          <article><b>02</b><h3>Protect what matters</h3><p>Names, numbers, dates, quotes, citations, URLs, and technical terms are tracked before anything changes.</p></article>
          <article><b>03</b><h3>Check the meaning</h3><p>The rewrite is compared with your original. If a claim changes, that section does not pass.</p></article>
        </div>
      </section>

      <section className="pricing" id="pricing">
        <div className="pricing-intro">
          <p className="eyebrow"><span /> Simple pricing</p>
          <h2>Try the quality.<br />Pay for the full result.</h2>
          <p>Every rewrite is checked before you see it. You only pay once you have read part of the result and judged it for yourself.</p>
        </div>
        <article>
          <div><span>{pricingConfig.plans.starter.name}</span><p>Everything you need to make drafts sound like you meant them.</p></div>
          <strong><sup>$</sup>{pricingConfig.plans.starter.monthlyPrice}<small>/ month</small></strong>
          <ul>{pricingConfig.plans.starter.features.map((feature) => <li key={feature}><IconCheck /> {feature}</li>)}</ul>
          <a href="#top">Try it with your text</a>
        </article>
      </section>

      {/* ACT-09: the hero promises "Cancel anytime", so the path has to
          exist on the product surface. One click opens the Stripe Billing
          Portal for the signed-in customer; every failure the route can
          return is surfaced with what to do next. */}
      <section className="billing-strip" id="manage-billing" aria-labelledby="manage-billing-title">
        <div>
          <h2 id="manage-billing-title">Already subscribed?</h2>
          <p>Change your plan, update your card, or cancel your subscription. The billing portal shows the exact effective date before you confirm anything.</p>
        </div>
        <ManageBilling returnTo="/#manage-billing" />
      </section>

      <footer>
        <span className="footer-brand">
          {productConfig.productName} · {productConfig.productTagline}
        </span>
        <nav aria-label="Legal and support">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
        <span>{productConfig.productName} at {productConfig.domain}</span>
      </footer>
    </main>
  );
}
