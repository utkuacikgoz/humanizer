import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { productConfig } from "@/src/config/product";
import { pricingConfig } from "@/src/config/pricing";
import { MIN_PAYWALLABLE_INPUT_WORDS } from "@/src/lib/preview-projection";
import {
  LEGAL_PAGES_LAST_UPDATED,
  buildPublicPageMetadata,
  publicPage,
  readRequestHost,
} from "@/src/lib/public-pages";

// SEO-005. Title, description, canonical, robots, OG and Twitter come from
// the shared registry in src/lib/public-pages.ts, which host-gates every
// indexable field the same way app/robots.txt/route.ts and
// app/sitemap.xml/route.ts do: a staging, preview or localhost Host never
// gets indexed or a canonical it cannot serve.
export async function generateMetadata(): Promise<Metadata> {
  return buildPublicPageMetadata(publicPage("/privacy"), readRequestHost(await headers()));
}

const LAST_UPDATED = LEGAL_PAGES_LAST_UPDATED;

export default function PrivacyPolicyPage() {
  return (
    <main className="legal-doc">

      <Link className="back-link" href="/">&larr; Back to {productConfig.productName}</Link>
      <h1>Privacy Policy</h1>
      <p className="updated">Last updated: {LAST_UPDATED}</p>

      <div className="notice">
        This page describes how {productConfig.productName} handles the text you paste and your account data.
        It reflects how the service actually works today; we will update it here before that changes.
      </div>

      <section>
        <h2>Who operates {productConfig.productName}</h2>
        <p>
          {productConfig.productName} ({productConfig.domain}) is operated by {productConfig.legalCompanyName}.
          You can reach us at{" "}
          <a href={`mailto:${productConfig.supportEmail}`}>{productConfig.supportEmail}</a> for any privacy
          question or request.
        </p>
      </section>

      <section>
        <h2>What we process</h2>
        <ul>
          <li>The text you paste (an anonymous first pass is limited to roughly {MIN_PAYWALLABLE_INPUT_WORDS}–300 words) and the mode you select.</li>
          <li>
            The complete rewrite is generated and checked on our servers before you see anything. Your browser
            only ever receives the portion we intentionally show you as a preview — the locked remainder is
            never sent to it.
          </li>
          <li>
            If you subscribe, the billing details Stripe collects to process payment. We never receive or
            store your card number ourselves; Stripe handles that directly.
          </li>
        </ul>
      </section>

      <section>
        <h2>AI processing</h2>
        <p>
          We do not use your text to train our own models, and we do not permit a provider to train on it,
          without your separate, explicit, revocable consent. No such consent flow exists today, so no
          customer text is used for training.
        </p>
        <p>
          Today your text is not sent to any third-party AI provider. Rewrites are produced by a deterministic
          engine that runs on our own infrastructure, so the text you paste stays within the service. If we
          later introduce a third-party model provider, we will name it here, state its retention and
          training terms, and update this page before that change takes effect.
        </p>
        <p>
          We use Cloudflare for hosting and storage, and Stripe for payments. Stripe receives your billing
          details directly and we never see or store your full card number. Neither receives your drafts for
          any purpose other than operating the service.
        </p>
      </section>

      <section>
        <h2>What we store, and for how long</h2>
        <p>
          Text from an anonymous preview that never becomes a purchase is kept for up to 30 days and then
          deleted. The preview link itself expires 24 hours after it is created. We keep the short window so a
          preview survives a refresh or a checkout that is completed a little later, and no longer.
        </p>
        <p>
          Account and billing records are kept while your account is active, and afterwards only as long as we
          need them to meet tax, accounting, and legal obligations. To request deletion, email{" "}
          <a href={`mailto:${productConfig.supportEmail}`}>{productConfig.supportEmail}</a> and we will confirm
          when it is done.
        </p>
        <p>
          Rewrites saved to your history are kept until you delete them. They do not expire on a timer, because
          a history that quietly empties itself is worse than none at all. You control this yourself: open{" "}
          <Link href="/history">your history</Link>, delete an item, and its source text, rewritten output, and
          protected terms are erased at that moment rather than merely hidden from you.
        </p>
        <p>
          Regardless of the above, your source text, the rewritten output, and any protected terms are never
          placed in analytics events, ordinary application logs, error reports, or URLs.
        </p>
      </section>

      <section>
        <h2>Payment data</h2>
        <p>
          Stripe processes your subscription payment and stores your card details directly — we never collect
          or store them. We keep the minimum billing records needed to run your subscription, such as which
          plan you are on and a reference to your Stripe customer record.
        </p>
      </section>

      <section>
        <h2>Deletion requests</h2>
        <p>
          You can delete any saved rewrite yourself from <Link href="/history">your history</Link>, one item at
          a time, and the text is erased when you do.
        </p>
        <p>
          Deleting your account and everything under it is not yet self-service. Until it is, email{" "}
          <a href={`mailto:${productConfig.supportEmail}`}>{productConfig.supportEmail}</a> from your account
          email address and we will act on it manually and confirm when it is done.
        </p>
      </section>

      <section>
        <h2>Cookies and analytics</h2>
        <p>
          We use privacy-safe, aggregate product analytics — for example, that a rewrite was started or
          completed — tied to a pseudonymous session or job identifier, never to the content you submitted.
        </p>
      </section>

      <section>
        <h2>Changes to this policy</h2>
        <p>We will update this page as our practices change and update the date at the top when we do.</p>
      </section>

      <footer>
        Questions about this policy: <a href={`mailto:${productConfig.supportEmail}`}>{productConfig.supportEmail}</a>.
        See also our <Link href="/terms">Terms of Service</Link>. Starter plan reference: $
        {pricingConfig.plans.starter.monthlyPrice}/{pricingConfig.plans.starter.interval}.
      </footer>
    </main>
  );
}
