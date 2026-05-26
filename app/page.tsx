"use client";

// Marketing-Homepage. Vorher unter /preview iteriert und am 5. Mai 2026
// von Lucas auf live geschaltet (alte /preview-Route wurde entfernt,
// dieser Inhalt ersetzt nun die produktive Homepage 1:1).
//
// Struktur:
//   * Hero-Copy + 2 CTAs
//   * "Immediate Value"-Sektion direkt nach dem Hero
//   * Pain-Bullets
//   * System-Flow-Sektion
//   * FeatureTrio mit eigener Section-Headline
//   * Features-im-Detail: statische App-Renders aus /public/mockups/
//   * Positioning-Block vor der Pricing-Sektion
//   * Pricing: 3 Karten (Beta, Pro · Founder-Tier hervorgehoben,
//     Klinik mit Coming-Soon-Email-Warteliste statt CTA)
//   * Compliance-Disclaimer direkt vor dem globalen Footer
// FAQ, Nav und Footer ziehen ihre Texte aus dem `marketing`-Namespace.

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import GlevLockup from "@/components/GlevLockup";
import AppMockupPhone from "@/components/AppMockupPhone";
import FeatureTrio from "@/components/landing/FeatureTrio";
import CGMCompatibility from "@/components/landing/CGMCompatibility";
import LocaleSwitcher from "@/components/LocaleSwitcher";

const ACCENT  = "#4F6EF7";
const HOVER   = "#6B8BFF";
const GREEN   = "#22D3A0";
const BG      = "var(--bg)";
const SURFACE = "var(--surface)";
const BORDER  = "var(--border)";

