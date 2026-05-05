import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Glev Pro — Preis sichern. Bezahlen erst im Juli.",
  description:
    "24,90 € bleibt — egal was später passiert. Keine Abbuchung bis 1. Juli, jederzeit kündbar.",
  // Preview-only route. Keep search engines out so the in-flight copy
  // never appears in SERPs alongside the live /pro page.
  robots: { index: false, follow: false },
};

export default function PreviewProLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
