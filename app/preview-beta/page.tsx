"use client";

import { Suspense, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { supabase } from "@/lib/supabase";
import AppMockupPhone from "@/components/AppMockupPhone";
import LandingFooter from "@/components/landing/Footer";
import Lockup from "@/components/landing/Lockup";
import CGMCompatibility from "@/components/landing/CGMCompatibility";
import {
  ACCENT,
  ACCENT_HOVER,
  BG,
  BORDER,
  MINT,
  SURFACE,
  TEXT_DIM,
  TEXT_FAINT,
} from "@/components/landing/tokens";

/**
 * /preview-beta — copy & layout preview of /beta.
 * Stripe wiring untouched: posts to /api/checkout/beta with locale.
 */
function PreviewBetaCTA({ block = true }: { block?: boolean }) {
  const t = useTranslations("previewBeta");
  const locale = useLocale();
  const [hover, setHover] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (loading) return;
    setError(null);
    setLoading(true);

    let email: string | undefined;
    try {
      if (supabase) {
        const { data } = await supabase.auth.getUser();
        if (data.user?.email) email = data.user.email;
      }
    } catch { /* best-effort */ }

    try {
      const res = await fetch("/api/checkout/beta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale, ...(email ? { email } : {}) }),
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

const SECTION_WRAP_NARROW: React.CSSProperties = {
  width: "100%",
  maxWidth: 760,
  margin: "0 auto 56px",
  padding: "0 20px",
  boxSizing: "border-box",
};

function PreviewBetaContent() {
  const t = useTranslations("previewBeta");

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
      `}</style>

      {/* 1. HERO */}
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
              <PreviewBetaCTA />
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

      {/* 1b. CGM COMPATIBILITY — direkt nach Hero, hilft Early-Filter */}
      <section style={{ ...SECTION_WRAP_NARROW, padding: "8px 20px 0" }}>
        <CGMCompatibility variant="compact" />
      </section>

      {/* 2. POSITIONING */}
      <section style={SECTION_WRAP_NARROW}>
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

      {/* 3. FLOW — 3 Schritte */}
      <section style={SECTION_WRAP_NARROW}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
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

      {/* 4. PRICING block */}
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
            <PreviewBetaCTA />
          </div>
          <div style={{ fontSize: 13, color: MINT, textAlign: "center", marginTop: 4 }}>
            {t("pricing_microcopy")}
          </div>
        </div>
      </section>

      {/* 5. FAQ — alle 10 */}
      <section style={SECTION_WRAP_NARROW}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <div
              key={n}
              style={{
                background: SURFACE,
                border: `1px solid ${BORDER}`,
                borderRadius: 14,
                padding: "18px 20px",
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 600, color: "#fff", marginBottom: 6 }}>
                {t(`faq_q${n}` as never)}
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.55, color: TEXT_DIM }}>
                {t(`faq_a${n}` as never)}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 6. MINI-FOUNDER (subtil) */}
      <section style={SECTION_WRAP_NARROW}>
        <div
          style={{
            padding: "16px 4px",
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontSize: 13,
              lineHeight: 1.55,
              color: TEXT_DIM,
              margin: "0 0 4px",
            }}
          >
            {t("mini_founder")}
          </p>
          <div style={{ fontSize: 12, color: TEXT_FAINT }}>
            {t("mini_founder_attr")}
          </div>
        </div>
      </section>

      {/* Compliance footer */}
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

      {/* Global footer */}
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

export default function PreviewBetaPage() {
  return (
    <Suspense fallback={null}>
      <PreviewBetaContent />
    </Suspense>
  );
}
