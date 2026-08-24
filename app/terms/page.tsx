import type { Metadata } from "next";
import Link from "next/link";
import { productConfig } from "@/src/config/product";
import { pricingConfig } from "@/src/config/pricing";

export function generateMetadata(): Metadata {
  const title = `Terms of Service Draft | ${productConfig.productName}`;
  const description = `Draft terms for the ${productConfig.productName} writing service.`;

  return {
    title,
    description,
    robots: { index: false, follow: false, nocache: true },
    openGraph: { title, description, type: "article", siteName: productConfig.productName },
    twitter: { card: "summary", title, description },
  };
}

const LAST_UPDATED = "2026-08-24";
const starter = pricingConfig.plans.starter;

export default function TermsOfServicePage() {
  return (
    <main className="legal-doc">
      <Link className="back-link" href="/">&larr; Back to {productConfig.productName}</Link>
      <h1>Terms of Service Draft</h1>
      <p className="updated">Last updated: {LAST_UPDATED}</p>

      <div className="notice">
        <strong>This page is a draft pending Legal review.</strong> Sections marked <strong>PENDING</strong>{" "}
        are not binding terms. The legal operator and support contact must be confirmed before commercial
        launch. This page will remain out of search results until that review is complete.
      </div>

      <section>
        <h2>Overview</h2>
        <p>
          {productConfig.productName} is the confirmed brand for the writing service at {productConfig.domain}.
          The contracting legal entity has not been confirmed, so this draft does not name a placeholder operator.
        </p>
      </section>

      <section>
        <h2>The service</h2>
        <p>
          {productConfig.productName} rewrites AI assisted text so it reads more naturally, using a mode you
          choose. The complete rewrite is generated and checked on our servers. Only an approved partial preview
          is shown until you unlock the full result.
        </p>
        <p>
          {productConfig.productName} does not guarantee that an AI detection or plagiarism detection tool will
          fail to flag rewritten text. It is not sold or promoted as a way to evade academic integrity or
          plagiarism controls. You remain responsible for how you use the output and for following applicable
          school, employer, and legal requirements.
        </p>
      </section>

      <section>
        <h2>Accounts and eligibility</h2>
        <div className="pending">
          <strong>PENDING:</strong> minimum age and jurisdiction restrictions have not been finalized.
        </div>
      </section>

      <section>
        <h2>Subscriptions and billing</h2>
        <p>
          The {starter.name} plan is ${starter.monthlyPrice} per {starter.interval}, billed through Stripe.
          There is no permanent free tier. You can cancel through the billing portal linked from your account.
          Cancellation takes effect as shown there.
        </p>
        <div className="pending">
          <strong>PENDING:</strong> the detailed refund policy and rules for plan changes have not been finalized.
        </div>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <ul>
          <li>Do not submit text you do not have the right to submit.</li>
          <li>Do not bypass usage limits, automate abusive request volume, or interfere with the service.</li>
          <li>Do not misrepresent authorship in violation of a policy that applies to you.</li>
        </ul>
      </section>

      <section>
        <h2>Your content</h2>
        <p>
          You retain ownership of the text you submit. We process it to generate your rewrite as described in
          our <Link href="/privacy">Privacy Policy draft</Link>.
        </p>
      </section>

      <section>
        <h2>Disclaimers and limitation of liability</h2>
        <div className="pending">
          <strong>PENDING:</strong> Legal must draft warranty disclaimers and limits of liability after the
          contracting entity is confirmed.
        </div>
      </section>

      <section>
        <h2>Governing law and disputes</h2>
        <div className="pending">
          <strong>PENDING:</strong> governing law and dispute terms have not been finalized.
        </div>
      </section>

      <section>
        <h2>Termination</h2>
        <p>We may suspend or terminate access for use that violates the acceptable use section above.</p>
        <div className="pending">
          <strong>PENDING:</strong> complete termination terms have not been finalized.
        </div>
      </section>

      <section>
        <h2>Changes to these terms</h2>
        <div className="pending">
          <strong>PENDING:</strong> how material changes will be communicated has not been finalized.
        </div>
      </section>

      <footer>
        See also our <Link href="/privacy">Privacy Policy draft</Link>.
      </footer>
    </main>
  );
}
