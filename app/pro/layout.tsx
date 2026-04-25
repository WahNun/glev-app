import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Glev Pro — Mitgliedschaft starten",
  description:
    "Glev Pro: €24,90 / Monat ab dem 1. Juli 2026. Karte heute hinterlegt, erste Abbuchung am Launch-Tag, jederzeit kündbar.",
};

export default function ProLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
