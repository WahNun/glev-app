"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
// react hooks no longer needed — homepage is now stateless
import GlevLockup from "@/components/GlevLockup";
import AppMockupPhone from "@/components/AppMockupPhone";
import FeatureTrio from "@/components/landing/FeatureTrio";
import Steps from "@/components/landing/Steps";
import FeatureDeepDive from "@/components/landing/FeatureDeepDive";

// Brand accents stay constant across themes (per the brand spec) — surface,
// border and text colors point at the theme CSS variables in
// `app/globals.css` so the landing page automatically follows Light Mode
// when `<html data-theme="light">` is set (Task #42).
const ACCENT  = "#4F6EF7";
const HOVER   = "#6B8BFF";
const GREEN   = "#22D3A0";
const ORANGE  = "#FF9500";
const PINK    = "#FF2D78";
const BG      = "var(--bg)";
const SURFACE = "var(--surface)";
const SURF2   = "var(--surface-alt)";
const BORDER  = "var(--border)";

export default function Home() {
  const t = useTranslations("marketing");
  return (
    <main
      style={{
        background: BG,
        color: "var(--text)",
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
        /* Hover tint pulled from the theme tokens so ghost buttons land on
           a faint surface inset in both Dark and Light Mode (Task #42). */
        .glev-cta-ghost:hover { background: var(--surface-soft); border-color: var(--border-strong); }
        .glev-link { transition: color 0.15s; }
        .glev-link:hover { color: ${HOVER} !important; }
        .glev-secondary-link { transition: color 0.15s; }
        .glev-secondary-link:hover { color: var(--text-strong) !important; text-decoration: underline; text-underline-offset: 3px; }
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
          // color-mix tints the page bg so the same rule reads as a dark
          // translucent slab in Dark Mode and a light translucent slab
          // in Light Mode (Task #42).
          background: "color-mix(in srgb, var(--bg) 72%, transparent)",
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
          <Link href="/" style={{ textDecoration: "none", color: "inherit" }} aria-label={t("nav_aria_home")}>
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
              {t("hero_h1")}<span style={{ color: GREEN }}>.</span>
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
              {t("hero_subtitle")}
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
                    // White stays constant in both themes — readable on
                    // the brand-blue button regardless of mode.
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
                  {t("hero_cta_primary")}
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
                  {t("hero_cta_secondary")}
                </Link>
              </div>

              <Link
                href="/beta"
                className="glev-secondary-link"
                style={{
                  fontSize: 13,
                  color: "var(--text-muted)",
                  textDecoration: "none",
                  fontWeight: 500,
                  letterSpacing: "-0.005em",
                }}
              >
                {t("hero_cta_tertiary")}
              </Link>
            </div>

            {/* CGM-Status-Strip — green dot = jetzt nutzbar (Libre 2 + Libre 3
                via LibreLinkUp), grey dot = in Arbeit / coming soon. Kept in
                sync with the FAQ entry "Welche CGMs werden unterstützt?" so
                a visitor's first hero glance and the deep-dive answer agree.
                flex-wrap so the 5 chips fold cleanly on narrow phone widths
                instead of horizontally clipping; rowGap matches gap so a
                wrapped line stays visually balanced. */}
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
              <span style={{ color: GREEN }}>● Libre 2</span>
              <span>·</span>
              <span style={{ color: GREEN }}>● Libre 3</span>
              <span>·</span>
              <span style={{ color: "var(--text-faint)" }}>○ Dexcom</span>
              <span>·</span>
              <span style={{ color: GREEN }}>● Nightscout</span>
              <span>·</span>
              <span style={{ color: "var(--text-faint)" }}>○ Medtronic</span>
            </div>
          </div>

          {/* RIGHT: iPhone with live, clickable app mockup */}
          <div className="glev-phone-stage">
            {/* Hero render is fully interactive — bottom nav AND the
                top-right cog both work, so visitors can poke through
                every screen including the Einstellungen tab (which
                exposes its own restricted set of demo-safe toggles).
                Was previously locked down with hideTopCog out of an
                abundance of caution; user explicitly asked for the
                full clickability back 2026-04-29. */}
            <AppMockupPhone />
          </div>
        </div>
      </section>

      {/* PAIN BLOCK — Problem-Agitation step rendered immediately after
          the Hero section so the visitor reads Problem → Agitation →
          Solution in order (Pain → FeatureTrio → "So funktioniert
          Glev"). Mirrors the same container max-width and surface
          tokens as its neighbours so it slots into the dark theme
          without drifting. The bullets use a small green accent dot
          (matching the hero badge / headline period) instead of bare
          hyphens, and the list wraps cleanly on narrow phones — no
          horizontal scrolling. */}
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
            {t("pain_title")}
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
            {[t("pain_b1"), t("pain_b2"), t("pain_b3")].map((bullet, i) => (
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

      {/* FEATURE TRIO — Solution preview that follows the Pain block,
          completing the Problem → Agitation → Solution sequence before
          the deeper "So funktioniert Glev" walkthrough. */}
      <section
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1180,
          margin: "0 auto",
          padding: "16px 24px 48px",
        }}
      >
        <FeatureTrio />
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
            color: "var(--text)",
          }}
        >
          {t("how_title")}
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
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "var(--text)" }}>
                {t("pricing_beta_title")}
              </h3>
              <div style={{ marginTop: 14, display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text)" }}>{t("pricing_beta_price")}</span>
                <span style={{ fontSize: 15, color: "var(--text-muted)" }}>{t("pricing_beta_period")}</span>
              </div>
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
            </div>

            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                t("pricing_pro_b1"),
                t("pricing_pro_b2"),
                t("pricing_pro_b3"),
                t("pricing_pro_b4"),
                t("pricing_pro_b5"),
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
              {t("pricing_pro_cta")}
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
            color: "var(--text)",
          }}
        >
          {t("faq_title")}
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {([
            { q: t("faq_q1"), a: t("faq_a1") },
            { q: t("faq_q2"), a: t("faq_a2") },
            { q: t("faq_q3"), a: t("faq_a3") },
            { q: t("faq_q4"), a: t("faq_a4") },
          ] as { q: string; a: string }[]).map((item) => (
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
            {/* Brand-Book Link, gut versteckt: gleiche Farbe wie Copyright,
                kein Underline, nur durch dezente Trenn-Mittelpunkt sichtbar.
                Bleibt für Direktaufruf via /brand erreichbar; SectionNav etc.
                im /brand selbst funktionieren wie bisher. */}
            {" · "}
            <Link
              href="/brand"
              style={{ color: "inherit", textDecoration: "none" }}
              aria-label={t("footer_brand_aria")}
            >
              {t("footer_brand")}
            </Link>
          </span>
        </div>
        <div style={{ maxWidth: 560, lineHeight: 1.5 }}>
          {t("footer_disclaimer")}
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


