"use client";

import { Suspense, useState } from "react";
import AppMockupPhone from "@/components/AppMockupPhone";
import FAQ from "@/components/landing/FAQ";
import FeatureTrio from "@/components/landing/FeatureTrio";
import FounderSection from "@/components/landing/FounderSection";
import LandingFooter from "@/components/landing/Footer";
import Lockup from "@/components/landing/Lockup";
import PricingCard from "@/components/landing/PricingCard";
import Steps from "@/components/landing/Steps";
import {
  ACCENT,
  ACCENT_HOVER,
  BG,
  BORDER,
  LAUNCH_DATE_LABEL,
  MINT,
  SURFACE,
  TEXT_DIM,
} from "@/components/landing/tokens";

/**
 * Primary CTA — routes visitors to the unified /beta reservation funnel
 * during the pre-launch phase, instead of going direct-to-Stripe for the
 * monthly subscription. (Old Stripe payment link kept commented in git
 * history if direct sub purchases need to be re-enabled later.)
 */
function ProCTALink() {
  const [hover, setHover] = useState(false);
  return (
    <a
      href="/beta"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: hover ? ACCENT_HOVER : ACCENT,
        color: "#fff",
        textDecoration: "none",
        border: "none",
        borderRadius: 12,
        padding: "16px 32px",
        fontSize: 18,
        fontWeight: 600,
        fontFamily: "inherit",
        minHeight: 56,
        cursor: "pointer",
        boxShadow: hover ? "0 0 0 4px rgba(79,110,247,0.25)" : "0 0 0 0 rgba(79,110,247,0)",
        transition: "background 120ms ease, box-shadow 120ms ease",
        outlineColor: "rgba(79,110,247,0.4)",
        boxSizing: "border-box",
      }}
    >
      Frühzugang testen
    </a>
  );
}

/**
 * /pro — direct monthly-subscription landing page.
 * A/B partner to /beta. No reservation deposit, no seat counter, billing
 * begins on the public launch date (1 July 2026) via a Stripe trial.
 */
