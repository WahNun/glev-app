"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import AppMockupPhone from "@/components/AppMockupPhone";
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
  TEXT_FAINT,
} from "@/components/landing/tokens";

/**
 * /preview-pro — copy-only refresh of /pro.
 *
 * IMPORTANT: this is a parallel preview route. The live /pro page and
 * its Stripe wiring stay untouched. The CTA below POSTs to the same
 * `/api/checkout/pro` endpoint with the user's locale (so the same
 * EUR/USD price-IDs are used) — Stripe logic, IDs, redirect contract
 * are intentionally unchanged.
 */
function PreviewProCTA({ block = true }: { block?: boolean }) {
  const t = useTranslations("previewPro");
  const locale = useLocale();
  const [hover, setHover] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (loading) return;
    setError(null);
    setLoading(true);

    if (typeof window !== "undefined" && (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq) {
      (window as unknown as { fbq: (...args: unknown[]) => void }).fbq("track", "InitiateCheckout");
    }

    try {
      const res = await fetch("/api/checkout/pro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      window.location.href = data.url;
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: loading ? "rgba(79,110,247,0.6)" : hover ? ACCENT_HOVER : ACCENT,
          color: "#fff",
          textDecoration: "none",
          border: "none",
          borderRadius: 12,
          padding: "16px 32px",
          fontSize: 18,
          fontWeight: 600,
          fontFamily: "inherit",
          minHeight: 56,
          cursor: loading ? "default" : "pointer",
          boxShadow: hover && !loading ? "0 0 0 4px rgba(79,110,247,0.25)" : "0 0 0 0 rgba(79,110,247,0)",
          transition: "background 120ms ease, box-shadow 120ms ease",
          outlineColor: "rgba(79,110,247,0.4)",
          boxSizing: "border-box",
          width: block ? "100%" : "auto",
        }}
      >
        {loading ? t("cta_loading") : t("cta_default")}
      </button>
      {error && (
        <div
          role="alert"
          style={{
            marginTop: 10,
            padding: "10px 12px",
            background: "rgba(255,45,120,0.08)",
            border: "1px solid rgba(255,45,120,0.3)",
            borderRadius: 8,
            color: "#FF7AA8",
            fontSize: 13,
            lineHeight: 1.4,
          }}
        >
          {error}
        </div>
      )}
    </>
  );
}

