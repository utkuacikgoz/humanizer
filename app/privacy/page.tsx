import type { Metadata } from "next";
import Link from "next/link";
import { productConfig } from "@/src/config/product";
import { pricingConfig } from "@/src/config/pricing";
import { MIN_PAYWALLABLE_INPUT_WORDS } from "@/src/lib/preview-projection";

export function generateMetadata(): Metadata {
  const title = `Privacy Policy Draft | ${productConfig.productName}`;
  const description = `Draft information about how ${productConfig.productName} handles pasted text and account data.`;

  return {
    title,
    description,
    robots: { index: false, follow: false, nocache: true },
    openGraph: { title, description, type: "article", siteName: productConfig.productName },
    twitter: { card: "summary", title, description },
  };
}

const LAST_UPDATED = "2026-08-24";

export default function PrivacyPolicyPage() {
  return (
    <main className="legal-doc">
      <Link className="back-link" href="/">&larr; Back to {productConfig.productName}</Link>
      <h1>Privacy Policy Draft</h1>
      <p className="updated">Last updated: {LAST_UPDATED}</p>

      <div className="notice">
        <strong>This page is a draft pending Legal review.</strong> It describes the intended privacy design,
        not a finalized legal policy. It will remain out of search results until the operator, contact route,
        providers, and retention periods are confirmed.
      </div>

      <section>
        <h2>Brand and contact details</h2>
        <p>
          {productConfig.productName} is the confirmed brand and {productConfig.domain} is the confirmed
          domain. The contracting legal entity and a monitored privacy contact have not been confirmed, so
          this draft does not publish placeholder details for either one.
        </p>
      </section>

      <section>
        <h2>What we process</h2>
        <ul>
          <li>The text you paste, limited to roughly {MIN_PAYWALLABLE_INPUT_WORDS} to 300 words for the anonymous first pass, and the mode you select.</li>
          <li>
            The complete rewrite is generated and checked on our servers before you see anything. Your browser
            only receives the portion intentionally shown as a preview. The locked remainder is never sent to it.
          </li>
          <li>
            If you subscribe, Stripe collects billing details to process payment. We never receive or store
            your card number ourselves.
          </li>
        </ul>
      </section>

      <section>
        <h2>AI processing</h2>
        <p>
          Your pasted text is sent to a third party AI provider so the service can identify details that need
          protection, generate the rewrite, and verify that its meaning matches your original before you see it.
        </p>
        <p>
          Customer text is not used to train our own models. No consent flow for training exists today.
        </p>
        <div className="pending">
          <strong>PENDING:</strong> the production AI providers, their data processing agreements, hosting
          regions, and exact retention and training settings still require Legal and Security approval.
        </div>
      </section>

      <section>
        <h2>What we store and for how long</h2>
        <div className="pending">
          <strong>PENDING:</strong> the exact retention period for text from an anonymous session has not been
          finalized. The intended design uses a short, bounded period measured in hours rather than indefinite
          storage.
        </div>
        <p>
          Retention and self service deletion for paid history will be documented here once that part of the
          product ships. It is not available yet.
        </p>
        <p>
          Source text, rewritten output, and protected terms are not placed in analytics events, ordinary
          application logs, error reports, or URLs.
        </p>
      </section>

      <section>
        <h2>Payment data</h2>
        <p>
          Stripe processes subscription payments and stores card details directly. We keep the minimum billing
          records needed to run a subscription, such as the plan and a reference to the Stripe customer record.
        </p>
      </section>

      <section>
        <h2>Deletion requests</h2>
        <p>
          Self service deletion of history and account data is planned but not yet available. A verified privacy
          contact and deletion request route must be published before commercial launch. This draft does not
          direct requests to an unverified mailbox.
        </p>
      </section>

      <section>
        <h2>Cookies and analytics</h2>
        <p>
          We use privacy safe, aggregate product analytics, such as whether a rewrite was started or completed,
          tied to a pseudonymous session or job identifier and never to submitted content.
        </p>
      </section>

      <section>
        <h2>Changes to this draft</h2>
        <p>We will update this page as decisions and practices change and update the date above.</p>
      </section>

      <footer>
        See also our <Link href="/terms">Terms of Service draft</Link>. Starter plan reference: $
        {pricingConfig.plans.starter.monthlyPrice}/{pricingConfig.plans.starter.interval}.
      </footer>
    </main>
  );
}
