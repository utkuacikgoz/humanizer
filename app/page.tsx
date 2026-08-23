"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MODES, productConfig } from "@/src/config/product";
import { pricingConfig } from "@/src/config/pricing";
import { track } from "@/src/lib/analytics";

type Mode = (typeof MODES)[number]["id"];
type Result = {
  original: string;
  preview: string;
  hiddenWordCount: number;
  issuesImproved: number;
  naturalness: "Strong" | "Good";
  meaningPreservation: "High" | "Review needed";
  protectedItems: string[];
};

const SAMPLE_TEXT =
  "In today’s busy world, it is important to note that clear communication plays a crucial role. Furthermore, teams should leverage simple strategies to collaborate well. These strategies enhance productivity. They also help teams reach lasting goals. In conclusion, thoughtful communication helps people solve problems and do their best work.";

function countWords(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

export default function Home() {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("natural");
  const [result, setResult] = useState<Result | null>(null);
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [error, setError] = useState("");
  const hasTrackedText = useRef(false);
  const completedCount = useRef(0);
  const idempotency = useRef<{ request: string; key: string } | null>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const wordCount = useMemo(() => countWords(text), [text]);

  // Focus the result heading once a rewrite lands, instead of only
  // scrolling it into view: a native `disabled` button drops keyboard
  // focus to <body> when it becomes disabled (browsers force this), which
  // silently strands keyboard/screen-reader users with no landmark. This
  // routes focus explicitly to where the result actually appears.
  useEffect(() => {
    if (!result) return;
    resultHeadingRef.current?.focus();
  }, [result]);

  useEffect(() => {
    document.documentElement.classList.add("motion-ready");
    const targets = document.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!targets.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);
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

  useEffect(() => { track("landing_view"); }, []);

  async function humanize() {
    if (status === "working") return;
    setError("");
    if (wordCount < 12) {
      setError("Add a little more context. At least 12 words works best.");
      return;
    }
    if (wordCount > 300) {
      setError("Keep this first pass to 300 words or fewer.");
      return;
    }

    setStatus("working");
    track("humanization_started", { mode, wordCount });
    setResult(null);
    try {
      const requestIdentity = `${mode}\0${text}`;
      if (idempotency.current?.request !== requestIdentity) {
        idempotency.current = { request: requestIdentity, key: crypto.randomUUID() };
      }
      const response = await fetch("/api/humanize", {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": idempotency.current.key },
        body: JSON.stringify({ text, mode }),
      });
      const payload = (await response.json()) as Result & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The rewrite could not be completed.");
      setResult(payload);
      completedCount.current += 1;
      track("humanization_completed", { mode, wordCount, issuesImproved: payload.issuesImproved });
      track("preview_viewed", { mode });
      if (completedCount.current === 2) track("second_humanization");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The rewrite could not be completed.");
      setStatus("error");
      return;
    }
    setStatus("idle");
  }

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
      <header className="site-header">
        <a className="brand" href="#top" aria-label={`${productConfig.productName} home`}>
          <span className="brand-mark" aria-hidden="true">{productConfig.productName.slice(0, 1)}</span>
          <span>{productConfig.productName}</span>
          <span className="brand-note">name in progress</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#pricing">Pricing</a>
          <a className="sign-in" href="/signin-with-chatgpt?return_to=%2F">Sign in</a>
        </nav>
      </header>

      <section className="hero" id="top">
        <p className="eyebrow reveal-hero d1"><span aria-hidden="true" /> Meaning verified, not guessed</p>
        <h1 className="reveal-hero d2">Keep your meaning.<br /><em>Lose the machine tone.</em></h1>
        <p className="hero-copy reveal-hero d3">Turn stiff, generic AI assisted drafts into clear writing that sounds like a person wrote it while keeping the facts intact.</p>
        <div className="trust-line reveal-hero d4">
          <span>Checked before you see it</span>
          <span>Names, numbers &amp; citations protected</span>
          <span>Cancel anytime</span>
        </div>
      </section>

      <section className="workspace reveal-hero d4" aria-labelledby="workspace-title">
        <div className="workspace-topline">
          <div>
            <span className="step-number">01</span>
            <h2 id="workspace-title">Paste your text</h2>
          </div>
          <button className="sample-button" type="button" onClick={() => { setText(SAMPLE_TEXT); setResult(null); }}>Try an example</button>
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
          maxLength={2400}
        />

        <div className="editor-footer">
          <div className="word-meter"><span className={wordCount > 300 ? "over" : ""}>{wordCount}</span> / 300 words</div>
          <div className="mode-group" aria-label="Writing mode">
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
          <button className="humanize-button" type="button" onClick={humanize} aria-disabled={status === "working"}>
            {status === "working" ? (
              <>Checking meaning… <span className="dot-loader" aria-hidden="true"><span /><span /><span /></span></>
            ) : (
              <>Humanize <span className="fly-arrow" aria-hidden="true">↗</span></>
            )}
          </button>
          {status === "working" ? <div className="progress-track" aria-hidden="true"><div className="progress-fill" /></div> : null}
        </div>
        {status === "working" ? (
          <p className="status-line" role="status">
            <span className="dot-loader" aria-hidden="true"><span /><span /><span /></span> Verifying meaning and protecting your facts…
          </p>
        ) : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
      </section>

      {result ? (
        <section className="result" id="result" aria-live="polite">
          <div className="result-heading">
            <div><span className="step-number">02</span><h2 ref={resultHeadingRef} tabIndex={-1}>Your rewrite is ready</h2></div>
            <p>We rewrote the awkward parts and left the meaning alone.</p>
          </div>
          <div className="checks">
            <article><span className="check-icon">✓</span><div><small>Naturalness</small><strong>{result.naturalness}</strong></div></article>
            <article><span className="check-icon">✓</span><div><small>Meaning preservation</small><strong>{result.meaningPreservation}</strong></div></article>
            <article><span className="check-icon warm">↗</span><div><small>Changes</small><strong>{result.issuesImproved} improvements</strong></div></article>
          </div>
          <div className="comparison">
            <article>
              <div className="panel-label"><span>Original</span><small>{countWords(result.original)} words</small></div>
              <p>{result.original}</p>
            </article>
            <article className="humanized-panel">
              <div className="panel-label"><span>Humanized</span><small>{mode}</small></div>
              <p>{result.preview}</p>
              <div className="locked-copy" aria-hidden="true">
                {Array.from({ length: Math.min(32, Math.max(10, result.hiddenWordCount)) }, (_, index) => (
                  <span key={index} style={{ width: `${38 + ((index * 17) % 48)}px` }} />
                ))}
              </div>
              <div className="unlock-card">
                <span className="lock" aria-hidden="true">●</span>
                <strong>There’s more to this rewrite</strong>
                <p>Unlock the complete result, sentence controls, and protected terminology.</p>
                <button type="button" disabled title="Checkout is not connected in this Phase 0 preview">Unlock full rewrite for ${pricingConfig.plans.starter.monthlyPrice}/mo</button>
                <small>Phase 0 preview · Checkout is not connected yet</small>
              </div>
            </article>
          </div>
          {result.protectedItems.length ? (
            <p className="protected-note"><strong>Protected:</strong> {result.protectedItems.slice(0, 5).join(" · ")}</p>
          ) : null}
        </section>
      ) : null}

      <section className="how" id="how-it-works">
        <div className="section-intro" data-reveal><p className="eyebrow"><span /> How it works</p><h2>Rewrite less.<br />Protect more.</h2></div>
        <div className="how-grid">
          <article data-reveal style={{ "--reveal-index": 0 } as React.CSSProperties}><b>01</b><h3>Find the stiff parts</h3><p>We flag robotic patterns, filler, repetition, and forced transitions instead of rewriting every sentence.</p></article>
          <article data-reveal style={{ "--reveal-index": 1 } as React.CSSProperties}><b>02</b><h3>Protect what matters</h3><p>Names, numbers, dates, quotes, citations, URLs, and technical terms are tracked before anything changes.</p></article>
          <article data-reveal style={{ "--reveal-index": 2 } as React.CSSProperties}><b>03</b><h3>Check the meaning</h3><p>The rewrite is compared with your original. If a claim changes, that section does not pass.</p></article>
        </div>
      </section>

      <section className="pricing" id="pricing">
        <div data-reveal><p className="eyebrow"><span /> Simple pricing</p><h2>Try the quality.<br />Pay for the full result.</h2></div>
        <article data-reveal style={{ "--reveal-index": 1 } as React.CSSProperties}>
          <div><span>Starter</span><p>Everything you need to make drafts sound like you meant them.</p></div>
          <strong><sup>$</sup>{pricingConfig.plans.starter.monthlyPrice}<small>/ month</small></strong>
          <ul>{pricingConfig.plans.starter.features.map((feature) => <li key={feature}>✓ {feature}</li>)}</ul>
          <a href="#top">Try it with your text</a>
        </article>
      </section>

      <footer><span>{productConfig.productName} · {productConfig.productTagline}</span><span>Privacy · Terms · Support</span></footer>
    </main>
  );
}
