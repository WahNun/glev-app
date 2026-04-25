import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Brand Guidelines · Glev",
  description:
    "Glev Brand Guidelines — Visuelles System, Stimme und Assets für Presse, Designer und Partner.",
};

export default function BrandLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
