import Link from "next/link";
import Lockup from "@/components/landing/Lockup";
import { ACCENT, BORDER, MINT, SURFACE, TEXT_DIM } from "@/components/landing/tokens";

export const metadata = {
  title: "Glev Pro — Mitgliedschaft angelegt",
};

export default function ProSuccessPage() {
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
          maxWidth: 560,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 24,
        }}
      >
        <Lockup width={180} />

        <div
          aria-hidden
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "rgba(34,211,160,0.12)",
            border: `1px solid ${MINT}`,
            color: MINT,
            display: "grid",
            placeItems: "center",
            fontSize: 26,
          }}
        >
          ✓
        </div>

        <h1 style={{ fontSize: 36, lineHeight: 1.1, letterSpacing: "-0.03em", fontWeight: 700, margin: 0 }}>
          Deine Mitgliedschaft ist angelegt.
        </h1>

        <p style={{ fontSize: 17, lineHeight: 1.55, color: TEXT_DIM, margin: 0 }}>
          Schön dass du dabei bist. Wir buchen am 1. Juli 2026 zum ersten Mal ab — bis dahin nichts.
        </p>

        <div
          style={{
            background: SURFACE,
            border: `1px solid ${BORDER}`,
            borderRadius: 16,
            padding: 20,
            fontSize: 14,
            color: TEXT_DIM,
            textAlign: "left",
            lineHeight: 1.55,
            width: "100%",
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, color: "#fff", marginBottom: 8 }}>Was jetzt passiert</div>
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
            <li>Bestätigung von Stripe per Email (Mitgliedschaft angelegt, keine Abbuchung).</li>
            <li>App-Zugang am 1. Juli 2026 — wir melden uns zwei Wochen vorher.</li>
            <li>Erste monatliche Abbuchung am 1. Juli 2026 (€24,90).</li>
            <li>Kündigung jederzeit vor Launch — einfach an hello@glev.app schreiben.</li>
          </ul>
        </div>

        <Link
          href="/contact?source=pro-success"
          style={{
            color: ACCENT,
            fontSize: 14,
            textDecoration: "none",
            borderBottom: `1px solid ${ACCENT}40`,
            paddingBottom: 1,
          }}
        >
          Fragen? Schreib uns →
        </Link>

        <Link
          href="/pro"
          style={{
            color: TEXT_DIM,
            fontSize: 12,
            textDecoration: "none",
            marginTop: 8,
          }}
        >
          ← zurück zur Mitgliedschafts-Seite
        </Link>
      </div>
    </main>
  );
}
