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
  "In today’s fast-paced world, it is important to note that clear communication plays a crucial role. Furthermore, teams should leverage simple strategies to collaborate well. These strategies enhance productivity. They also help teams reach long-term goals. In conclusion, thoughtful communication helps people solve problems and do their best work.";

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
  const wordCount = useMemo(() => countWords(text), [text]);
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: productConfig.productName,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: "A meaning-first writing tool that turns generic AI-assisted drafts into natural writing.",
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
    setError("");
    if (wordCount < 12) {
      setError("Add a little more context—at least 12 words works best.");
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
      const response = await fetch("/api/humanize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, mode }),
      });
      const payload = (await response.json()) as Result & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The rewrite could not be completed.");
      setResult(payload);
      completedCount.current += 1;
      track("humanization_completed", { mode, wordCount, issuesImproved: payload.issuesImproved });
      track("preview_viewed", { mode });
      if (completedCount.current === 2) track("second_humanization");
      window.setTimeout(() => {
        document.getElementById("result")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
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
        <p className="eyebrow"><span /> Meaning-first writing</p>
        <h1>Keep your meaning.<br /><em>Lose the machine tone.</em></h1>
        <p className="hero-copy">Turn stiff, generic AI-assisted drafts into clear writing that sounds like a person wrote it—without changing the facts.</p>
        <div className="trust-line" aria-label="Product principles">
          <span>Meaning checked</span><span>Key details protected</span><span>No signup to try</span>
        </div>
      </section>

      <section className="workspace" aria-labelledby="workspace-title">
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
          placeholder="Paste an AI-assisted draft here…"
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
          <button className="humanize-button" type="button" onClick={humanize} disabled={status === "working"}>
            {status === "working" ? "Checking meaning…" : "Humanize"}<span aria-hidden="true">↗</span>
          </button>
        </div>
        {error ? <p className="error" role="alert">{error}</p> : null}
      </section>

      {result ? (
        <section className="result" id="result" aria-live="polite">
          <div className="result-heading">
            <div><span className="step-number">02</span><h2>Your rewrite is ready</h2></div>
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
                <button type="button" disabled title="Checkout is not connected in this Phase 0 preview">Unlock full rewrite — ${pricingConfig.plans.starter.monthlyPrice}/mo</button>
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
        <div className="section-intro"><p className="eyebrow"><span /> How it works</p><h2>Rewrite less.<br />Protect more.</h2></div>
        <div className="how-grid">
          <article><b>01</b><h3>Find the stiff parts</h3><p>We flag robotic patterns, filler, repetition, and forced transitions instead of rewriting every sentence.</p></article>
          <article><b>02</b><h3>Protect what matters</h3><p>Names, numbers, dates, quotes, citations, URLs, and technical terms are tracked before anything changes.</p></article>
          <article><b>03</b><h3>Check the meaning</h3><p>The rewrite is compared with your original. If a claim changes, that section does not pass.</p></article>
        </div>
      </section>

      <section className="pricing" id="pricing">
        <div><p className="eyebrow"><span /> Simple pricing</p><h2>Try the quality.<br />Pay for the full result.</h2></div>
        <article>
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
