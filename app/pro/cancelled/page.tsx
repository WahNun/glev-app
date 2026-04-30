import Link from "next/link";
import Lockup from "@/components/landing/Lockup";
import { ACCENT, TEXT_DIM } from "@/components/landing/tokens";

export const metadata = {
  title: "Glev Pro — Checkout abgebrochen",
};

export default function ProCancelledPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#09090B",
        color: "#fff",
        padding: "64px 20px",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          maxWidth: 520,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 24,
        }}
      >
        <Lockup width={180} />

        <h1 style={{ fontSize: 32, lineHeight: 1.1, letterSpacing: "-0.03em", fontWeight: 700, margin: 0 }}>
          Kein Problem — wir buchen nichts ab.
        </h1>

        <p style={{ fontSize: 16, lineHeight: 1.55, color: TEXT_DIM, margin: 0 }}>
          Du hast den Checkout abgebrochen, es wurde nichts hinterlegt. Wenn du Fragen hast bevor du dich entscheidest,
          schreib einfach kurz — wir antworten persönlich.
        </p>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          <Link
            href="/pro"
            style={{
              background: ACCENT,
              color: "#fff",
              padding: "14px 24px",
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 600,
              textDecoration: "none",
              minHeight: 48,
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            Zurück zur Mitgliedschafts-Seite
          </Link>
          <Link
            href="/contact?source=pro-cancelled"
            style={{
              border: "1px solid rgba(255,255,255,0.15)",
              color: "#fff",
              padding: "14px 24px",
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 500,
              textDecoration: "none",
              minHeight: 48,
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            Frage stellen
          </Link>
        </div>

        <Link
          href="/beta"
          style={{
            fontSize: 13,
            color: TEXT_DIM,
            textDecoration: "underline",
            textUnderlineOffset: 2,
          }}
        >
          Lieber niedriger Einstieg? → /beta
        </Link>
      </div>
    </main>
  );
}
