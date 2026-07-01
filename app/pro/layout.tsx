import type { Metadata } from "next";

// /pro is a "use client" page and cannot export metadata itself. This thin
// server-component layout supplies the per-page title (→ "Glev Pro – €19/Monat | Glev"
// via the root title.template) and its own canonical so it stops sharing the
// homepage title.
export const metadata: Metadata = {
  title: "Glev Pro – €19/Monat",
  description:
    "Glev Pro: €19/Monat ab 1. Juli 2026. Karte heute hinterlegt, erste Abbuchung am Launch-Tag, jederzeit kündbar.",
  alternates: { canonical: "https://glev.app/pro" },
};

export default function ProLayout({ children }: { children: React.ReactNode }) {
  return children;
}
