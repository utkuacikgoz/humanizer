import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { productConfig } from "@/src/config/product";
import { pricingConfig } from "@/src/config/pricing";
import { ManageBilling } from "@/src/components/manage-billing";
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
  return buildPublicPageMetadata(publicPage("/terms"), readRequestHost(await headers()));
}

const LAST_UPDATED = LEGAL_PAGES_LAST_UPDATED;
const starter = pricingConfig.plans.starter;
const starterAllowance = starter.wordLimit.toLocaleString("en-US");

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
          {productConfig.productName} ({productConfig.domain}) is operated by {productConfig.legalCompanyName},
          a Delaware limited liability company. These terms govern your access to and use of the{" "}
          {productConfig.productName} service. If you do not agree with them, do not use the service.
        </p>
        <p>
          &ldquo;We&rdquo; and &ldquo;us&rdquo; mean {productConfig.legalCompanyName}. &ldquo;You&rdquo; means
          the person using the service.
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
          {productConfig.productName} is a revision and clarity aid. It helps you say what you already meant in
          words that read more like your own. It is not a way to evade academic-integrity controls, and it is
          not a way to pass someone else&rsquo;s work, or a machine&rsquo;s, off as yours.
        </p>
        <p>
          {productConfig.productName} does not guarantee that any AI-detection or plagiarism-detection tool
          will fail to flag rewritten text, and it is not sold or promoted as a way to evade academic-integrity
          or plagiarism-detection systems. You remain responsible for how you use the output and for complying
          with any policy that applies to you, such as your school&rsquo;s or employer&rsquo;s rules.
        </p>
        <p>
          We change and improve the service over time. If we remove something you are paying for, you can
          cancel; see the refunds section below.
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
          You sign in with a single-use link we email to you. There is no password to choose, and we never
          store one. That means the email account you sign in with is the key to your {productConfig.productName}{" "}
          account: keep access to it secure, do not forward a sign-in link to anyone, and tell us at{" "}
          <a href={`mailto:${productConfig.supportEmail}`}>{productConfig.supportEmail}</a> if you think
          someone else has reached your account. You are responsible for activity under your account.
        </p>
        <p>
          One account is for one person. Do not share an account or resell access to it.
        </p>
      </section>

      <section>
        <h2>Subscriptions and billing</h2>
        <p>
          The {starter.name} plan is ${starter.monthlyPrice} per {starter.interval}, and it recurs every{" "}
          {starter.interval} until you cancel. It includes {starterAllowance} words each {starter.interval}.
          Payment is handled by Stripe; we never receive or store your card number. There is no permanent free
          tier, and there is no trial unless we say so at checkout.
        </p>
        <p>
          Subscriptions renew automatically each {starter.interval} at the then-current price until you cancel.
          Your allowance resets at the start of each billing period and unused words do not roll over. When you
          have used the allowance for a period, we tell you plainly and new rewrites stop until the next period
          begins or you move to a larger plan. We do not charge you extra without asking first.
        </p>
        <p>
          You are charged for work we actually deliver. A rewrite that fails our meaning or quality checks, a
          system error, or a retry on our side costs you nothing and does not count against your allowance.
        </p>
        <p>
          If we change the price, we will tell you before the change takes effect and you may cancel before
          renewing at the new price. Applicable taxes may be added at checkout. If a payment fails, we may
          pause new rewrites until it is resolved; we do not delete your saved rewrites over a failed payment.
        </p>
      </section>

      <section>
        <h2>Cancelling</h2>
        <p>
          You can cancel at any time from the Stripe billing portal, linked below and from your account. It
          shows the exact date the change takes effect before you confirm anything. Cancelling costs nothing,
          takes a few clicks, and does not require you to email us or explain yourself.
        </p>
        <p>
          Cancelling stops the next renewal. Your access continues until the end of the period you have already
          paid for, and then new paid work stops. Cancelling does not delete your account or your saved
          rewrites; see the <Link href="/privacy">Privacy Policy</Link> for how to delete those.
        </p>
      </section>

      <section>
        <h2>Refunds</h2>
        <p>
          You can cancel at any time and keep access until the end of the period you have already paid for. We
          do not automatically refund or prorate a partial period, and fees already paid are not automatically
          refundable.
        </p>
        <p>
          That is the default, not a wall. If the service did not work for you, if you were charged after
          cancelling, or if something went wrong on our side, email{" "}
          <a href={`mailto:${productConfig.supportEmail}`}>{productConfig.supportEmail}</a> and tell us what
          happened. We would rather refund a month than argue about $
          {starter.monthlyPrice}.
        </p>
        <p>
          If we terminate or suspend your account and you have not broken these terms, we will refund the
          unused portion of the period you have already paid for.
        </p>
        <p>
          Where the law where you live gives you a right to cancel or a refund that is stronger than this
          section, that right applies and this section does not take it away.
        </p>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <p>
          {productConfig.productName} exists to help you revise your own writing. The rules below follow from
          that.
        </p>
        <ul>
          <li>
            Do not use the service to defeat, evade, or work around an academic-integrity control, an
            AI-detection or plagiarism check, or any similar review that applies to you.
          </li>
          <li>
            Do not use the service to misrepresent authorship — to present work as your own when it is not, or
            to hide that a piece of writing was machine-generated where you are required to disclose it.
          </li>
          <li>Do not submit text you do not have the right to submit.</li>
          <li>
            Do not submit other people&rsquo;s personal information, or material that is unlawful, that you
            know to be defamatory, or that you intend to use to deceive or defraud someone.
          </li>
          <li>Do not attempt to bypass usage limits, automate abusive request volume, or interfere with the service&rsquo;s operation.</li>
          <li>Do not resell, sublicense, or rebrand the service, or scrape it to build a competing one.</li>
          <li>
            Do not try to reach another customer&rsquo;s text or account, probe our systems without permission,
            or take apart how the service works in order to break it.
          </li>
        </ul>
        <p>
          If your school, employer, publisher, or client has a policy about using tools like this, that policy
          governs. Read it. We cannot tell you what your institution permits, and using {productConfig.productName}{" "}
          does not make something permitted that otherwise would not be.
        </p>
      </section>

      <section>
        <h2>Your content</h2>
        <p>
          You retain ownership of the text you submit and of the rewrite you get back. We do not claim any
          ownership of either.
        </p>
        <p>
          You give us permission to store and process your text for one purpose: running the service for you —
          producing your rewrite, checking it, showing it to you, and keeping it in your history until you
          delete it. That permission ends when the text is deleted. We do not use your writing to train
          models, and we do not sell it or share it for advertising. Our{" "}
          <Link href="/privacy">Privacy Policy</Link> describes exactly what is stored and for how long.
        </p>
        <p>
          You are responsible for having the rights to the text you submit, and for checking the output before
          you rely on it or hand it in.
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
          will not exceed the greater of the amount you paid us for the service during that period or $50.
        </p>
        <p>
          Nothing in these terms limits liability for fraud, for fraudulent misrepresentation, for death or
          personal injury caused by negligence, or for anything else that cannot be limited or excluded by law.
          Some jurisdictions do not allow certain exclusions or limitations, so parts of this section may not
          apply to you, and where a limitation is not permitted it is reduced to what the law does permit
          rather than removed from the rest of these terms.
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
          If you are a consumer, this does not take away the protection of the mandatory consumer law of the
          country or state where you live, or your right to bring a claim there where the law gives you one.
        </p>
        <p>
          Before filing anything, please email{" "}
          <a href={`mailto:${productConfig.supportEmail}`}>{productConfig.supportEmail}</a> and give us 30 days
          to try to resolve the matter with you directly. Most issues are settled this way.
        </p>
      </section>

      <section id="manage-billing">
        <h2>Managing or cancelling your subscription</h2>
        <p>
          Change your plan, update your card, or cancel from the billing portal. It shows the
          exact date any change takes effect before you confirm anything, and cancelling costs
          nothing.
        </p>
        <ManageBilling returnTo="/terms#manage-billing" />
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

      <section>
        <h2>General</h2>
        <p>
          These terms, together with the <Link href="/privacy">Privacy Policy</Link>, are the whole agreement
          between you and us about the service. If a court finds part of them unenforceable, the rest still
          applies. Our not enforcing something once does not waive it later. You may not transfer your rights
          under these terms; we may transfer ours to a successor if the business changes hands, and we will say
          so here if that happens.
        </p>
      </section>

      <section>
        <h2>Contact and complaints</h2>
        <p>
          One address handles everything — support, billing, privacy, and complaints:{" "}
          <a href={`mailto:${productConfig.supportEmail}`}>{productConfig.supportEmail}</a>. A person reads it.
          Tell us what happened and what you would like done, and we will reply.
        </p>
        <p>
          {productConfig.legalCompanyName}, operator of {productConfig.productName} ({productConfig.domain}).
        </p>
      </section>

      <footer>
        Questions about these terms: <a href={`mailto:${productConfig.supportEmail}`}>{productConfig.supportEmail}</a>.
        See also our <Link href="/privacy">Privacy Policy</Link>.
      </footer>
    </main>
  );
}
