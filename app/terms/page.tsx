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
        These terms use standard commercial software terms. They have not been reviewed by counsel for
        your jurisdiction. Questions about your purchase:{" "}
        <a href={`mailto:${productConfig.supportEmail}`}>{productConfig.supportEmail}</a>.
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
        <p>
          You must be at least 18 years old, or the age of majority where you live, to use {productConfig.productName}.
          By using the service you confirm you meet that requirement and that you are not barred from doing so
          under any applicable sanctions or export-control law.
        </p>
        <p>
          You are responsible for activity under your account and for keeping your sign-in credentials secure.
        </p>
      </section>

      <section>
        <h2>Subscriptions and billing</h2>
        <p>
          The {starter.name} plan is ${starter.monthlyPrice} per {starter.interval}, billed through Stripe.
          There is no permanent free tier. You can cancel through the billing portal linked from your account;
          cancellation takes effect as shown there.
        </p>
        <p>
          Subscriptions renew automatically each {starter.interval} at the then-current price until you cancel.
          Cancelling stops the next renewal; your access continues until the end of the period you have already
          paid for. We do not prorate or refund partial periods, and fees already paid are non-refundable except
          where refund rights are required by law or where we state otherwise in writing.
        </p>
        <p>
          If we change the price, we will tell you before the change takes effect and you may cancel before
          renewing at the new price. Applicable taxes may be added at checkout.
        </p>
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
        <p>
          The service is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without warranties of any
          kind, whether express, implied, or statutory, including any implied warranties of merchantability,
          fitness for a particular purpose, and non-infringement. We do not warrant that the service will be
          uninterrupted or error-free, or that a rewrite will meet any particular standard, pass any particular
          review, or produce any particular outcome. You are responsible for reviewing any rewrite before you
          rely on it.
        </p>
        <p>
          To the fullest extent permitted by law, {productConfig.legalCompanyName} will not be liable for any
          indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits,
          revenue, data, or goodwill, arising out of or relating to your use of the service, even if advised of
          the possibility. Our total liability for all claims relating to the service in any twelve-month period
          will not exceed the amount you paid us for the service during that period.
        </p>
        <p>
          Some jurisdictions do not allow certain exclusions or limitations, so parts of this section may not
          apply to you. Nothing here limits liability that cannot be limited by law.
        </p>
      </section>

      <section>
        <h2>Governing law and disputes</h2>
        <p>
          These terms are governed by the laws of the State of Delaware, United States, without regard to its
          conflict-of-laws rules. You and {productConfig.legalCompanyName} agree to the exclusive jurisdiction
          of the state and federal courts located in Delaware for any dispute that is not resolved informally,
          and each party waives any objection to venue there.
        </p>
        <p>
          Before filing anything, please email{" "}
          <a href={`mailto:${productConfig.supportEmail}`}>{productConfig.supportEmail}</a> and give us 30 days
          to try to resolve the matter with you directly. Most issues are settled this way.
        </p>
      </section>

      <section>
        <h2>Termination</h2>
        <p>
          You may stop using {productConfig.productName} at any time and cancel from the billing portal. We may
          suspend or terminate access for use that violates the acceptable-use section above, for non-payment,
          or where we are required to by law. Where circumstances reasonably allow, we will give you notice and
          a chance to fix the problem first.
        </p>
        <p>
          If we terminate your account without cause, we will refund the unused portion of any period you have
          already paid for. Sections that by their nature should survive termination — your content ownership,
          the disclaimers, the liability limits, and governing law — continue to apply after it.
        </p>
      </section>

      <section>
        <h2>Changes to these terms</h2>
        <p>
          We may update these terms. For a material change, we will post the updated page with a new
          &ldquo;last updated&rdquo; date and, where we hold an email address for you, email you at least 30
          days before it takes effect. Continuing to use the service after that date means you accept the
          updated terms; if you do not, cancel before then.
        </p>
      </section>

      <footer>
        Questions about these terms: <a href={`mailto:${productConfig.supportEmail}`}>{productConfig.supportEmail}</a>.
        See also our <Link href="/privacy">Privacy Policy</Link>.
      </footer>
    </main>
  );
}
