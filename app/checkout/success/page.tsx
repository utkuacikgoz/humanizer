"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { productConfig } from "@/src/config/product";
import { pricingConfig } from "@/src/config/pricing";
import { subscriptionDisclosure } from "@/src/lib/subscription-disclosure";
import { ManageBilling } from "@/src/components/manage-billing";
import { MarkedText, describeMarks, diffRewrite, selectDisplayFacts } from "@/src/components/rewrite-marks";
import { improvementLabel } from "@/src/lib/preview-projection";
import { track } from "@/src/lib/analytics";

type UnlockedResult = {
  original: string;
  result: string;
  issuesImproved: number;
  naturalness: "Strong" | "Good";
  meaningPreservation: "High" | "Review needed";
  protectedItems: string[];
};

function countWords(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

const POLL_INTERVAL_MS = 1_500;
const MAX_POLLS = 10; // ~15s bound (M2-09: "polls with bounds")

const STATUS_HEADINGS = {
  confirming: "Confirming your payment",
  unlocked: "Your full rewrite is unlocked",
  delayed: "Still confirming your payment",
  missing: "We need your result link",
  "signed-out": "Sign-in needed",
} as const;

function readJobIdFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("job");
}

const subscribeToLocation = () => () => {};
const clientIsHydrated = () => true;
const serverIsHydrated = () => false;
const noServerJobId = () => null;

