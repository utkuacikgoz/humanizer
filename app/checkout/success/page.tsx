"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { productConfig } from "@/src/config/product";
import { pricingConfig } from "@/src/config/pricing";
import { subscriptionDisclosure } from "@/src/lib/subscription-disclosure";
import { ManageBilling } from "@/src/components/manage-billing";

type UnlockedResult = {
  original: string;
  result: string;
};

const POLL_INTERVAL_MS = 1_500;
const MAX_POLLS = 10; // ~15s bound (M2-09: "polls with bounds")

const STATUS_HEADINGS = {
  confirming: "Confirming your payment",
  unlocked: "Your full rewrite is unlocked",
  delayed: "Still confirming your payment",
  "signed-out": "Sign-in needed",
} as const;

function readJobIdFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("job");
}

export default function CheckoutSuccessPage() {
  const [jobId] = useState<string | null>(readJobIdFromLocation);
  const [status, setStatus] = useState<"confirming" | "unlocked" | "delayed" | "signed-out">("confirming");
  const [result, setResult] = useState<UnlockedResult | null>(null);
  const attempts = useRef(0);

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
          setResult((await response.json()) as UnlockedResult);
          setStatus("unlocked");
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

  return (
    <main>
      <header className="site-header">
        <Link className="brand" href="/" aria-label={`${productConfig.productName} home`}>
          <span className="brand-mark" aria-hidden="true">{productConfig.productName.slice(0, 1)}</span>
          <span>{productConfig.productName}</span>
        </Link>
      </header>

      <section className="workspace" aria-labelledby="checkout-status-title" style={{ marginTop: 48 }}>
        <div className="workspace-topline">
          <div>
            <span className="step-number">03</span>
            <h2 id="checkout-status-title">{STATUS_HEADINGS[status]}</h2>
          </div>
        </div>

        {status === "confirming" ? (
          <p className="status-line" role="status" style={{ borderTop: "none" }}>
            <span className="dot-loader" aria-hidden="true"><span /><span /><span /></span>
            {" "}We&apos;re confirming your payment with Stripe. This usually takes a few seconds.
          </p>
        ) : null}

        {status === "delayed" ? (
          <p className="status-line" role="status" style={{ borderTop: "none" }}>
            Your payment is still being confirmed — this can take a little longer than usual.
            Refresh this page in a moment, or check{" "}
            <Link href="/">the homepage</Link>. You will not be charged again, and nothing is lost.
          </p>
        ) : null}

        {status === "signed-out" ? (
          <p className="error" role="alert" style={{ borderTop: "none" }}>
            <a href="/signin-with-chatgpt?return_to=%2Fcheckout%2Fsuccess">Sign in</a> to view your unlocked result.
          </p>
        ) : null}

        {status === "unlocked" && result ? (
          <div className="comparison">
            <article>
              <div className="panel-label"><span>Original</span></div>
              <p>{result.original}</p>
            </article>
            <article className="humanized-panel">
              <div className="panel-label"><span>Humanized</span></div>
              <p>{result.result}</p>
            </article>
          </div>
        ) : null}
      </section>

      {/* ACT-09: the same one-click cancellation path as the main page,
          present on the post-purchase surface where a customer who has
          just been charged is most likely to look for it. */}
      <section className="billing-strip" id="manage-billing" aria-labelledby="manage-billing-title">
        <div>
          <h2 id="manage-billing-title">Your subscription</h2>
          <p>
            {subscriptionDisclosure(pricingConfig.plans.starter)} Cancel or change it at any time — the
            billing portal shows the exact effective date before you confirm.
          </p>
        </div>
        <ManageBilling returnTo="/checkout/success" />
      </section>
    </main>
  );
}
