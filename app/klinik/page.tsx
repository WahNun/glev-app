import type { Metadata } from "next";
import Link from "next/link";
import { getLocale } from "next-intl/server";

export const metadata: Metadata = {
  title: "Glev Klinik — B2B-Lösung für Diabetes-Praxen",
  description:
    "Glev Klinik: HbA1c-Schätzung, TIR-Auswertung, Patientenberichte. Für Diabetes-Praxen und MVZs. €299 / Monat — Pilot-Phase 2026.",
};

const ACCENT = "#FF7A1A";
const SURFACE = "var(--surface)";
const BORDER = "var(--border)";

type Content = {
  back: string;
  subtitle: string;
  pilotLabel: string;
  perMonth: string;
  benefits: string[];
  cta: string;
  disclaimerBrand: string;
  disclaimer: string;
};

const DE: Content = {
  back: "← Zurück zur Startseite",
  subtitle:
    "Diabetes-Auswertung für Praxen und MVZs. Patientenberichte, TIR-Tracking, HbA1c-Schätzung (GMI), CGM-Sync — in einer Oberfläche.",
  pilotLabel: "Pilot-Phase 2026",
  perMonth: "/ Monat",
  benefits: [
    "Patientenliste mit individuellen TIR-, GMI- und CV-Werten",
    "PDF-Reports für jede Visite (3 Min Vorbereitungszeit)",
    "CGM-Integration (LibreLinkUp, Nightscout, Dexcom)",
    "DSGVO-konforme Datenhaltung in der EU",
    "Onboarding + Schulung inklusive",
  ],
  cta: "Pilot anfragen — klinik@glev.app",
  disclaimerBrand: "Glev Klinik",
  disclaimer:
    "ist aktuell kein eingereichtes Medizinprodukt. Die Pilot-Phase richtet sich an Diabetes-Schwerpunktpraxen, die Glev als Patientenkommunikations- und Auswertungs-Werkzeug einsetzen möchten. Endgültige MDR-Klasse-IIa-Einreichung in Vorbereitung.",
};

const EN: Content = {
  back: "← Back to home",
  subtitle:
    "Diabetes analytics for specialist clinics and medical centres. Patient reports, TIR tracking, HbA1c estimation (GMI), CGM sync — in one interface.",
  pilotLabel: "Pilot phase 2026",
  perMonth: "/ month",
  benefits: [
    "Patient list with individual TIR, GMI and CV values",
    "PDF reports for every visit (3 min preparation time)",
    "CGM integration (LibreLinkUp, Nightscout, Dexcom)",
    "GDPR-compliant data storage in the EU",
    "Onboarding and training included",
  ],
  cta: "Request pilot access — klinik@glev.app",
  disclaimerBrand: "Glev Clinic",
  disclaimer:
    "is not currently a registered medical device. The pilot phase is aimed at specialist diabetes practices that wish to use Glev as a patient communication and analytics tool. Full MDR Class IIa submission is in preparation.",
};

export default async function KlinikPage() {
  const locale = await getLocale();
  const C = locale === "en" ? EN : DE;

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
          {C.back}
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
          {C.subtitle}
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
              {C.pilotLabel}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
              <span style={{ fontSize: 48, fontWeight: 700, letterSpacing: "-0.02em" }}>€ 299</span>
              <span style={{ fontSize: 16, color: "var(--text-muted)" }}>{C.perMonth}</span>
            </div>
          </div>

          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            {C.benefits.map((b) => (
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
            {C.cta}
          </a>
        </div>

        <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55, margin: 0 }}>
          <strong>{C.disclaimerBrand}</strong>{" "}{C.disclaimer}
        </p>
      </div>
    </main>
  );
}