export default function CheckoutSuccessPage() {
  const hydrated = useSyncExternalStore(subscribeToLocation, clientIsHydrated, serverIsHydrated);
  const jobId = useSyncExternalStore(subscribeToLocation, readJobIdFromLocation, noServerJobId);
  const [status, setStatus] = useState<"confirming" | "unlocked" | "delayed" | "missing" | "signed-out">("confirming");
  const [result, setResult] = useState<UnlockedResult | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const attempts = useRef(0);
  const completionEventsFired = useRef(false);
  const marks = useMemo(() => (result ? diffRewrite(result.original, result.result) : null), [result]);
  const facts = useMemo(
    () => result ? selectDisplayFacts(result.protectedItems, result.original) : [],
    [result],
  );
  const visibleStatus = hydrated && !jobId ? "missing" : status;

  // Hydration marker, matching the landing page. The post-purchase surface
  // fires no analytics beacon, so this client-only effect is the single
  // signal that it has become interactive.
  useEffect(() => { document.documentElement.classList.add("motion-ready"); }, []);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    async function poll() {
      attempts.current += 1;
      try {
        const response = await fetch(`/api/result?job=${encodeURIComponent(jobId!)}`, { cache: "no-store" });
        if (cancelled) return;
        if (response.status === 401) {
          setStatus("signed-out");
          return;
        }
        if (response.ok) {
          const unlocked = (await response.json()) as UnlockedResult;
          setResult(unlocked);
          setStatus("unlocked");
          if (!completionEventsFired.current) {
            completionEventsFired.current = true;
            track("checkout_completed", { jobId: jobId! });
            track("full_result_unlocked", { jobId: jobId! });
          }
          return;
        }
      } catch {
        // Network hiccup: fall through to the retry/backoff below.
      }
      if (cancelled) return;
      if (attempts.current >= MAX_POLLS) {
        setStatus("delayed");
        return;
      }
      window.setTimeout(poll, POLL_INTERVAL_MS);
    }

    void poll();
    return () => { cancelled = true; };
  }, [jobId]);

  async function copyResult() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.result);
      setCopyStatus("copied");
      if (jobId) track("result_copied", { jobId });
    } catch {
      setCopyStatus("failed");
    }
  }

  return (
    <main>
      <header className="site-header">
        <Link className="brand" href="/" aria-label={`${productConfig.productName} home`}>
          <span>{productConfig.productName}</span>
        </Link>
      </header>

      <div className="stage stage-single">
        <section className="workspace" aria-labelledby="checkout-status-title">
        <div className="workspace-topline">
          <div>
            <span className="step-number">03</span>
            <h2 id="checkout-status-title">{STATUS_HEADINGS[visibleStatus]}</h2>
          </div>
        </div>

        {visibleStatus === "confirming" ? (
          <p className="status-line" role="status" style={{ borderTop: "none" }}>
            <span className="dot-loader" aria-hidden="true"><span /><span /><span /></span>
            {" "}We&apos;re confirming your payment with Stripe. This usually takes a few seconds.
          </p>
        ) : null}

        {visibleStatus === "delayed" ? (
          <p className="status-line" role="status" style={{ borderTop: "none" }}>
            Your payment is still being confirmed. This can take a little longer than usual.
            Refresh this page in a moment, or check{" "}
            <Link href="/">the homepage</Link>. You will not be charged again, and nothing is lost.
          </p>
        ) : null}

        {visibleStatus === "signed-out" ? (
          <p className="error" role="alert" style={{ borderTop: "none" }}>
            <a href="/signin-with-chatgpt?return_to=%2Fcheckout%2Fsuccess">Sign in</a> to view your unlocked result.
          </p>
        ) : null}

        {visibleStatus === "missing" ? (
          <p className="error" role="alert" style={{ borderTop: "none" }}>
            This link does not include a result reference. Return to <Link href="/">the homepage</Link> to open your draft or start another rewrite.
          </p>
        ) : null}

        {visibleStatus === "unlocked" && result && marks ? (
          <>
            <div className="checks" aria-label="Rewrite checks">
              <article><small>Naturalness</small><strong>{result.naturalness}</strong></article>
              <article><small>Meaning preservation</small><strong>{result.meaningPreservation}</strong></article>
              <article className="warm"><small>Changes</small><strong>{improvementLabel(result.issuesImproved)}</strong></article>
            </div>
            <div className="comparison">
              <article>
                <div className="panel-label"><span>Original</span><small>{countWords(result.original)} words</small></div>
                <p><MarkedText segments={marks.source} facts={facts} /></p>
              </article>
              <article className="humanized-panel">
                <div className="panel-label"><span>Humanized</span><small>complete</small></div>
                <p className="sr-only">{describeMarks(marks.result)}</p>
                <p><MarkedText segments={marks.result} facts={facts} /></p>
              </article>
            </div>
            {/* ACT-15: the paid screen carries the same evidence as the
                free preview did over the complete text, plus a way back
                into the workspace, because nothing else invites a second
                draft. */}
            <div className="evidence">
              <div className="protected-note">
                <b>Held exactly as you wrote them</b>
                {facts.length ? <ul>{facts.slice(0, 6).map((fact) => <li key={fact}>{fact}</li>)}</ul> : <p>No names, dates, numbers, citations, or links needed special protection.</p>}
              </div>
              <div className="paid-actions">
                <button type="button" className="copy-result" onClick={copyResult}>Copy full rewrite</button>
                <Link className="next-action" href="/">Rewrite another draft</Link>
                {/* M3-01: this rewrite is now claimed by the account, so it is
                    in history. Say where it went rather than leaving the
                    customer to guess whether it was kept. */}
                <Link className="next-action" href="/history">Your saved rewrites</Link>
                <p className="copy-status" role="status" aria-live="polite">
                  {copyStatus === "copied" ? "Copied to your clipboard." : copyStatus === "failed" ? "Copy was blocked. Select the text and copy it manually." : ""}
                </p>
              </div>
            </div>
          </>
          ) : null}
        </section>
      </div>

      {/* ACT-09: the same one-click cancellation path as the main page,
          present on the post-purchase surface where a customer who has
          just been charged is most likely to look for it. */}
      <section className="billing-strip" id="manage-billing" aria-labelledby="manage-billing-title">
        <div>
          <h2 id="manage-billing-title">Your subscription</h2>
          <p>
            {subscriptionDisclosure(pricingConfig.plans.starter)} Cancel or change it at any time. The
            billing portal shows the exact effective date before you confirm.
          </p>
        </div>
        <ManageBilling returnTo="/checkout/success" />
      </section>
    </main>
  );
}
