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
    return new URL("/terms", url);
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
  const title = `Terms of Service | ${productConfig.productName}`;
  const description = `The terms that govern your use of ${productConfig.productName}, operated by ${productConfig.legalCompanyName}.`;

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
const starter = pricingConfig.plans.starter;

export default function TermsOfServicePage() {
  return (
    <main className="legal-doc">

      <Link className="back-link" href="/">&larr; Back to {productConfig.productName}</Link>
      <h1>Terms of Service</h1>
      <p className="updated">Last updated: {LAST_UPDATED}</p>

      <div className="notice">
        <strong>This page is a draft pending Legal review.</strong> Sections marked <strong>PENDING</strong>{" "}
        below are placeholders, not binding terms yet. {productConfig.legalCompanyName} will finalize this
        page before it is treated as a complete agreement. If you have questions about your purchase in the
        meantime, contact <a href={`mailto:${productConfig.supportEmail}`}>{productConfig.supportEmail}</a>.
      </div>

      <section>
        <h2>Overview</h2>
        <p>
          {productConfig.productName} ({productConfig.domain}) is operated by {productConfig.legalCompanyName}.
          These terms govern your access to and use of the {productConfig.productName} service.
        </p>
      </section>

      <section>
        <h2>The service</h2>
        <p>
          {productConfig.productName} rewrites AI-assisted text so it reads more naturally, using a mode you
          choose. Before you see any output, the complete rewrite is generated and checked on our servers to
          confirm its meaning matches your original; only an approved partial preview is shown until you
          unlock the full result.
        </p>
        <p>
          {productConfig.productName} does not guarantee that any AI-detection or plagiarism-detection tool
          will fail to flag rewritten text, and it is not sold or promoted as a way to evade academic-integrity
          or plagiarism-detection systems. You remain responsible for how you use the output and for complying
          with any policy that applies to you, such as your school&rsquo;s or employer&rsquo;s rules.
        </p>
      </section>

      <section>
        <h2>Accounts and eligibility</h2>
        <div className="pending">
          <strong>PENDING:</strong> minimum age and any jurisdiction restrictions on who may use the service
          have not been finalized.
        </div>
      </section>

      <section>
        <h2>Subscriptions and billing</h2>
        <p>
          The {starter.name} plan is ${starter.monthlyPrice} per {starter.interval}, billed through Stripe.
          There is no permanent free tier. You can cancel through the billing portal linked from your account;
          cancellation takes effect as shown there.
        </p>
        <div className="pending">
          <strong>PENDING:</strong> the detailed refund policy, and the exact rules for mid-cycle plan changes,
          have not been finalized.
        </div>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <ul>
          <li>Do not submit text you do not have the right to submit.</li>
          <li>Do not attempt to bypass usage limits, automate abusive request volume, or interfere with the service&rsquo;s operation.</li>
          <li>Do not use the service to misrepresent authorship in violation of a policy that applies to you.</li>
        </ul>
      </section>

      <section>
        <h2>Your content</h2>
        <p>
          You retain ownership of the text you submit. We process it to generate your rewrite as described in
          our <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </section>

      <section>
        <h2>Disclaimers and limitation of liability</h2>
        <div className="pending">
          <strong>PENDING:</strong> this section requires drafting by Legal and is not yet written. It will
          cover warranty disclaimers and the limits of {productConfig.legalCompanyName}&rsquo;s liability.
        </div>
      </section>

      <section>
        <h2>Governing law and disputes</h2>
        <div className="pending">
          <strong>PENDING:</strong> governing law and dispute-resolution terms have not been finalized.
        </div>
      </section>

      <section>
        <h2>Termination</h2>
        <p>We may suspend or terminate access for use that violates the acceptable-use section above.</p>
        <div className="pending">
          <strong>PENDING:</strong> the complete termination terms have not been finalized.
        </div>
      </section>

      <section>
        <h2>Changes to these terms</h2>
        <div className="pending">
          <strong>PENDING:</strong> how we will notify you of material changes has not been finalized.
        </div>
      </section>

      <footer>
        Questions about these terms: <a href={`mailto:${productConfig.supportEmail}`}>{productConfig.supportEmail}</a>.
        See also our <Link href="/privacy">Privacy Policy</Link>.
      </footer>
    </main>
  );
}
