import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Glev Smart — Early Access",
  description:
    "Glev Smart — kostenloser Early Access jetzt sichern. Billing startet am 1. Juli 2026 mit €9/Monat. Lifetime Lock auf Pro-Tier €19/Monat.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function PreviewBetaLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
