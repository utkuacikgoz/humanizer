import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { productConfig } from "@/src/config/product";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

function configuredSiteUrl() {
  const configuredDomain = productConfig.domain.trim();
  if (!configuredDomain) return null;

  try {
    const url = new URL(/^https?:\/\//i.test(configuredDomain) ? configuredDomain : `https://${configuredDomain}`);
    return new URL("/", url);
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const configuredBase = configuredSiteUrl();
  const requestHeaders = await headers();
  const requestHost = (requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const canonicalBase = configuredBase && requestHost === configuredBase.host.toLowerCase() ? configuredBase : null;
  const title = `AI Humanizer for Natural Rewrites That Preserve Meaning | ${productConfig.productName}`;
  const description = "Humanize AI assisted text with targeted rewrites that protect your meaning, facts, terminology, citations, and intended tone.";
  const socialImage = canonicalBase
    ? { url: new URL("/og.png", canonicalBase), width: 1733, height: 909, alt: "Keep your meaning. Lose the machine tone." }
    : undefined;

  return {
    metadataBase: canonicalBase ?? undefined,
    title,
    description,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    alternates: canonicalBase ? { canonical: canonicalBase } : undefined,
    robots: canonicalBase
      ? { index: true, follow: true, nocache: false }
      : { index: false, follow: false, nocache: true },
    openGraph: {
      title,
      description,
      type: "website",
      url: canonicalBase ?? undefined,
      siteName: productConfig.productName,
      images: socialImage ? [socialImage] : undefined,
    },
    twitter: { card: "summary_large_image", title, description, images: socialImage ? [socialImage.url] : undefined },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
