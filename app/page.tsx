"use client";

import Link from "next/link";
// react hooks no longer needed — homepage is now stateless
import GlevLockup from "@/components/GlevLockup";
import AppMockupPhone from "@/components/AppMockupPhone";
import FeatureTrio from "@/components/landing/FeatureTrio";
import Steps from "@/components/landing/Steps";
import FeatureDeepDive from "@/components/landing/FeatureDeepDive";

const ACCENT  = "#4F6EF7";
const HOVER   = "#6B8BFF";
const GREEN   = "#22D3A0";
const ORANGE  = "#FF9500";
const PINK    = "#FF2D78";
const BG      = "#09090B";
const SURFACE = "#111117";
const SURF2   = "#0F0F14";
const BORDER  = "rgba(255,255,255,0.08)";

export default function Home() {
  return (
    <main
      style={{
        background: BG,
        color: "#fff",
        minHeight: "100dvh",
        fontFamily: "var(--font-inter), Inter, system-ui, sans-serif",
        position: "relative",
        overflow: "hidden",
        // Compensate for the now-fixed top nav (~56px content + iOS notch).
        paddingTop: "calc(56px + env(safe-area-inset-top))",
      }}
    >
      {/* Soft brand glow background */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(60% 60% at 80% 0%, rgba(79,110,247,0.18) 0%, rgba(79,110,247,0) 60%), radial-gradient(50% 50% at 0% 100%, rgba(34,211,160,0.10) 0%, rgba(34,211,160,0) 60%)",
          pointerEvents: "none",
        }}
      />

      <style>{`
        @keyframes glevSlideIn {
          from { opacity: 0; transform: scale(1.02); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes glevPulse {
          0%,100% { box-shadow: 0 0 0 0 ${ACCENT}55; }
          70%     { box-shadow: 0 0 0 12px ${ACCENT}00; }
        }
        .glev-cta-primary { transition: transform 0.15s, box-shadow 0.15s, background 0.15s; }
        .glev-cta-primary:hover { transform: translateY(-1px); background: ${HOVER}; box-shadow: 0 8px 24px ${ACCENT}55; }
        .glev-cta-ghost { transition: background 0.15s, border-color 0.15s; }
        .glev-cta-ghost:hover { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.18); }
        .glev-link { transition: color 0.15s; }
        .glev-link:hover { color: ${HOVER} !important; }
        .glev-secondary-link { transition: color 0.15s; }
        .glev-secondary-link:hover { color: rgba(255,255,255,0.9) !important; text-decoration: underline; text-underline-offset: 3px; }
        .glev-pricing-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }
        @media (max-width: 720px) {
          .glev-pricing-grid { grid-template-columns: 1fr; }
        }
        .glev-hero {
          display: grid;
          grid-template-columns: 1.1fr 0.9fr;
          gap: 64px;
          align-items: center;
        }
        .glev-feat-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 14px;
        }
        .glev-phone-stage { justify-self: end; }
        @media (max-width: 960px) {
          .glev-hero { grid-template-columns: 1fr; gap: 48px; }
          .glev-phone-stage { justify-self: center; }
          .glev-feat-grid { grid-template-columns: 1fr; }
          .glev-h1 { font-size: clamp(40px, 11vw, 64px) !important; }
        }
      `}</style>

      {/* TOP NAV — fixed-to-viewport so it never freezes mid-scroll on iOS
          Safari (the bug was: position:relative inside an overflow:hidden
          parent caused jittery momentum-scroll handover on iPhone 13 mini).
          Inner div keeps the 1180px max-width centering. Backdrop-blur over
          a translucent BG so content scrolls cleanly underneath, and
          safe-area-inset-top respects the notch. */}
      <nav
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          background: "rgba(9,9,11,0.72)",
          backdropFilter: "saturate(180%) blur(14px)",
          WebkitBackdropFilter: "saturate(180%) blur(14px)",
          borderBottom: `1px solid ${BORDER}`,
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            maxWidth: 1180,
            margin: "0 auto",
            padding: "14px 24px",
          }}
        >
          <Link href="/" style={{ textDecoration: "none", color: "inherit" }} aria-label="Glev home">
            <GlevLockup size={28} />
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            {/* Brand-Link bewusst aus dem Header entfernt — nur noch
                versteckt im Footer als Copyright-Tail erreichbar.
                Begründung: das Brand-Book ist Marketing-/Dev-Material,
                kein User-Pfad — soll im öffentlichen Header keinen
                Slot belegen. */}
            <Link
              href="/login"
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#fff",
                textDecoration: "none",
                padding: "9px 16px",
                borderRadius: 999,
                border: `1px solid ${BORDER}`,
                background: "rgba(255,255,255,0.03)",
              }}
              className="glev-cta-ghost"
            >
              Sign in
            </Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1180,
          margin: "0 auto",
          padding: "32px 24px 80px",
        }}
      >
        <div className="glev-hero">
          {/* LEFT: copy */}
          <div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 12px",
                borderRadius: 999,
                background: `${GREEN}14`,
                border: `1px solid ${GREEN}30`,
                color: GREEN,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: 24,
              }}
            >
              <span
                style={{
                  width: 6, height: 6, borderRadius: 99,
                  background: GREEN, animation: "glevPulse 2s ease-out infinite",
                }}
              />
              Private Beta · CGM Live
            </div>

            <h1
              className="glev-h1"
              style={{
                fontSize: "clamp(48px, 7.2vw, 84px)",
                fontWeight: 700,
                letterSpacing: "-0.035em",
                lineHeight: 1.02,
                margin: 0,
                color: "#fff",
              }}
            >
              Typ 1.<br />
              Neu gedacht<span style={{ color: GREEN }}>.</span>
            </h1>

            <p
              style={{
                marginTop: 24,
                fontSize: 18,
                lineHeight: 1.55,
                color: "rgba(255,255,255,0.7)",
                maxWidth: 520,
              }}
            >
              Sprich deine Mahlzeit. Glev liefert Makros per KI, vergleicht
              live mit deinem CGM und dokumentiert alles in einer Sekunde —
              gebaut von einem T1D, weil bestehende Apps zu langsam waren.
            </p>

            <div
              style={{
                marginTop: 32,
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                <Link
                  href="/pro"
                  className="glev-cta-primary"
                  style={{
                    padding: "14px 22px",
                    borderRadius: 12,
                    background: ACCENT,
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 700,
                    letterSpacing: "-0.005em",
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    boxShadow: `0 6px 18px ${ACCENT}40`,
                  }}
                >
                  Mitglied werden — €24,90/Monat
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="13 6 19 12 13 18" />
                  </svg>
                </Link>

                <Link
                  href="/login"
                  className="glev-cta-ghost"
                  style={{
                    padding: "14px 22px",
                    borderRadius: 12,
                    background: "transparent",
                    color: "rgba(255,255,255,0.85)",
                    fontSize: 14,
                    fontWeight: 600,
                    textDecoration: "none",
                    border: `1px solid ${BORDER}`,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  App öffnen
                </Link>
              </div>

              <Link
                href="/beta"
                className="glev-secondary-link"
                style={{
                  fontSize: 13,
                  color: "rgba(255,255,255,0.6)",
                  textDecoration: "none",
                  fontWeight: 500,
                  letterSpacing: "-0.005em",
                }}
              >
                Oder erstmal Platz reservieren für €19 →
              </Link>
            </div>

            <div
              style={{
                marginTop: 28,
                display: "inline-flex",
                alignItems: "center",
                gap: 14,
                fontFamily: "var(--font-mono), JetBrains Mono, monospace",
                fontSize: 12,
                color: "rgba(255,255,255,0.45)",
              }}
            >
              <span style={{ color: GREEN }}>● Libre 2</span>
              <span>·</span>
              <span style={{ color: "rgba(255,255,255,0.35)" }}>○ Dexcom</span>
              <span>·</span>
              <span style={{ color: "rgba(255,255,255,0.35)" }}>○ Nightscout</span>
            </div>
          </div>

          {/* RIGHT: iPhone with live, clickable app mockup */}
          <div className="glev-phone-stage">
            <AppMockupPhone hideTopCog />
          </div>
        </div>

        {/* FEATURE TRIO */}
        <div style={{ marginTop: 80 }}>
          <FeatureTrio />
        </div>
      </section>

      {/* HOW IT WORKS — 3 steps */}
      <section
        id="how"
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 760,
          margin: "0 auto",
          padding: "16px 24px 64px",
        }}
      >
        <h2
          style={{
            fontSize: "clamp(28px, 4vw, 36px)",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            margin: "0 0 28px",
            color: "#fff",
          }}
        >
          So funktioniert Glev
        </h2>
        <Steps />
      </section>

      {/* FEATURES IM DETAIL — 4 alternating rows with app screenshots */}
      <section
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1080,
          margin: "0 auto",
          padding: "16px 24px 80px",
        }}
      >
        <FeatureDeepDive />
      </section>

      {/* PRICING */}
      <section
        id="pricing"
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1180,
          margin: "0 auto",
          padding: "16px 24px 64px",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <h2
            style={{
              fontSize: "clamp(28px, 4vw, 36px)",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              margin: 0,
              color: "#fff",
            }}
          >
            Founder-Konditionen<span style={{ color: GREEN }}>.</span>
          </h2>
          <p
            style={{
              marginTop: 12,
              fontSize: 15,
              lineHeight: 1.55,
              color: "rgba(255,255,255,0.6)",
              maxWidth: 520,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            Vor dem öffentlichen Launch am 1. Juli 2026 — zwei Wege, sichere
            dir bessere Konditionen als nach Launch verfügbar sein werden.
          </p>
        </div>

        <div className="glev-pricing-grid">
          {/* Card 1 — Beta-Reservierung (secondary feel) */}
          <div
            style={{
              background: SURFACE,
              border: `1px solid ${ACCENT}`,
              borderRadius: 16,
              padding: 28,
              display: "flex",
              flexDirection: "column",
              gap: 20,
              position: "relative",
            }}
          >
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "#fff" }}>
                Beta-Reservierung
              </h3>
              <div style={{ marginTop: 14, display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: "-0.02em", color: "#fff" }}>€19</span>
                <span style={{ fontSize: 15, color: "rgba(255,255,255,0.6)" }}>einmalig</span>
              </div>
            </div>

            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                "Reservierung wird auf erstes Abo angerechnet",
                "€4,50/Monat im ersten Jahr nach Launch",
                "€9/Monat regulärer Preis danach",
                "Limitiert auf 500 Plätze",
              ].map((bullet) => (
                <PricingBullet key={bullet} text={bullet} />
              ))}
            </ul>

            <Link
              href="/beta"
              className="glev-cta-ghost"
              style={{
                marginTop: "auto",
                padding: "13px 22px",
                borderRadius: 12,
                background: "transparent",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: "-0.005em",
                textDecoration: "none",
                border: `1px solid ${ACCENT}`,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              Platz sichern
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="13 6 19 12 13 18" />
              </svg>
            </Link>
          </div>

          {/* Card 2 — Pro · Founder-Tier (primary, recommended) */}
          <div
            style={{
              background: SURFACE,
              border: `2px solid ${ACCENT}`,
              borderRadius: 16,
              padding: 28,
              display: "flex",
              flexDirection: "column",
              gap: 20,
              position: "relative",
              boxShadow: `0 12px 32px ${ACCENT}20`,
            }}
          >
            <div
              aria-label="Empfohlen"
              style={{
                position: "absolute",
                top: -12,
                left: 24,
                background: ACCENT,
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                padding: "4px 10px",
                borderRadius: 999,
                boxShadow: `0 4px 12px ${ACCENT}66`,
              }}
            >
              Empfohlen
            </div>

            <div>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "#fff" }}>
                Pro · Founder-Tier
              </h3>
              <div style={{ marginTop: 14, display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: "-0.02em", color: "#fff" }}>€24,90</span>
                <span style={{ fontSize: 15, color: "rgba(255,255,255,0.6)" }}>/Monat</span>
              </div>
            </div>

            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                "Karte heute hinterlegt, erste Buchung am Launch-Tag (1. Juli 2026)",
                "Direkter Founder-Slack-Zugang für Feedback und Fragen",
                "Lifetime-Preis-Lock — €24,90/Monat dauerhaft, auch nach späteren Preiserhöhungen",
                "Früher Access zu neuen CGM-Integrationen (Dexcom, Nightscout) sobald verfügbar",
                "Stimme bei Feature-Roadmap-Voting",
              ].map((bullet) => (
                <PricingBullet key={bullet} text={bullet} />
              ))}
            </ul>

            <Link
              href="/pro"
              className="glev-cta-primary"
              style={{
                marginTop: "auto",
                padding: "13px 22px",
                borderRadius: 12,
                background: ACCENT,
                color: "#fff",
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: "-0.005em",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                boxShadow: `0 6px 18px ${ACCENT}40`,
              }}
            >
              Mitglied werden
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="13 6 19 12 13 18" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section
        id="faq"
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 760,
          margin: "0 auto",
          padding: "16px 24px 80px",
        }}
      >
        <h2
          style={{
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            margin: "0 0 16px",
            color: "#fff",
          }}
        >
          FAQ
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {HOMEPAGE_FAQ.map((item) => (
            <details
              key={item.q}
              style={{
                background: SURFACE,
                border: `1px solid ${BORDER}`,
                borderRadius: 12,
                padding: "14px 16px",
              }}
            >
              <summary
                style={{
                  listStyle: "none",
                  cursor: "pointer",
                  fontSize: 15,
                  fontWeight: 600,
                  color: "#fff",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span>{item.q}</span>
                <span aria-hidden style={{ color: "rgba(255,255,255,0.5)", fontFamily: "var(--font-mono), JetBrains Mono, monospace" }}>+</span>
              </summary>
              <div style={{ fontSize: 14, color: "rgba(255,255,255,0.75)", lineHeight: 1.55, marginTop: 10 }}>
                {item.a}
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1180,
          margin: "0 auto",
          padding: "28px 24px 36px",
          borderTop: `1px solid ${BORDER}`,
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 12,
          color: "rgba(255,255,255,0.4)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <GlevLockup size={20} color="rgba(255,255,255,0.7)" />
          <span>
            © 2026 Glev · hello@glev.app
            {" · "}
            <Link
              href="/legal"
              style={{ color: "inherit", textDecoration: "none" }}
              aria-label="Datenschutzerklärung und AGB"
            >
              Datenschutz · AGB
            </Link>
            {/* Brand-Book Link, gut versteckt: gleiche Farbe wie Copyright,
                kein Underline, nur durch dezente Trenn-Mittelpunkt sichtbar.
                Bleibt für Direktaufruf via /brand erreichbar; SectionNav etc.
                im /brand selbst funktionieren wie bisher. */}
            {" · "}
            <Link
              href="/brand"
              style={{ color: "inherit", textDecoration: "none" }}
              aria-label="Glev Brand Book"
            >
              Brand
            </Link>
          </span>
        </div>
        <div style={{ maxWidth: 560, lineHeight: 1.5 }}>
          Glev ist ein Dokumentations- und Organisations-Tool, kein
          Medizinprodukt. Therapieentscheidungen triffst du in Absprache mit
          deinem Arzt.
        </div>
      </footer>
    </main>
  );
}


function PricingBullet({ text }: { text: string }) {
  return (
    <li style={{ display: "flex", gap: 10, fontSize: 14, lineHeight: 1.5, color: "rgba(255,255,255,0.85)" }}>
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: `${GREEN}1f`,
          color: GREEN,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 700,
          marginTop: 2,
        }}
      >
        ✓
      </span>
      <span>{text}</span>
    </li>
  );
}

const HOMEPAGE_FAQ: { q: string; a: string }[] = [
  {
    q: "Was kostet Glev nach dem öffentlichen Launch?",
    a: "Ab 1. Juli 2026 ist Glev als Standard-Abo für €9/Monat verfügbar. Wer vorher reserviert oder als Pro-Mitglied startet, sichert sich Founder-Konditionen, die später nicht mehr verfügbar sein werden — die Beta-Reservierung gibt €4,50/Monat im ersten Jahr (statt €9), die Pro-Mitgliedschaft fixiert €24,90/Monat als Lifetime-Preis-Lock.",
  },
  {
    q: "Welche CGMs werden unterstützt?",
    a: "Aktuell FreeStyle Libre 2 via LibreLinkUp. Dexcom G6/G7 sind in Arbeit. Nightscout-Support folgt.",
  },
  {
    q: "Ist Glev ein Medizinprodukt?",
    a: "Nein. Glev ist ein Dokumentations- und Organisations-Tool. Therapieentscheidungen triffst du weiter mit deinem Arzt.",
  },
  {
    q: "Wo werden meine Daten gespeichert?",
    a: "In der EU (Supabase Frankfurt). Deutsche DSGVO. Keine Datenweitergabe, keine Werbung.",
  },
];

