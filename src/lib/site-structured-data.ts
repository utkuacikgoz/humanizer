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