function ProContent() {

  return (
    <main
      style={{
        minHeight: "100vh",
        background: BG,
        color: "#fff",
        padding: "48px 0 64px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`
        .glev-hero-2col {
          display: grid;
          grid-template-columns: 1.05fr 0.95fr;
          gap: 56px;
          align-items: center;
        }
        .glev-feat-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 24px;
          max-width: 900px;
          margin: 0 auto;
        }
        .glev-feat-grid > div { height: 100%; }
        .glev-phone-stage { justify-self: end; }
        .glev-hero-form { width: 100%; max-width: 420px; }
        @media (max-width: 960px) {
          .glev-hero-2col { grid-template-columns: 1fr; gap: 40px; }
          .glev-phone-stage { justify-self: center; }
          .glev-hero-form { max-width: none; }
          .glev-hero-left { align-items: center !important; text-align: center !important; }
          .glev-hero-meta { justify-content: center !important; }
        }
        .glev-scenario-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        @media (max-width: 640px) {
          .glev-feat-grid { grid-template-columns: 1fr; }
          .glev-scenario-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      {/* 1. Hero — text/CTA left, app render right (stacks on mobile) */}
      <section
        style={{
          width: "100%",
          maxWidth: 1180,
          margin: "0 auto 56px",
          padding: "0 20px",
          boxSizing: "border-box",
        }}
      >
        <div className="glev-hero-2col">
          <div
            className="glev-hero-left"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              textAlign: "left",
              gap: 20,
            }}
          >
            <Lockup width={200} />
            <h1
              style={{
                fontSize: "clamp(40px, 6.4vw, 64px)",
                lineHeight: 1.04,
                letterSpacing: "-0.03em",
                fontWeight: 700,
                color: "#fff",
                margin: 0,
              }}
            >
              Einmal sprechen.<br />Makros berechnet.<br />CGM verknüpft.
            </h1>
            <p style={{ fontSize: 18, lineHeight: 1.5, color: TEXT_DIM, margin: 0, maxWidth: 520 }}>
              Sprach-Log. KI-Makros. CGM live. In unter 10 Sekunden dokumentiert.
            </p>

            <div
              className="glev-hero-form"
              style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}
            >
              <ProCTALink />
            </div>

            <div
              className="glev-hero-meta"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 14,
                color: MINT,
                marginTop: 4,
                flexWrap: "wrap",
              }}
            >
              <span aria-hidden>↺</span>
              <span>Erste Abbuchung am {LAUNCH_DATE_LABEL} · jederzeit kündbar</span>
            </div>
          </div>

          <div className="glev-phone-stage">
            <AppMockupPhone hideTopCog />
          </div>
        </div>
      </section>

      {/* 1b. Scenario — Aha-Moment block (Vorher / Nachher) */}
      <section
        style={{
          width: "100%",
          maxWidth: 760,
          margin: "0 auto 56px",
          padding: "0 20px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            background: SURFACE,
            border: `1px solid ${BORDER}`,
            borderRadius: 16,
            padding: "24px 24px 28px",
          }}
        >
          <p
            style={{
              fontSize: 16,
              lineHeight: 1.55,
              color: "#fff",
              margin: "0 0 20px",
            }}
          >
            Du bist bei <strong>112 mg/dL</strong>. Du willst gleich <strong>60 g Kohlenhydrate</strong> essen. Dein Wert steigt leicht.
          </p>
          <div className="glev-scenario-grid">
            <div
              style={{
                background: BG,
                border: `1px solid ${BORDER}`,
                borderRadius: 12,
                padding: 16,
              }}
            >
              <strong
                style={{
                  display: "block",
                  fontSize: 12,
                  color: "rgba(255,255,255,0.55)",
                  marginBottom: 6,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                Ohne Glev
              </strong>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "rgba(255,255,255,0.85)" }}>
                Du spritzt sofort → später 220 mg/dL. Überzucker.
              </p>
            </div>
            <div
              style={{
                background: BG,
                border: `1px solid ${ACCENT}55`,
                borderRadius: 12,
                padding: 16,
              }}
            >
              <strong
                style={{
                  display: "block",
                  fontSize: 12,
                  color: ACCENT,
                  marginBottom: 6,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                Mit Glev
              </strong>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "rgba(255,255,255,0.85)" }}>
                Du wartest 10 Minuten → stabil bei 140. Fertig.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Steps */}
      <section
        style={{
          width: "100%",
          maxWidth: 680,
          margin: "0 auto 56px",
          padding: "0 20px",
          boxSizing: "border-box",
        }}
      >
        <Steps />
      </section>

      {/* 3. Feature cards (replaces the old bullet list) */}
      <section
        style={{
          width: "100%",
          maxWidth: 1080,
          margin: "0 auto 56px",
          padding: "0 20px",
          boxSizing: "border-box",
        }}
      >
        <FeatureTrio
          items={[
            {
              color: ACCENT,
              title: "Trend erkannt",
              text: "Nicht nur der aktuelle Wert — Glev sieht, wohin er geht.",
            },
            {
              color: MINT,
              title: "Mahlzeit einberechnet",
              text: "Kohlenhydrate, Protein, Fett — alles fließt in die Empfehlung ein.",
            },
            {
              color: "#FF9500",
              title: "Timing angepasst",
              text: "Wann spritzen, nicht nur wie viel — der Unterschied zwischen 140 und 220.",
            },
          ]}
          extra={{
            color: "#FF2D78",
            title: "Arztbericht als PDF",
            text: "Dein Tracking — fertig aufbereitet für das nächste Arztgespräch. Automatisch generiert.",
          }}
        />
      </section>

      {/* 4. Pricing */}
      <section
        style={{
          width: "100%",
          maxWidth: 680,
          margin: "0 auto 56px",
          padding: "0 20px",
          boxSizing: "border-box",
        }}
      >
        <PricingCard
          heading="Was du bekommst"
          lines={[
            { left: `€24,90 / Monat — ab dem ${LAUNCH_DATE_LABEL}`, right: "kein Aufschlag, kein Versteckspiel" },
            { left: "Karte wird heute hinterlegt — heute keine Buchung", right: "erste Abbuchung am Launch-Tag" },
            { left: "Jederzeit kündbar", right: "im Account-Bereich oder per Email an hello@glev.app" },
          ]}
        />
      </section>

      {/* 5. Founder — Lucas's diagnosis story, directly above FAQ */}
      <section
        style={{
          width: "100%",
          maxWidth: 680,
          margin: "0 auto 56px",
          padding: "0 20px",
          boxSizing: "border-box",
        }}
      >
        <FounderSection />
      </section>

      {/* 6. FAQ */}
      <section
        style={{
          width: "100%",
          maxWidth: 680,
          margin: "0 auto 56px",
          padding: "0 20px",
          boxSizing: "border-box",
        }}
      >
        <FAQ items={PRO_FAQ} />
      </section>

      {/* 7. Footer */}
      <section
        style={{
          width: "100%",
          maxWidth: 680,
          margin: "0 auto",
          padding: "0 20px",
          boxSizing: "border-box",
        }}
      >
        <LandingFooter />
      </section>
    </main>
  );
}

const PRO_FAQ = [
  {
    q: "Welche CGMs werden unterstützt?",
    a: "Aktuell FreeStyle Libre 2 via LibreLinkUp. Dexcom G6/G7 sind in Arbeit. Nightscout-Support folgt.",
  },
  {
    q: "Was passiert wenn ich vor dem Launch kündige?",
    a: "Du kannst die Mitgliedschaft jederzeit vor dem 1. Juli 2026 ohne Folgen beenden. Es wird dann nichts abgebucht.",
  },
  {
    q: "Ist Glev ein Medizinprodukt?",
    a: "Nein. Glev ist ein Dokumentations- und Organisations-Tool. Therapieentscheidungen triffst du weiter mit deinem Arzt.",
  },
  {
    q: "Was unterscheidet diese Mitgliedschaft von der Beta-Reservierung?",
    a: "Die /beta-Variante ist eine €19 Einmalreservierung mit Beta-Discount im ersten Jahr. /pro ist eine direkte Monats-Mitgliedschaft ohne Reservierungseinsatz, dafür zum vollen Preis. Beide bekommen Zugang am 1. Juli 2026.",
  },
  {
    q: "Wo werden meine Daten gespeichert?",
    a: "In der EU (Supabase Frankfurt). Deutsche DSGVO. Keine Datenweitergabe, keine Werbung.",
  },
];

/**
 * Suspense wrapper required by Next.js 14+ when a client component uses
 * useSearchParams() — without it the static prerender fails with
 * "useSearchParams() should be wrapped in a suspense boundary". The
 * fallback is null because /pro is a "use client" page that hydrates
 * immediately; there's no meaningful skeleton to show in the brief
 * server-render gap.
 */
export default function ProPage() {
  return (
    <Suspense fallback={null}>
      <ProContent />
    </Suspense>
  );
}
