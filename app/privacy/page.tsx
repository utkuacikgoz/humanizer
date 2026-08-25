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
          {productConfig.productName} ({productConfig.domain}) is operated by {productConfig.legalCompanyName},
          a Delaware limited liability company, from the United States. You can reach us at{" "}
          <a href={`mailto:${productConfig.supportEmail}`}>{productConfig.supportEmail}</a> for any privacy
          question or request. That address is also where privacy complaints go, and a person reads it.
        </p>
      </section>

      <section>
        <h2>What we process</h2>
        <ul>
          <li>The text you paste (an anonymous first pass is limited to roughly {MIN_PAYWALLABLE_INPUT_WORDS}&ndash;300 words) and the mode you select.</li>
          <li>
            The complete rewrite is generated and checked on our servers before you see anything. Your browser
            only ever receives the portion we intentionally show you as a preview — the locked remainder is
            never sent to it.
          </li>
          <li>
            Your email address, if you create an account. Sign-in is a single-use link we mail to that address,
            so there is no password and we never store one. We keep a one-way hash of the sign-in link and of
            your session, never the link or session value itself.
          </li>
          <li>
            If you subscribe, the billing details Stripe collects to process payment. We never receive or
            store your card number ourselves; Stripe handles that directly. What we keep is which plan you are
            on and a reference to your Stripe customer record.
          </li>
          <li>
            Your IP address, at the moment of a request, to rate-limit sign-in attempts and to stop one person
            farming unlimited free previews. It is stored only as a keyed hash used as a counter key, never as
            a readable address alongside your text.
          </li>
          <li>
            How much of your monthly allowance you have used, as word counts on an append-only ledger. The
            ledger records quantities, not writing.
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
      </section>

      <section>
        <h2>Who else handles your data</h2>
        <p>Three companies are involved in running {productConfig.productName}, and each sees only its own part.</p>
        <ul>
          <li>
            <strong>Cloudflare</strong> hosts the service and stores its data. Your text lives there, on our
            account, under our control.
          </li>
          <li>
            <strong>Stripe</strong> processes payments. It receives your billing details directly and we never
            see or store your full card number. It does not receive your drafts.
          </li>
          <li>
            <strong>Resend</strong> delivers the sign-in email. It receives your email address and the message
            containing your sign-in link. It does not receive your drafts.
          </li>
        </ul>
        <p>
          Nobody else receives your writing. We do not sell your personal information, we do not share it for
          advertising or cross-site tracking, and there are no advertising or analytics trackers on this site
          from other companies. We may disclose data if the law compels us to; where we are permitted to tell
          you, we will.
        </p>
        <p>
          Because we and our providers operate from and through the United States, data you send us is
          processed there and on Cloudflare&rsquo;s global network, wherever you are.
        </p>
      </section>

      <section>
        <h2>What we store, and for how long</h2>
        <p>
          Text from an anonymous preview that never becomes a purchase is kept for up to 30 days and then
          deleted. The preview link itself expires 24 hours after it is created. We keep the short window so a
          preview survives a refresh or a checkout that is completed a little later, and no longer. A job that
          runs every hour enforces that sweep, so it does not depend on anyone else using the site.
        </p>
        <p>
          Rewrites saved to your history are kept until you delete them. They do not expire on a timer, because
          a history that quietly empties itself is worse than none at all. You control this yourself: open{" "}
          <Link href="/history">your history</Link>, delete an item, and its source text, rewritten output, and
          protected terms are erased at that moment rather than merely hidden from you.
        </p>
        <p>
          Account and billing records are kept while your account is active, and afterwards only as long as we
          need them to meet tax, accounting, and legal obligations. To request deletion, email{" "}
          <a href={`mailto:${productConfig.supportEmail}`}>{productConfig.supportEmail}</a> and we will confirm
          when it is done.
        </p>
        <p>
          A sign-in link works once and expires 15 minutes after we send it. A signed-in session lasts up to 30
          days, and signing out ends it immediately.
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
        <h2>Your choices</h2>
        <p>
          Whatever the law where you live says, this is what you can actually do here, and what we will do if
          you ask:
        </p>
        <ul>
          <li>See what we hold about you, and get a copy of it.</li>
          <li>Correct your email address or other account details that are wrong.</li>
          <li>Delete any saved rewrite yourself, or ask us to delete your whole account.</li>
          <li>Cancel your subscription at any time from the billing portal, without asking us.</li>
          <li>Object to a use of your data, or ask us to restrict it, and get a real answer rather than a form.</li>
        </ul>
        <p>
          Email <a href={`mailto:${productConfig.supportEmail}`}>{productConfig.supportEmail}</a> from your
          account address. We will not charge you for a request or make you sign up for anything to make one,
          and we will not treat you differently for having made one.
        </p>
        <p>
          Where we need a legal basis to process your data — for example if you are in the EU or the UK — these
          are the bases we rely on: performing our contract with you (producing your rewrites, running your
          subscription), our legitimate interest in keeping the service secure and unabused, our legal
          obligations (tax and accounting records), and your consent for anything else, which today means
          nothing, because no consent-based processing exists here.
        </p>
        <p>
          We describe our practices; we do not claim a compliance certification. No regulator or auditor has
          reviewed this service against the GDPR, the UK GDPR, the CCPA, or any similar law, and we will not
          pretend otherwise. If you think we have got something wrong, tell us first at{" "}
          <a href={`mailto:${productConfig.supportEmail}`}>{productConfig.supportEmail}</a>; you may also have
          the right to complain to a data-protection authority where you live.
        </p>
      </section>

      <section>
        <h2>Cookies and analytics</h2>
        <p>
          We set one cookie that matters: the sign-in session cookie, which is what keeps you logged in. It is
          strictly necessary — without it you cannot stay signed in — and it is not used to track you across
          other sites. We do not use advertising cookies, and no third-party tracker is embedded in these
          pages.
        </p>
        <p>
          We use privacy-safe, aggregate product analytics — for example, that a rewrite was started or
          completed — tied to a pseudonymous session or job identifier, never to the content you submitted.
        </p>
      </section>

      <section>
        <h2>Security</h2>
        <p>
          Traffic is served over HTTPS. Sign-in links and session tokens are stored only as one-way hashes, so
          the stored value cannot be replayed as a credential. Your writing is never written to logs, error
          reports, analytics, or URLs. No system is perfect; if a breach affects your data we will tell you
          what happened, what we know, and what we are doing about it.
        </p>
      </section>

      <section>
        <h2>Children</h2>
        <p>
          {productConfig.productName} is not for children. You must be at least 18, or the age of majority
          where you live, to use it, and we do not knowingly collect data from anyone younger. If you believe a
          child has an account, email us and we will delete it.
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
