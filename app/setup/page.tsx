"use client";

/**
 * Public CGM-Setup guide — `/setup`.
 *
 * Marketing-side documentation page (Turn B of the CGM-Connect
 * feature). Each vendor card explains, in 3–4 numbered steps, how
 * to get readings flowing into Glev. Anchor IDs (`#dexcom`,
 * `#libre`, …) make the sections shareable as direct links —
 * we link from FAQ → /setup#<vendor> on the landing page.
 *
 * This page is intentionally pre-signup-friendly: anyone can read
 * it without an account, and the Lockup links back to home. The
 * bottom CTA points at the same /signin entry point as the rest
 * of the marketing surfaces.
 *
 * Structure mirrors /pro and /beta:
 *  - Lockup header (200 wide, top-left)
 *  - Hero (h1 + sub)
 *  - TOC chips
 *  - 5 vendor cards (Dexcom, FreeStyle Libre, Medtronic,
 *    Apple Health, Nightscout)
 *  - CTA back to /signin
 *  - LandingFooter
 */

import Link from "next/link";
import { useTranslations } from "next-intl";
import LandingFooter from "@/components/landing/Footer";
import Lockup from "@/components/landing/Lockup";
import {
  ACCENT,
  ACCENT_HOVER,
  BG,
  BORDER,
  MINT,
  PINK,
  SURFACE,
  TEXT_DIM,
} from "@/components/landing/tokens";

// Constant accent palette shared with the landing page so vendor
// chips visually match what users see in the in-app onboarding
// CGM step (cgm.tsx). Keeping vendor → color mapping consistent
// across surfaces helps with brand recall.
const VENDOR_COLOR: Record<string, string> = {
  dexcom: MINT,
  libre: "#FF9500",
  medtronic: ACCENT,
  apple_health: PINK,
  nightscout: ACCENT,
};

// 5 vendor cards × 4 steps each. Step count is fixed so the i18n
// surface stays predictable — if a vendor genuinely needs 3 or 5
// steps later, prefer collapsing/splitting copy rather than
// changing the loop count, so the JSON shape stays uniform.
const VENDORS = ["dexcom", "libre", "medtronic", "apple_health", "nightscout"] as const;
const STEPS_PER_VENDOR = 4;