export default function PreviewHome() {
  const t  = useTranslations("marketing");
  const tp = useTranslations("preview");
  return (
    <main
      style={{
        background: BG,
        color: "var(--text)",
        // Sticky-footer pattern: main is a column flex container that
        // always fills at least the dynamic viewport height. Combined
        // with `marginTop: auto` on the footer below, this pushes the
        // footer to the bottom edge whenever the content is shorter
        // than the viewport (large desktop screens, short pages) while
        // still letting long pages scroll normally without a double
        // scrollbar. Only clip the X-axis — `overflow: hidden` (both
        // axes) was clipping the vertical scroll too, so users could
        // not scroll the page at all (2026-05-18 regression report).
        // Task #357 (2026-05-18, fixed 2026-05-18).
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--font-inter), Inter, system-ui, sans-serif",
        position: "relative",
        overflowX: "hidden",
        paddingTop: "var(--marketing-header-total)",
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
        @keyframes glevPulse {
          0%,100% { box-shadow: 0 0 0 0 ${ACCENT}55; }
          70%     { box-shadow: 0 0 0 12px ${ACCENT}00; }
        }
        .glev-cta-primary { transition: transform 0.15s, box-shadow 0.15s, background 0.15s; }
        .glev-cta-primary:hover { transform: translateY(-1px); background: ${HOVER}; box-shadow: 0 8px 24px ${ACCENT}55; }
        .glev-cta-ghost { transition: background 0.15s, border-color 0.15s; }
        .glev-cta-ghost:hover { background: var(--surface-soft); border-color: var(--border-strong); }
        .glev-link { transition: color 0.15s; }
        .glev-link:hover { color: ${HOVER} !important; }
        .glev-pricing-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 20px;
          align-items: stretch;
        }
        @media (max-width: 1080px) {
          .glev-pricing-grid { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width: 720px) {
          .glev-pricing-grid { grid-template-columns: 1fr; }
        }
        .glev-feat-row {
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 56px;
          align-items: center;
        }
        @media (max-width: 720px) {
          .glev-feat-row { grid-template-columns: 1fr !important; gap: 24px !important; }
        }
        @media (min-width: 721px) {
          .glev-feat-row--rev .glev-feat-row__img { order: 2; }
        }
        .glev-hero {
          display: grid;
          grid-template-columns: 1.1fr 0.9fr;
          gap: 64px;
          align-items: center;
        }
        .glev-phone-stage { justify-self: end; }
        .glev-feat-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 14px;
        }
        @media (max-width: 960px) {
          .glev-hero { grid-template-columns: 1fr; gap: 48px; }
          .glev-phone-stage { justify-self: center; }
          .glev-feat-grid { grid-template-columns: 1fr; }
          .glev-h1 { font-size: clamp(40px, 11vw, 64px) !important; }
        }
        /* iPhone 13 mini (375px) and similar narrow viewports: tighten
           the section gutter so the 320px hero phone frame plus its
           drop-shadow fits without forcing a horizontal scroll, and so
           the pricing cards have a visible right border. */
        @media (max-width: 420px) {
          .glev-section-mobile-tight { padding-left: 16px !important; padding-right: 16px !important; }
        }
      `}</style>

      {/* TOP NAV */}
      <nav
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          background: "color-mix(in srgb, var(--bg) 72%, transparent)",
          backdropFilter: "saturate(180%) blur(14px)",
          WebkitBackdropFilter: "saturate(180%) blur(14px)",
          borderBottom: `1px solid ${BORDER}`,
          paddingTop: "var(--safe-top)",
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
          <Link href="/" style={{ textDecoration: "none", color: "inherit" }} aria-label={t("nav_aria_home")}>
            <GlevLockup size={28} />
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Link
              href="/blog"
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text)",
                textDecoration: "none",
              }}
              className="glev-link"
            >
              {t("nav_blog")}
            </Link>
            <Link
              href="/#pricing"
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "white",
                textDecoration: "none",
                padding: "9px 16px",
                borderRadius: 999,
                background: `linear-gradient(135deg, #4F6EF7, #6B8BFF)`,
              }}
            >
              {t("nav_register")}
            </Link>
            <Link
              href="/login"
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text)",
                textDecoration: "none",
                padding: "9px 16px",
                borderRadius: 999,
                border: `1px solid ${BORDER}`,
                background: "var(--surface-soft)",
              }}
              className="glev-cta-ghost"
            >
              {t("nav_signin")}
            </Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section
        className="glev-section-mobile-tight"
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1180,
          margin: "0 auto",
          padding: "32px 24px 80px",
        }}
      >
        <div className="glev-hero">
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
              {t("hero_badge")}
            </div>

            <h1
              className="glev-h1"
              style={{
                fontSize: "clamp(48px, 7.2vw, 84px)",
                fontWeight: 700,
                letterSpacing: "-0.035em",
                lineHeight: 1.02,
                margin: 0,
                color: "var(--text)",
              }}
            >
              {tp("hero_h1")}<span style={{ color: GREEN }}>.</span>
            </h1>

            <p
              style={{
                marginTop: 24,
                fontSize: 18,
                lineHeight: 1.55,
                color: "var(--text-body)",
                maxWidth: 520,
              }}
            >
              {tp("hero_subtitle")}
            </p>

            <div
              style={{
                marginTop: 32,
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
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
                {tp("hero_cta_primary")}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="13 6 19 12 13 18" />
                </svg>
              </Link>

              <Link
                href="/beta"
                className="glev-cta-ghost"
                style={{
                  padding: "14px 22px",
                  borderRadius: 12,
                  background: "transparent",
                  color: "var(--text-strong)",
                  fontSize: 14,
                  fontWeight: 600,
                  textDecoration: "none",
                  border: `1px solid ${BORDER}`,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {tp("hero_cta_secondary")}
              </Link>
            </div>

            {/* Support-Line — drei Mini-Beweise direkt unter den CTAs.
                Bewusst klein und in Mono gesetzt, damit sie als
                "Untertitel-Strip" liest, nicht als zusätzliche CTA. */}
            <p
              style={{
                marginTop: 24,
                fontSize: 12,
                color: "var(--text-dim)",
                fontFamily: "var(--font-mono), JetBrains Mono, monospace",
                letterSpacing: "-0.005em",
                lineHeight: 1.55,
              }}
            >
              {tp("hero_support")}
            </p>

            {/* CGM-Status-Strip (identisch zur Homepage) */}
            <div
              style={{
                marginTop: 28,
                display: "inline-flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 14,
                rowGap: 8,
                fontFamily: "var(--font-mono), JetBrains Mono, monospace",
                fontSize: 12,
                color: "var(--text-dim)",
              }}
            >
              <span style={{ color: GREEN }}>● {tp("cgm_libre")}</span>
              <span>·</span>
              <span style={{ color: GREEN }}>● Nightscout</span>
              <span>·</span>
              <span style={{ color: GREEN }}>● {tp("cgm_dexcom_planned")}</span>
              <span>·</span>
              <span style={{ color: "var(--text-dim)" }}>● {tp("cgm_medtronic_planned")}</span>
            </div>
          </div>

          <div className="glev-phone-stage">
            <AppMockupPhone />
          </div>
        </div>
      </section>

      {/* IMMEDIATE VALUE — eine Aussage, die direkt nach dem Hero den
          Nutzen in einem Satz spiegelt. Bewusst zentriert und ohne
          Card-Background, damit sie wie ein Manifest-Statement wirkt
          und nicht wie ein weiteres Feature-Modul. */}
      <section
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 760,
          margin: "0 auto",
          padding: "8px 24px 48px",
          textAlign: "center",
        }}
      >
        <h2
          style={{
            fontSize: "clamp(24px, 3.4vw, 32px)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            lineHeight: 1.2,
            margin: 0,
            color: "var(--text)",
          }}
        >
          {tp("value_title")}
        </h2>
        <p
          style={{
            marginTop: 16,
            fontSize: 16,
            lineHeight: 1.6,
            color: "var(--text-body)",
            maxWidth: 620,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          {tp("value_body")}
        </p>
      </section>


      {/* PAIN BLOCK — neue Bullets, gleiche Card-Optik wie auf der
          Homepage, damit das Layout vergleichbar bleibt. */}
      <section
        id="pain"
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 760,
          margin: "0 auto",
          padding: "16px 24px 64px",
        }}
      >
        <div
          style={{
            background: SURFACE,
            border: `1px solid ${BORDER}`,
            borderRadius: 16,
            padding: "28px 28px 30px",
          }}
        >
          <h2
            style={{
              fontSize: "clamp(22px, 3.2vw, 28px)",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              lineHeight: 1.2,
              margin: 0,
              color: "var(--text)",
            }}
          >
            {tp("pain_title")}
          </h2>
          <ul
            style={{
              listStyle: "none",
              margin: "20px 0 0",
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {[tp("pain_b1"), tp("pain_b2"), tp("pain_b3")].map((bullet, i) => (
              <li
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  fontSize: 15,
                  lineHeight: 1.55,
                  color: "var(--text-body)",
                  overflowWrap: "anywhere",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 99,
                    background: GREEN,
                    marginTop: 9,
                    flexShrink: 0,
                  }}
                />
                <span style={{ minWidth: 0 }}>{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* SYSTEM FLOW — ersetzt die alte Steps-Komponente. Eine Zeile
          Pfeile als visueller Ablauf, darunter ein einsatzschließender
          Erklärsatz. */}
      <section
        id="flow"
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 760,
          margin: "0 auto",
          padding: "16px 24px 64px",
          textAlign: "center",
        }}
      >
        <h2
          style={{
            fontSize: "clamp(24px, 3.4vw, 32px)",
            fontWeight: 700,
            letterSpacing: "-0.025em",
            margin: 0,
            color: "var(--text)",
            lineHeight: 1.25,
          }}
        >
          {tp("flow_title")}
        </h2>
        <p
          style={{
            marginTop: 16,
            fontSize: 15,
            lineHeight: 1.6,
            color: "var(--text-body)",
            maxWidth: 620,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          {tp("flow_body")}
        </p>
      </section>

      {/* FEATURE TRIO — gleiche Komponente wie Homepage, jetzt mit
          eigener Section-Headline darüber. */}
      <section
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1180,
          margin: "0 auto",
          padding: "16px 24px 48px",
        }}
      >
        <h2
          style={{
            fontSize: "clamp(24px, 3.4vw, 32px)",
            fontWeight: 700,
            letterSpacing: "-0.025em",
            margin: "0 0 24px",
            color: "var(--text)",
            textAlign: "center",
          }}
        >
          {tp("features_title")}
        </h2>
        <FeatureTrio />
      </section>

      {/* FEATURES IM DETAIL — 4 alternierende Rows mit echten App-
          Renders aus /public/mockups/ (dashboard / engine / entries /
          insights). Statische Bilder statt live iframes weil Lucas die
          Marketing-Surface ruhiger und schneller will und es einfacher
          ist, Screenshots regelmäßig auszutauschen als die dark-cockpit-
          Mockups synchron zu halten. */}
      <section
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1080,
          margin: "0 auto",
          padding: "16px 24px 80px",
        }}
      >
        <h2
          style={{
            fontSize: "clamp(28px, 4vw, 36px)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            margin: "0 0 56px",
            color: "var(--text)",
            textAlign: "center",
          }}
        >
          {t("deepdive_title")}
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 80 }}>
          {[
            {
              img: "",
              title: t("deepdive_voice_title"),
              body: t("deepdive_voice_body"),
              liveNode: (
                <div style={{ width: "min(320px, 100%)" }}>
                  <AppMockupPhone lockTab="engine" hideTopCog />
                </div>
              ),
            },
            { img: "/mockups/entries.png",  title: t("deepdive_macro_title"),    body: t("deepdive_macro_body") },
            {
              img: "",
              title: t("deepdive_cgm_title"),
              body: t("deepdive_cgm_body"),
              liveNode: (
                <LivePhoneScaler>
                  <AppMockupPhone lockTab="dashboard" hideTopCog />
                </LivePhoneScaler>
              ),
            },
            { img: "/mockups/insights.png", title: t("deepdive_insights_title"), body: t("deepdive_insights_body") },
          ].map((row, i) => (
            <FeatureImageRow key={row.title} row={row} reverse={i % 2 === 1} />
          ))}
        </div>
      </section>

      {/* CGM COMPATIBILITY — Check-Layer vor Positioning/Pricing */}
      <section
        style={{
          position: "relative",
          zIndex: 1,
          padding: "0 0 32px",
        }}
      >
        <CGMCompatibility />
      </section>

      {/* POSITIONING BLOCK — kurzes, kategorisches Statement, das Glev
          gegenüber Tracking-Apps und Hardware abgrenzt. Akzent-Border
          links, damit es als Zitat / Manifest liest. */}
      <section
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 760,
          margin: "0 auto",
          padding: "16px 24px 64px",
        }}
      >
        <div
          style={{
            borderLeft: `3px solid ${ACCENT}`,
            paddingLeft: 20,
          }}
        >
          <p
            style={{
              fontSize: "clamp(20px, 2.8vw, 26px)",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              lineHeight: 1.3,
              margin: 0,
              color: "var(--text)",
            }}
          >
            {tp("positioning_title")}
          </p>
          <p
            style={{
              marginTop: 12,
              fontSize: 15,
              lineHeight: 1.6,
              color: "var(--text-body)",
            }}
          >
            {tp("positioning_body")}
          </p>
        </div>
      </section>

      {/* PRICING — S/M/L-Struktur für Presale-Tiers:
          Smart (€9/Mo, Early-Access-Badge) → Pro (€14,90/Mo, Most-Popular-
          Badge, hervorgehoben) → Glev+ (€29/Mo, für Eltern/Caregiver).
          B2B-Klinik (€299/Mo) ist als eigene Landing Page /klinik
          ausgelagert und wird nur noch als Text-Link unter dem Grid
          referenziert — sie passt nicht ins B2C-Tier-Ranking. */}
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
              color: "var(--text)",
            }}
          >
            {t("pricing_title")}<span style={{ color: GREEN }}>.</span>
          </h2>
          <p
            style={{
              marginTop: 12,
              fontSize: 15,
              lineHeight: 1.55,
              color: "var(--text-muted)",
              maxWidth: 520,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            {t("pricing_subtitle")}
          </p>
        </div>

        <div className="glev-pricing-grid">
          {/* Karte 1 — Glev Smart (S, €9/Mo, Early-Access-Badge) */}
          <div
            style={{
              background: SURFACE,
              border: `1px solid ${BORDER}`,
              borderRadius: 16,
              padding: 28,
              display: "flex",
              flexDirection: "column",
              gap: 20,
              position: "relative",
            }}
          >
            <div
              aria-label={t("pricing_beta_badge")}
              style={{
                position: "absolute",
                top: -12,
                left: 24,
                background: "var(--surface-soft, #232329)",
                color: "var(--text-muted)",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                padding: "4px 10px",
                borderRadius: 999,
                border: `1px solid ${BORDER}`,
              }}
            >
              {t("pricing_beta_badge")}
            </div>

            <div>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "var(--text)" }}>
                {t("pricing_beta_title")}
              </h3>
              <div style={{ marginTop: 14, display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text)" }}>{t("pricing_beta_price")}</span>
                <span style={{ fontSize: 15, color: "var(--text-muted)" }}>{t("pricing_beta_period")}</span>
              </div>
              <p style={{ margin: "6px 0 0 0", fontSize: 12.5, color: "var(--text-muted)", letterSpacing: "-0.005em" }}>
                {t("pricing_beta_sublabel")}
              </p>
            </div>

            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                t("pricing_beta_b1"),
                t("pricing_beta_b2"),
                t("pricing_beta_b3"),
                t("pricing_beta_b4"),
              ].map((bullet) => (
                <PricingBullet key={bullet} text={bullet} />
              ))}
            </ul>

            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono), JetBrains Mono, monospace",
                letterSpacing: "-0.005em",
                lineHeight: 1.55,
              }}
            >
              {t("pricing_beta_subtext")}
            </p>

            <Link
              href="/beta"
              className="glev-cta-ghost"
              style={{
                marginTop: "auto",
                padding: "13px 22px",
                borderRadius: 12,
                background: "transparent",
                color: "var(--text)",
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
              {t("pricing_beta_cta")}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="13 6 19 12 13 18" />
              </svg>
            </Link>
          </div>

          {/* Karte 2 — Pro · Founder-Tier (hervorgehoben) */}
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
              aria-label={t("pricing_pro_badge")}
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
              {t("pricing_pro_badge")}
            </div>

            <div>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "var(--text)" }}>
                {t("pricing_pro_title")}
              </h3>
              <div style={{ marginTop: 14, display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text)" }}>{t("pricing_pro_price")}</span>
                <span style={{ fontSize: 15, color: "var(--text-muted)" }}>{t("pricing_pro_period")}</span>
              </div>
              <p style={{ margin: "6px 0 0 0", fontSize: 12.5, color: "var(--text-muted)", letterSpacing: "-0.005em" }}>
                {t("pricing_pro_sublabel")}
              </p>
            </div>

            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                t("pricing_pro_b1"),
                t("pricing_pro_b2"),
                t("pricing_pro_b3"),
                t("pricing_pro_b4"),
                t("pricing_pro_b5"),
                t("pricing_pro_b6"),
              ].map((bullet) => (
                <PricingBullet key={bullet} text={bullet} />
              ))}
            </ul>

            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono), JetBrains Mono, monospace",
                letterSpacing: "-0.005em",
                lineHeight: 1.55,
              }}
            >
              {t("pricing_pro_subtext")}
            </p>

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
              {t("pricing_pro_cta")}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="13 6 19 12 13 18" />
              </svg>
            </Link>
          </div>

          {/* Karte 3 — Glev+ (L, €29/Mo, Caregiver-Tier). CTA POSTet an
              /api/checkout/plus und redirected zur Stripe-Hosted-Page. */}
          <PlusCard />
        </div>

        {/* B2B-Link unter dem Tier-Grid — der Klinik-Tarif (€299/Mo)
            wird nicht mehr als eigene Karte gezeigt, sondern hat eine
            dedizierte Landing Page. */}
        <div style={{ marginTop: 32, textAlign: "center" }}>
          <Link
            href="/klinik"
            style={{
              fontSize: 14,
              color: "var(--text-muted)",
              textDecoration: "none",
              borderBottom: "1px solid var(--border)",
              paddingBottom: 2,
              letterSpacing: "-0.005em",
            }}
          >
            {t("pricing_b2b_link")}
          </Link>
        </div>
      </section>

      {/* FAQ — komplett identisch zur Homepage. */}
      <section
        id="faq"
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 760,
          margin: "0 auto",
          padding: "16px 24px 48px",
        }}
      >
        <h2
          style={{
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            margin: "0 0 16px",
            color: "var(--text)",
          }}
        >
          {t("faq_title")}
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {([
            { q: t("faq_q1"), a: t("faq_a1") },
            { q: t("faq_q2"), a: t("faq_a2") },
            {
              q: t("faq_q5"),
              a: (
                <>
                  {t("faq_a5").split("/setup")[0]}
                  <Link
                    href="/setup"
                    style={{ color: ACCENT, textDecoration: "underline", textUnderlineOffset: 2 }}
                  >
                    /setup
                  </Link>
                  {t("faq_a5").split("/setup")[1] ?? ""}
                </>
              ),
            },
            { q: t("faq_q6"), a: t("faq_a6") },
            { q: t("faq_q7"), a: t("faq_a7") },
            { q: t("faq_q3"), a: t("faq_a3") },
            { q: t("faq_q4"), a: t("faq_a4") },
            { q: t("faq_q8"), a: t("faq_a8") },
          ] as { q: string; a: React.ReactNode }[]).map((item) => (
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
                  color: "var(--text)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span>{item.q}</span>
                <span aria-hidden style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono), JetBrains Mono, monospace" }}>+</span>
              </summary>
              <div style={{ fontSize: 14, color: "var(--text-body)", lineHeight: 1.55, marginTop: 10 }}>
                {item.a}
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* COMPLIANCE — kleiner muted Hinweis, bewusst KEIN Fettdruck.
          Sitzt direkt vor dem globalen Footer und gibt der Seite einen
          rechtssauberen Abschluss, ohne das Pricing-Block-Layout zu
          stören. */}
      <section
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 760,
          margin: "0 auto",
          padding: "0 24px 32px",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 12,
            lineHeight: 1.55,
            color: "var(--text-faint)",
            textAlign: "center",
          }}
        >
          {tp("compliance")}
        </p>
      </section>

      {/* FOOTER — identisch zur Homepage.
          `marginTop: auto` pairs with the column-flex `<main>` above to
          push the footer to the viewport bottom when the page content
          is shorter than the viewport (Task #357). The inner content
          stays capped at 1180 px and horizontally centred via the
          left/right auto margins. */}
      <footer
        style={{
          position: "relative",
          zIndex: 1,
          marginTop: "auto",
          width: "100%",
          maxWidth: 1180,
          marginLeft: "auto",
          marginRight: "auto",
          padding: "28px 24px calc(36px + var(--safe-bottom))",
          borderTop: `1px solid ${BORDER}`,
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 12,
          color: "var(--text-faint)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <GlevLockup size={20} color="var(--text-body)" />
          <span>
            {t("footer_copyright")}
            {" · "}
            <Link
              href="/legal"
              style={{ color: "inherit", textDecoration: "none" }}
              aria-label={t("footer_legal_aria")}
            >
              {t("footer_legal")}
            </Link>
            {" · "}
            <Link
              href="/legal"
              style={{ color: "inherit", textDecoration: "none" }}
              aria-label={t("footer_impressum_aria")}
            >
              {t("footer_impressum")}
            </Link>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <LocaleSwitcher size="xs" ariaLabel={t("nav_aria_locale")} />
          <div style={{ maxWidth: 560, lineHeight: 1.5 }}>
            {t("footer_disclaimer")}
          </div>
        </div>
      </footer>
    </main>
  );
}


