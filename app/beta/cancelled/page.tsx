import Image from "next/image";
import Link from "next/link";
import { getLocale } from "next-intl/server";

const ACCENT = "#4F6EF7";
const TEXT_DIM = "rgba(255,255,255,0.75)";

export const metadata = {
  title: "Glev Beta — Checkout abgebrochen",
};

const DE = {
  h1: "Kein Problem — dein Platz ist noch frei.",
  body: "Du hast den Checkout abgebrochen. Wenn du Fragen hast bevor du dich entscheidest, schreib einfach kurz — wir antworten persönlich.",
  cta: "Zurück zur Beta-Seite",
  secondary: "Frage stellen",
};

const EN = {
  h1: "No worries — your spot is still open.",
  body: "You cancelled the checkout. If you have questions before deciding, just drop us a line — we reply personally.",
  cta: "Back to the beta page",
  secondary: "Ask a question",
};

export default async function BetaCancelledPage() {
  const locale = await getLocale();
  const C = locale === "en" ? EN : DE;

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
          {C.h1}
        </h1>

        <p style={{ fontSize: 16, lineHeight: 1.55, color: TEXT_DIM, margin: 0 }}>
          {C.body}
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
            {C.cta}
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
            {C.secondary}
          </Link>
        </div>
      </div>
    </main>
  );
}