export default function SetupPage() {
  const t = useTranslations("setupPage");

  return (
    <main
      style={{
        background: BG,
        minHeight: "100vh",
        color: "var(--text)",
        fontFamily:
          "var(--font-inter), Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
      }}
    >
      {/* ── Header ──────────────────────────────────────────── */}
      <header
        style={{
          maxWidth: 1180,
          margin: "0 auto",
          padding: "20px 24px 8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <Link href="/" aria-label={t("back_home_aria")} style={{ display: "inline-flex" }}>
          <Lockup width={140} />
        </Link>
        <Link
          href="/"
          style={{
            color: TEXT_DIM,
            fontSize: 14,
            textDecoration: "none",
            padding: "8px 12px",
          }}
        >
          ← {t("back_home")}
        </Link>
      </header>

      {/* ── Hero ────────────────────────────────────────────── */}
      <section
        style={{
          maxWidth: 760,
          margin: "0 auto",
          padding: "32px 24px 24px",
        }}
      >
        <div
          style={{
            fontSize: 12,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: ACCENT,
            fontWeight: 700,
            marginBottom: 12,
          }}
        >
          {t("hero_eyebrow")}
        </div>
        <h1
          style={{
            fontSize: "clamp(30px, 5vw, 44px)",
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            fontWeight: 800,
            margin: "0 0 16px",
            color: "var(--text)",
            overflowWrap: "anywhere",
            hyphens: "auto",
            WebkitHyphens: "auto",
          }}
        >
          {t("hero_h1")}
        </h1>
        <p style={{ fontSize: 17, lineHeight: 1.55, color: TEXT_DIM, margin: 0 }}>
          {t("hero_sub")}
        </p>
      </section>

      {/* ── TOC chips ──────────────────────────────────────── */}
      <section
        aria-label={t("toc_aria")}
        style={{
          maxWidth: 760,
          margin: "0 auto",
          padding: "8px 24px 24px",
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {VENDORS.map((v) => (
            <a
              key={v}
              href={`#${v.replace("_", "-")}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                background: SURFACE,
                border: `1px solid ${BORDER}`,
                borderRadius: 99,
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text)",
                textDecoration: "none",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: VENDOR_COLOR[v],
                  display: "inline-block",
                }}
              />
              {t(`vendor_${v}_title`)}
            </a>
          ))}
        </div>
      </section>

      {/* ── Vendor cards ───────────────────────────────────── */}
      <section
        style={{
          maxWidth: 760,
          margin: "0 auto",
          padding: "16px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {VENDORS.map((v) => (
          <article
            key={v}
            id={v.replace("_", "-")}
            style={{
              background: SURFACE,
              border: `1px solid ${BORDER}`,
              borderLeft: `3px solid ${VENDOR_COLOR[v]}`,
              borderRadius: 16,
              padding: "24px 24px 22px",
              scrollMarginTop: 24,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 16,
                marginBottom: 6,
                flexWrap: "wrap",
              }}
            >
              <h2
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  margin: 0,
                  letterSpacing: "-0.01em",
                  color: "var(--text)",
                }}
              >
                {t(`vendor_${v}_title`)}
              </h2>
              <span style={{ fontSize: 12, color: TEXT_DIM, fontWeight: 600 }}>
                {t(`vendor_${v}_devices`)}
              </span>
            </div>
            <p
              style={{
                fontSize: 14.5,
                lineHeight: 1.55,
                color: TEXT_DIM,
                margin: "0 0 16px",
              }}
            >
              {t(`vendor_${v}_intro`)}
            </p>

            <ol
              style={{
                margin: 0,
                paddingLeft: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                counterReset: "step",
              }}
            >
              {Array.from({ length: STEPS_PER_VENDOR }, (_, i) => i + 1).map((n) => (
                <li
                  key={n}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                    fontSize: 14.5,
                    lineHeight: 1.55,
                    color: "var(--text)",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      flexShrink: 0,
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: `${VENDOR_COLOR[v]}22`,
                      color: VENDOR_COLOR[v],
                      fontWeight: 700,
                      fontSize: 12,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginTop: 1,
                    }}
                  >
                    {n}
                  </span>
                  <span>{t(`vendor_${v}_step_${n}`)}</span>
                </li>
              ))}
            </ol>

            <div
              style={{
                marginTop: 18,
                padding: "10px 14px",
                background: "var(--input-bg)",
                border: `1px solid ${BORDER}`,
                borderRadius: 10,
                fontSize: 12.5,
                color: TEXT_DIM,
                lineHeight: 1.5,
              }}
            >
              {t(`vendor_${v}_note`)}
            </div>
          </article>
        ))}
      </section>

      {/* ── Bottom CTA ────────────────────────────────────── */}
      <section
        style={{
          maxWidth: 760,
          margin: "32px auto 0",
          padding: "0 24px 64px",
          textAlign: "center",
        }}
      >
        <h2
          style={{
            fontSize: 24,
            fontWeight: 700,
            margin: "0 0 10px",
            letterSpacing: "-0.01em",
            color: "var(--text)",
          }}
        >
          {t("cta_title")}
        </h2>
        <p style={{ fontSize: 15, color: TEXT_DIM, margin: "0 0 20px", lineHeight: 1.55 }}>
          {t("cta_sub")}
        </p>
        <div
          style={{
            display: "inline-flex",
            gap: 12,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <Link
            href="/signin"
            style={{
              background: ACCENT,
              color: "#fff",
              padding: "12px 22px",
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 700,
              textDecoration: "none",
              transition: "background 0.15s",
              display: "inline-block",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = ACCENT_HOVER; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = ACCENT; }}
          >
            {t("cta_primary")}
          </Link>
          <Link
            href="/beta"
            style={{
              background: "transparent",
              color: "var(--text)",
              padding: "12px 22px",
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 700,
              textDecoration: "none",
              border: `1px solid ${BORDER}`,
              display: "inline-block",
            }}
          >
            {t("cta_secondary")}
          </Link>
        </div>
      </section>

      <LandingFooter />
    </main>
  );
}
