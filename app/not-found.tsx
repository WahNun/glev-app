import type { Metadata } from "next";
import Link from "next/link";

// Custom 404. Two jobs:
//   1) Own metadata export — without it Next.js injects its default
//      "404: This page could not be found." <title>, which was leaking a
//      second <title> tag into the streamed HTML of real pages.
//   2) noindex/nofollow so Google never indexes the 404 boundary.
export const metadata: Metadata = {
  title: "Seite nicht gefunden",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 24,
        textAlign: "center",
        background: "var(--bg)",
        color: "var(--text)",
        fontFamily: "var(--font-inter), Inter, system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 48, fontWeight: 700, letterSpacing: "-0.03em", margin: 0 }}>404</h1>
      <p style={{ fontSize: 16, color: "var(--text-body)", margin: 0 }}>
        Diese Seite existiert nicht.
      </p>
      <Link
        href="/"
        style={{
          marginTop: 8,
          fontSize: 15,
          fontWeight: 600,
          color: "var(--text)",
          textDecoration: "underline",
          textUnderlineOffset: 3,
        }}
      >
        Zur Startseite
      </Link>
    </main>
  );
}
