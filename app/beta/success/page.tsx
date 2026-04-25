import Image from "next/image";

const ACCENT = "#4F6EF7";
const MINT = "#22D3A0";
const SURFACE = "#111117";
const BORDER = "rgba(255,255,255,0.08)";
const TEXT_DIM = "rgba(255,255,255,0.75)";

export const metadata = {
  title: "Glev Beta — Platz gesichert",
};

export default function BetaSuccessPage() {
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
      <div style={{ maxWidth: 560, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 24 }}>
        <Image src="/icon.svg" alt="" width={64} height={64} style={{ borderRadius: 14 }} />

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
          Dein Beta-Platz ist gesichert.
        </h1>

        <p style={{ fontSize: 17, lineHeight: 1.55, color: TEXT_DIM, margin: 0 }}>
          Danke für dein Vertrauen. Wir melden uns zwei Wochen vor dem öffentlichen Launch mit deinem Zugangslink.
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
            <li>Bestätigungs-Email kommt von Stripe (Zahlungsbeleg).</li>
            <li>Persönliche Begrüßungs-Email von Lucas in den nächsten Tagen.</li>
            <li>Beta-Zugangslink im Juli 2026 — zwei Wochen vor dem öffentlichen Launch.</li>
            <li>Refund jederzeit vor Launch möglich — einfach an hello@glev.app schreiben.</li>
          </ul>
        </div>

        <a
          href="mailto:hello@glev.app"
          style={{
            color: ACCENT,
            fontSize: 14,
            textDecoration: "none",
            borderBottom: `1px solid ${ACCENT}40`,
            paddingBottom: 1,
          }}
        >
          Fragen? hello@glev.app
        </a>
      </div>
    </main>
  );
}
