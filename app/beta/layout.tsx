import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Glev Beta — Platz sichern",
  description:
    "Sichere dir einen Beta-Platz für Glev — der sprachgesteuerte Essens-Tracker für Typ-1-Diabetiker. €19, jederzeit refundable, wird aufs erste Abo angerechnet.",
};

export default function BetaLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
