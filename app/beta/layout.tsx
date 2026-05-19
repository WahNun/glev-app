import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Glev Smart — Early Access",
  description:
    "Sichere dir Early Access zu Glev — der sprachgesteuerte Essens-Tracker für Typ-1-Diabetiker. €19, jederzeit refundable, wird aufs erste Abo angerechnet.",
};

export default function BetaLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