function PricingBullet({ text }: { text: string }) {
  return (
    <li style={{ display: "flex", gap: 10, fontSize: 14, lineHeight: 1.5, color: "var(--text-strong)" }}>
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

/** Eine alternierende Feature-Detail-Row mit App-Render im Phone-Frame
 *  (gleiche Optik wie das Hero-Mockup) und Copy. */
function FeatureImageRow({
  row,
  reverse,
}: {
  row: { img: string; title: string; body: string; liveNode?: React.ReactNode };
  reverse: boolean;
}) {
  return (
    <div className={`glev-feat-row${reverse ? " glev-feat-row--rev" : ""}`}>
      <div className="glev-feat-row__img" style={{ display: "flex", justifyContent: "center" }}>
        {row.liveNode ?? <PhoneShell src={row.img} alt={row.title} />}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h3
          style={{
            fontSize: "clamp(22px, 3vw, 28px)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            margin: 0,
            color: "var(--text)",
          }}
        >
          {row.title}
        </h3>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "var(--text-body)" }}>
          {row.body}
        </p>
      </div>
    </div>
  );
}

/** Wraps the live AppMockupPhone so it shrinks gracefully on viewports
 *  narrower than the phone's fixed 320-px frame (e.g. small Android phones
 *  where section padding reduces available width below 320 px).
 *  Measures the outer container and applies transform: scale() so the phone
 *  stays within bounds without clipping or overflowing. */
