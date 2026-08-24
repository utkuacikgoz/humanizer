import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { productConfig } from "@/src/config/product";
import { pricingConfig } from "@/src/config/pricing";

// Mirrors app/robots.txt/route.ts and app/sitemap.xml/route.ts: canonical/OG/
// index output is gated on the request Host matching productConfig.domain
// exactly, so a staging/preview/localhost Host never gets indexed or a
// canonical it can't actually serve. Duplicated locally rather than shared
// because SEO owns these route files independently of app/layout.tsx.
function configuredSiteUrl() {
  const configuredDomain = productConfig.domain.trim();
  if (!configuredDomain) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(configuredDomain) ? configuredDomain : `https://${configuredDomain}`);
    return new URL("/privacy", url);
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const configuredUrl = configuredSiteUrl();
  const requestHeaders = await headers();
  const requestHost = (requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const canonicalUrl = configuredUrl && requestHost === configuredUrl.host.toLowerCase() ? configuredUrl : null;
  const title = `Privacy Policy | ${productConfig.productName}`;
  const description = `How ${productConfig.productName}, operated by ${productConfig.legalCompanyName}, handles the text you paste and your account data.`;

  return {
    title,
    description,
    alternates: canonicalUrl ? { canonical: canonicalUrl } : undefined,
    robots: canonicalUrl ? { index: true, follow: true, nocache: false } : { index: false, follow: false, nocache: true },
    openGraph: { title, description, type: "article", url: canonicalUrl ?? undefined, siteName: productConfig.productName },
    twitter: { card: "summary", title, description },
  };
}

const LAST_UPDATED = "2026-08-23";

export default function PrivacyPolicyPage() {
  return (
    <main className="legal-doc">
      <style>{`
        .legal-doc { max-width: 760px; margin: 0 auto; padding: 64px 24px 96px; color: var(--ink); font-family: var(--font-geist-sans), Arial, sans-serif; }
        .legal-doc a { color: var(--green); text-decoration: underline; text-underline-offset: 2px; }
        .legal-doc a:hover { color: var(--green-dark); }
        .legal-doc .back-link { display: inline-block; margin-bottom: 28px; font-size: 13px; color: var(--muted); text-decoration: none; }
        .legal-doc .back-link:hover { color: var(--ink); }
        .legal-doc h1 { font-family: Georgia, "Times New Roman", serif; font-size: clamp(32px, 4.5vw, 44px); font-weight: 400; margin: 0 0 6px; }
        .legal-doc .updated { color: var(--muted); font-size: 13px; margin: 0 0 32px; }
        .legal-doc .notice { background: var(--mint); border: 1px solid var(--line); border-radius: var(--radius-md); padding: 16px 20px; font-size: 14px; line-height: 1.6; margin-bottom: 40px; }
        .legal-doc section { margin-bottom: 32px; }
        .legal-doc h2 { font-size: 18px; font-weight: 700; margin: 0 0 10px; }
        .legal-doc p, .legal-doc li { font-size: 15px; line-height: 1.7; color: var(--ink); }
        .legal-doc ul { margin: 0 0 12px; padding-left: 20px; }
        .legal-doc .pending { background: #fdf1e8; border: 1px dashed var(--orange); border-radius: var(--radius-sm); padding: 12px 16px; margin-top: 10px; font-size: 14px; }
        .legal-doc .pending strong { color: var(--orange); }
        .legal-doc footer { margin-top: 56px; padding-top: 24px; border-top: 1px solid var(--line); font-size: 13px; color: var(--muted); }
      `}</style>

      <Link className="back-link" href="/">&larr; Back to {productConfig.productName}</Link>
      <h1>Privacy Policy</h1>
      <p className="updated">Last updated: {LAST_UPDATED}</p>

      <div className="notice">
        This page describes how {productConfig.productName} currently handles the text you paste and your
        account data. Two sections below are marked <strong>PENDING</strong> because they depend on a
        decision that has not been finalized internally yet. Nothing on this page should be read as final
        legal advice until those sections are resolved.
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
          <li>The text you paste (an anonymous first pass is limited to roughly 12–300 words) and the mode you select.</li>
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
          Your pasted text is sent to a third-party AI provider so we can identify what needs to be protected
          (names, dates, numbers, citations, terminology, and similar details), generate the rewrite, and
          verify that its meaning matches your original before you see it.
        </p>
        <p>
          We do not use your text to train our own models, and we do not permit a provider to train on it,
          without your separate, explicit, revocable consent. No such consent flow exists today, so no
          customer text is used for training.
        </p>
        <div className="pending">
          <strong>PENDING:</strong> the specific AI provider(s) used in production, their data-processing
          agreement, hosting region, and exact retention/training configuration are still being finalized
          by Legal and Security. This section will name the provider(s) and their retention terms once that
          review closes.
        </div>
      </section>

      <section>
        <h2>What we store, and for how long</h2>
        <div className="pending">
          <strong>PENDING:</strong> the exact retention period for text from an anonymous session that is
          never turned into a purchase has not been finalized. The intended design is a short, bounded
          window measured in hours, not indefinite storage — but the precise number requires a decision we
          have not made yet.
        </div>
        <p>
          Retention and self-service deletion for paid history will be documented here, and will be
          user-controlled, once that part of the product ships. It is not available yet.
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
          Self-service deletion of your history and account data is planned but not yet available in the
          product. Until it ships, email{" "}
          <a href={`mailto:${productConfig.supportEmail}`}>{productConfig.supportEmail}</a> from your account
          email address to request deletion, and we will act on it manually.
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
