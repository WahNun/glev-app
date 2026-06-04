import Link from "next/link";
import Lockup from "@/components/landing/Lockup";
import { ACCENT, TEXT_DIM } from "@/components/landing/tokens";
import { getLocale } from "next-intl/server";

export const metadata = {
  title: "Glev Pro — Checkout abgebrochen",
};

const COPY = {
  de: {
    h1: "Kein Problem — wir buchen nichts ab.",
    body: "Du hast den Checkout abgebrochen, es wurde nichts hinterlegt. Wenn du Fragen hast bevor du dich entscheidest, schreib einfach kurz — wir antworten persönlich.",
    back: "Zurück zur Mitgliedschafts-Seite",
    ask: "Frage stellen",
    beta: "Lieber niedriger Einstieg? → /beta",
  },
  en: {
    h1: "No worries — nothing was charged.",
    body: "You cancelled the checkout and nothing was saved. If you have questions before deciding, just drop us a line — we reply personally. Come back whenever you're ready.",
    back: "Back to membership page",
    ask: "Ask a question",
    beta: "Prefer a lower starting point? → /beta",
  },
} as const;

export default async function ProCancelledPage() {
  const locale = await getLocale();
  const C = locale === "en" ? COPY.en : COPY.de;

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
          {C.h1}
        </h1>

        <p style={{ fontSize: 16, lineHeight: 1.55, color: TEXT_DIM, margin: 0 }}>
          {C.body}
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
            {C.back}
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
            {C.ask}
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
          {C.beta}
        </Link>
      </div>
    </main>
  );
}
