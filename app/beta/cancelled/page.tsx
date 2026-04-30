import Image from "next/image";
import Link from "next/link";

const ACCENT = "#4F6EF7";
const TEXT_DIM = "rgba(255,255,255,0.75)";

export const metadata = {
  title: "Glev Beta — Checkout abgebrochen",
};

export default function BetaCancelledPage() {
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
      <div style={{ maxWidth: 520, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 24 }}>
        <Image src="/icon.svg" alt="" width={64} height={64} style={{ borderRadius: 14 }} />

        <h1 style={{ fontSize: 32, lineHeight: 1.1, letterSpacing: "-0.03em", fontWeight: 700, margin: 0 }}>
          Kein Problem — dein Platz ist noch frei.
        </h1>

        <p style={{ fontSize: 16, lineHeight: 1.55, color: TEXT_DIM, margin: 0 }}>
          Du hast den Checkout abgebrochen. Wenn du Fragen hast bevor du dich entscheidest, schreib einfach kurz —
          wir antworten persönlich.
        </p>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          <Link
            href="/beta"
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
            Zurück zur Beta-Seite
          </Link>
          <Link
            href="/contact?source=beta-cancelled"
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
      </div>
    </main>
  );
}
