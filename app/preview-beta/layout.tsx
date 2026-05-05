import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Glev Beta — kostenloser Zugang jetzt",
  description:
    "Glev Beta — kostenloser Zugang jetzt, Billing ab Juli. Erste 3 Monate 4,50 EUR, danach 9 EUR/Monat.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function PreviewBetaLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
