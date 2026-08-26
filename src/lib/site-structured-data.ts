// SEO-006. `Organization` and `WebSite` JSON-LD for the site as a whole.
//
// Every property here resolves from `src/config/product.ts`, and every one of
// them is verifiable today: the brand name, the registered operator, the
// canonical origin, the support address a human actually answers, and the
// `lang` the document is served in.
//
// Deliberately absent, and not to be "completed" later without evidence:
//   - `logo` / `image`: no approved logo artwork exists (SEO-001). Google reads
//     a bad logo URL as a broken required property; inventing one is worse.
//   - `sameAs`: no confirmed social or knowledge-base profiles exist.
//   - `foundingDate`, `address`, `telephone`, `numberOfEmployees`: not
//     evidenced in this repository.
//   - `aggregateRating` / `review`: there are no ratings, and marking up
//     ratings absent from the visible page is a spam-policy violation.
//   - `potentialAction`/`SearchAction`: the site has no search endpoint.
// Omitting a property is correct. Inventing one is a lie that Google treats
// as structured-data spam.
//
// Kept free of `next/headers` so plain-Node tests can assert the payload.
import { productConfig } from "@/src/config/product";
import { pricingConfig } from "@/src/config/pricing";
import { canonicalOrigin, isCanonicalHost } from "@/src/lib/public-pages";

/**
 * The site-level JSON-LD graph, or null off the canonical host — where the
 * page is `noindex` anyway and must not publish entity claims about a domain
 * it is not serving.
 */
export function siteStructuredData(requestHost: string): Record<string, unknown> | null {
  const canonical = canonicalOrigin();
  if (!canonical || !isCanonicalHost(requestHost)) return null;

  const origin = canonical.origin;
  const organizationId = `${origin}/#organization`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organizationId,
        name: productConfig.productName,
        legalName: productConfig.legalCompanyName,
        url: `${origin}/`,
        contactPoint: [
          {
            "@type": "ContactPoint",
            contactType: "customer support",
            email: productConfig.supportEmail,
            availableLanguage: "English",
          },
        ],
      },
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        name: productConfig.productName,
        url: `${origin}/`,
        inLanguage: "en",
        publisher: { "@id": organizationId },
      },
    ],
  };
}

/** JSON safe to interpolate into a `<script type="application/ld+json">`. */
export function serializeJsonLd(payload: unknown): string {
  return JSON.stringify(payload).replace(/</g, "\\u003c");
}

/**
 * SEO-006 / SEO-020 finding F4. The homepage's `SoftwareApplication` entity,
 * or null off the canonical host.
 *
 * This block used to render from the landing page while that page was a
 * client component, so it could not read the request `Host` and shipped on
 * staging, preview and localhost too, `Offer` prices included, on pages that
 * are `noindex` there. Nothing was ever indexed off-host, but a page that is
 * not the product's canonical home should not publish the product's offers.
 * Now that `app/page.tsx` is a server shell it gates exactly like
 * `siteStructuredData()` above, from the same host rule.
 *
 * Every property is still verifiable from config: the name, the category, the
 * platform, and one `Offer` per plan the catalog marks purchasable, priced
 * from the catalog rather than from a literal on the page.
 */
export function homeStructuredData(requestHost: string): Record<string, unknown> | null {
  if (!isCanonicalHost(requestHost)) return null;

  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: productConfig.productName,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: "A writing tool that puts meaning first and turns generic AI assisted drafts into natural writing.",
    // One Offer per purchasable plan, straight from the catalog. Quoting a
    // single price while the page sells two would publish a figure the
    // pricing section contradicts.
    ...(productConfig.billingEnabled
      ? {
          offers: purchasablePlans().map((plan) => ({
            "@type": "Offer",
            name: plan.name,
            price: String(plan.monthlyPrice),
            priceCurrency: pricingConfig.currency.toUpperCase(),
            category: "subscription",
          })),
        }
      : {}),
  };
}

/** The plans the catalog says are buyable right now, in catalog order. */
function purchasablePlans() {
  return Object.values(pricingConfig.plans).filter((plan) => plan.availability === "active");
}