function LivePhoneScaler({ children }: { children: React.ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const applyScale = (w: number) => setScale(Math.min(1, w / 320));
    const ro = new ResizeObserver(([entry]) =>
      applyScale(entry.contentRect.width)
    );
    ro.observe(el);
    applyScale(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={outerRef}
      data-testid="live-phone-scaler"
      style={{ width: "min(320px, 100%)", height: scale * 660 }}
    >
      <div
        data-testid="live-phone-scaler-inner"
        style={{
          width: 320,
          height: 660,
          transformOrigin: "top left",
          transform: `scale(${scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Phone-Frame um einen Mockup-Render — analog zum Hero-Lockup, aber
 *  als reine Bild-Hülle (kein Inhalt). Bezel + Notch + abgerundete Ecken. */
function PhoneShell({ src, alt }: { src: string; alt: string }) {
  // 1:2-Phone-Aspect, max 320px breit auf Desktop, schrumpft fluid.
  return (
    <div
      style={{
        position: "relative",
        width: "min(320px, 100%)",
        aspectRatio: "320 / 660",
        background: "#0a0a0e",
        borderRadius: 36,
        padding: 12,
        boxShadow:
          "0 24px 56px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.06)",
      }}
    >
      {/* Notch */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: 12,
          left: "50%",
          transform: "translateX(-50%)",
          width: 96,
          height: 22,
          background: "#000",
          borderRadius: 999,
          zIndex: 2,
        }}
      />
      {/* Bildschirm mit dem Mockup-Render */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 26,
          overflow: "hidden",
          background: "#09090B",
          border: "1px solid rgba(255,255,255,0.04)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          loading="lazy"
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "top center",
          }}
        />
      </div>
    </div>
  );
}

/** Glev+ Karte (L-Tier, €29/Mo, für Eltern & Caregiver). CTA POSTet
 *  direkt an /api/checkout/plus und redirected zur Stripe-Hosted-Page
 *  (gleiches Pattern wie die /pro Hero-CTA). Kein Email-Feld — Stripe
 *  sammelt die Email selbst. */
function PlusCard() {
  const t = useTranslations("marketing");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout/plus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: "de" }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setError(data.error ?? "Checkout konnte nicht gestartet werden.");
    } catch {
      setError("Checkout konnte nicht gestartet werden.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        background: SURFACE,
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
        padding: 28,
        display: "flex",
        flexDirection: "column",
        gap: 20,
        position: "relative",
      }}
    >
      <div>
        <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "var(--text)" }}>
          {t("pricing_klinik_title")}
        </h3>
        <div style={{ marginTop: 14, display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text)" }}>{t("pricing_klinik_price")}</span>
          <span style={{ fontSize: 15, color: "var(--text-muted)" }}>{t("pricing_klinik_period")}</span>
        </div>
        <p style={{ margin: "6px 0 0 0", fontSize: 12.5, color: "var(--text-muted)", letterSpacing: "-0.005em" }}>
          {t("pricing_klinik_sublabel")}
        </p>
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {[
          t("pricing_klinik_b1"),
          t("pricing_klinik_b2"),
          t("pricing_klinik_b3"),
          t("pricing_klinik_b4"),
          t("pricing_klinik_b5"),
          t("pricing_klinik_b6"),
        ].map((b) => (
          <PricingBullet key={b} text={b} />
        ))}
      </ul>

      <form
        onSubmit={onSubmit}
        style={{
          marginTop: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "13px 22px",
            borderRadius: 12,
            background: ACCENT,
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: "-0.005em",
            border: "none",
            cursor: loading ? "wait" : "pointer",
            opacity: loading ? 0.7 : 1,
            fontFamily: "inherit",
            boxShadow: `0 6px 18px ${ACCENT}40`,
          }}
        >
          {loading ? "…" : t("pricing_klinik_cta")}
        </button>
        {error && (
          <div
            role="alert"
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              background: "rgba(255,80,80,0.1)",
              border: "1px solid rgba(255,80,80,0.35)",
              color: "#ff5050",
              fontSize: 12.5,
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            {error}
          </div>
        )}
      </form>
    </div>
  );
}
