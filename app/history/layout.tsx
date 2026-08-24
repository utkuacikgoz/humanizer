import type { Metadata } from "next";

// Private, per-account surface. It must never be indexed, and it must never
// be crawled into a cache: a history page renders one customer's own writing.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function HistoryLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