function PreviewProContent() {
  const t = useTranslations("previewPro");

  useEffect(() => {
    if (typeof window !== "undefined" && (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq) {
      (window as unknown as { fbq: (...args: unknown[]) => void }).fbq("trackCustom", "ViewProPagePreview");
    }
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: BG,
        color: "#fff",
        padding: "48px 0 64px",
        display: "flex",
        flexDirection: "column",
        overflowX: "hidden",
        width: "100%",
      }}
    >
      <style>{`
        .glev-hero-2col {
          display: grid;
          grid-template-columns: 1.05fr 0.95fr;
          gap: 56px;
          align-items: center;
        }
        .glev-phone-stage { justify-self: end; }
        .glev-hero-form { width: 100%; max-width: 420px; }
        @media (max-width: 960px) {
          .glev-hero-2col { grid-template-columns: 1fr; gap: 40px; }
          .glev-phone-stage { justify-self: center; }
          .glev-hero-form { max-width: none; }
          .glev-hero-left { align-items: center !important; text-align: center !important; }
          .glev-hero-meta { justify-content: center !important; }
        }
        .glev-tier-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          align-items: stretch;
        }
        @media (max-width: 880px) {
          .glev-tier-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      {/* 1. Hero */}
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
                fontSize: "clamp(32px, 6.4vw, 64px)",
                lineHeight: 1.04,
                letterSpacing: "-0.03em",
                fontWeight: 700,
                color: "#fff",
                margin: 0,
                overflowWrap: "normal",
                hyphens: "manual",
                WebkitHyphens: "manual",
                whiteSpace: "pre-line",
              }}
            >
              {t("hero_title")}
            </h1>
            <p style={{ fontSize: 18, lineHeight: 1.5, color: TEXT_DIM, margin: 0, maxWidth: 520 }}>
              {t("hero_subtitle")}
            </p>

            <div
              className="glev-hero-form"
              style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}
            >
              <PreviewProCTA />
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
              <span>{t("hero_microcopy")}</span>
            </div>
          </div>

          <div className="glev-phone-stage">
            <AppMockupPhone />
          </div>
        </div>
      </section>

      {/* 2. Positionierung */}
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
            padding: "24px 24px",
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontSize: 18,
              lineHeight: 1.55,
              color: "#fff",
              margin: 0,
              fontWeight: 500,
            }}
          >
            {t("positioning")}
          </p>
        </div>
      </section>

      {/* 3. Flow — 3 Schritte (Nutzergewinn) */}
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
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 14,
          }}
        >
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              style={{
                display: "flex",
                gap: 16,
                background: SURFACE,
                border: `1px solid ${BORDER}`,
                borderRadius: 14,
                padding: "18px 18px",
                alignItems: "flex-start",
              }}
            >
              <div
                aria-hidden
                style={{
                  flexShrink: 0,
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: `${ACCENT}22`,
                  color: ACCENT,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: 16,
                }}
              >
                {n}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#fff", marginBottom: 4 }}>
                  {t(`flow_${n}_title` as never)}
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.55, color: TEXT_DIM }}>
                  {t(`flow_${n}_text` as never)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Pricing block */}
      <section
        style={{
          width: "100%",
          maxWidth: 680,
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
            padding: "28px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ fontSize: 28, fontWeight: 700, color: "#fff", lineHeight: 1.15 }}>
            {t("pricing_headline")}
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {[1, 2, 3, 4].map((n) => (
              <li
                key={n}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  fontSize: 15,
                  lineHeight: 1.5,
                  color: TEXT_DIM,
                }}
              >
                <span aria-hidden style={{ color: MINT, fontWeight: 700, marginTop: 1 }}>✓</span>
                <span>{t(`pricing_bullet_${n}` as never)}</span>
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 8 }}>
            <PreviewProCTA />
          </div>
          <div style={{ fontSize: 13, color: MINT, textAlign: "center", marginTop: 4 }}>
            {t("pricing_microcopy")}
          </div>
        </div>
      </section>

      {/* 5. Founder */}
      <section
        style={{
          width: "100%",
          maxWidth: 680,
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
            padding: "24px 24px",
          }}
        >
          <p
            style={{
              fontSize: 16,
              lineHeight: 1.6,
              color: "#fff",
              margin: "0 0 12px",
              fontStyle: "italic",
            }}
          >
            {t("founder_quote")}
          </p>
          <div style={{ fontSize: 13, color: TEXT_FAINT, fontWeight: 500 }}>
            {t("founder_attribution")}
          </div>
        </div>
      </section>

      {/* 6. Pricing-Tabelle — Beta / Pro / Klinik */}
      <section
        style={{
          width: "100%",
          maxWidth: 1080,
          margin: "0 auto 40px",
          padding: "0 20px",
          boxSizing: "border-box",
        }}
      >
        <div className="glev-tier-grid">
          {/* Beta */}
          <TierCard
            title={t("tier_beta_title")}
            price={t("tier_beta_price")}
            subtext={t("tier_beta_subtext")}
            features={[
              t("tier_beta_f1"),
              t("tier_beta_f2"),
              t("tier_beta_f3"),
              t("tier_beta_f4"),
              t("tier_beta_f5"),
              t("tier_beta_f6"),
            ]}
            ctaLabel={t("tier_beta_cta")}
            ctaHref="/beta"
            accent={MINT}
          />

          {/* Pro — featured */}
          <TierCard
            title={t("tier_pro_title")}
            price={t("tier_pro_price")}
            subtext={t("tier_pro_subtext")}
            features={[
              t("tier_pro_f1"),
              t("tier_pro_f2"),
              t("tier_pro_f3"),
              t("tier_pro_f4"),
              t("tier_pro_f5"),
              t("tier_pro_f6"),
              t("tier_pro_f7"),
            ]}
            ctaLabel={t("tier_pro_cta")}
            ctaStripe
            accent={ACCENT}
            featured
            badge={t("tier_pro_badge")}
          />

          {/* Klinik */}
          <TierCard
            title={t("tier_clinic_title")}
            price={t("tier_clinic_price")}
            features={[
              t("tier_clinic_f1"),
              t("tier_clinic_f2"),
              t("tier_clinic_f3"),
              t("tier_clinic_f4"),
            ]}
            ctaLabel={t("tier_clinic_cta")}
            ctaHref="mailto:lucas@wahnon-connect.com?subject=Klinik%20Warteliste"
            accent={PINK}
            badge={t("tier_clinic_badge")}
            badgeMuted
          />
        </div>
      </section>

      {/* 7. Compliance footer (page-specific, above global footer) */}
      <section
        style={{
          width: "100%",
          maxWidth: 760,
          margin: "0 auto 32px",
          padding: "0 20px",
          boxSizing: "border-box",
        }}
      >
        <p
          style={{
            fontSize: 11,
            lineHeight: 1.55,
            color: TEXT_FAINT,
            textAlign: "center",
            margin: 0,
          }}
        >
          {t("compliance_footer")}
        </p>
      </section>

      {/* 8. Global footer (unchanged) */}
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

/** Single tier card. Three variants:
 *   - default: inline link CTA
 *   - ctaStripe=true: renders the PreviewProCTA Stripe button
 *   - featured=true: highlighted border + subtle glow
 *   - badge: small pill in the top-right (badgeMuted = neutral colour)
 */
function TierCard(props: {
  title: string;
  price: string;
  subtext?: string;
  features: string[];
  ctaLabel: string;
  ctaHref?: string;
  ctaStripe?: boolean;
  accent: string;
  featured?: boolean;
  badge?: string;
  badgeMuted?: boolean;
}) {
  const { title, price, subtext, features, ctaLabel, ctaHref, ctaStripe, accent, featured, badge, badgeMuted } = props;
  const [hover, setHover] = useState(false);

  const externalMail = ctaHref?.startsWith("mailto:");

  return (
    <div
      style={{
        position: "relative",
        background: SURFACE,
        border: `1px solid ${featured ? `${ACCENT}80` : BORDER}`,
        borderRadius: 16,
        padding: "24px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        boxShadow: featured ? `0 0 0 4px rgba(79,110,247,0.12)` : "none",
      }}
    >
      {badge && (
        <div
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            padding: "4px 8px",
            borderRadius: 99,
            background: badgeMuted ? "rgba(255,255,255,0.08)" : `${accent}22`,
            color: badgeMuted ? TEXT_FAINT : accent,
            border: `1px solid ${badgeMuted ? BORDER : `${accent}55`}`,
          }}
        >
          {badge}
        </div>
      )}

      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: accent, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>
          {title}
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: "#fff", lineHeight: 1.1 }}>
          {price}
        </div>
        {subtext && (
          <div style={{ fontSize: 12, color: TEXT_FAINT, marginTop: 6, lineHeight: 1.5 }}>
            {subtext}
          </div>
        )}
      </div>

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        {features.map((f, i) => (
          <li
            key={i}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              fontSize: 13.5,
              lineHeight: 1.5,
              color: TEXT_DIM,
            }}
          >
            <span aria-hidden style={{ color: accent, fontWeight: 700, marginTop: 1, flexShrink: 0 }}>·</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {ctaStripe ? (
        <PreviewProCTA />
      ) : ctaHref ? (
        externalMail ? (
          <a
            href={ctaHref}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: hover ? `${accent}22` : "transparent",
              color: accent,
              textDecoration: "none",
              border: `1px solid ${accent}`,
              borderRadius: 12,
              padding: "14px 20px",
              fontSize: 15,
              fontWeight: 600,
              minHeight: 50,
              transition: "background 120ms ease",
              boxSizing: "border-box",
              width: "100%",
            }}
          >
            {ctaLabel}
          </a>
        ) : (
          <Link
            href={ctaHref}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: hover ? `${accent}22` : "transparent",
              color: accent,
              textDecoration: "none",
              border: `1px solid ${accent}`,
              borderRadius: 12,
              padding: "14px 20px",
              fontSize: 15,
              fontWeight: 600,
              minHeight: 50,
              transition: "background 120ms ease",
              boxSizing: "border-box",
              width: "100%",
            }}
          >
            {ctaLabel}
          </Link>
        )
      ) : null}
    </div>
  );
}

export default function PreviewProPage() {
  return (
    <Suspense fallback={null}>
      <PreviewProContent />
    </Suspense>
  );
}
