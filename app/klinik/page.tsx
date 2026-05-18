import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Glev Klinik — B2B-Lösung für Diabetes-Praxen",
  description:
    "Glev Klinik: HbA1c-Schätzung, TIR-Auswertung, Patientenberichte. Für Diabetes-Praxen und MVZs. €299 / Monat — Pilot-Phase 2026.",
};

const ACCENT = "#FF7A1A";
const SURFACE = "var(--surface)";
const BORDER = "var(--border)";

export default function KlinikPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--text)",
        padding: "48px 24px 96px",
        fontFamily: "var(--font-sans)",
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "var(--text-muted)",
            textDecoration: "none",
            fontSize: 14,
            marginBottom: 32,
          }}
        >
          ← Zurück zur Startseite
        </Link>

        <h1
          style={{
            fontSize: 40,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            margin: "0 0 12px",
            lineHeight: 1.15,
          }}
        >
          Glev Klinik
        </h1>
        <p
          style={{
            fontSize: 18,
            color: "var(--text-muted)",
            margin: "0 0 32px",
            lineHeight: 1.5,
          }}
        >
          Diabetes-Auswertung für Praxen und MVZs. Patientenberichte, TIR-Tracking,
          HbA1c-Schätzung (GMI), CGM-Sync — in einer Oberfläche.
        </p>

        <div
          style={{
            background: SURFACE,
            border: `1px solid ${BORDER}`,
            borderRadius: 16,
            padding: 28,
            display: "flex",
            flexDirection: "column",
            gap: 20,
            marginBottom: 32,
          }}
        >
          <div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>
              Pilot-Phase 2026
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
              <span style={{ fontSize: 48, fontWeight: 700, letterSpacing: "-0.02em" }}>€ 299</span>
              <span style={{ fontSize: 16, color: "var(--text-muted)" }}>/ Monat</span>
            </div>
          </div>

          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              "Patientenliste mit individuellen TIR-, GMI- und CV-Werten",
              "PDF-Reports für jede Visite (3 Min Vorbereitungszeit)",
              "CGM-Integration (LibreLinkUp, Nightscout, Dexcom)",
              "DSGVO-konforme Datenhaltung in der EU",
              "Onboarding + Schulung inklusive",
            ].map((b) => (
              <li key={b} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 15, lineHeight: 1.5 }}>
                <span style={{ color: ACCENT, fontWeight: 700, flexShrink: 0 }}>✓</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>

          <a
            href="mailto:klinik@glev.app?subject=Glev%20Klinik%20Pilot-Anfrage"
            style={{
              marginTop: 8,
              padding: "14px 22px",
              borderRadius: 12,
              background: ACCENT,
              color: "#fff",
              fontSize: 15,
              fontWeight: 700,
              textDecoration: "none",
              textAlign: "center",
              boxShadow: `0 6px 18px ${ACCENT}40`,
            }}
          >
            Pilot anfragen — klinik@glev.app
          </a>
        </div>

        <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55, margin: 0 }}>
          Glev Klinik ist aktuell <strong>kein eingereichtes Medizinprodukt</strong>.
          Die Pilot-Phase richtet sich an Diabetes-Schwerpunktpraxen, die Glev als
          Patientenkommunikations- und Auswertungs-Werkzeug einsetzen möchten.
          Endgültige MDR-Klasse-IIa-Einreichung in Vorbereitung.
        </p>
      </div>
    </main>
  );
}
