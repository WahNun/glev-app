"use client";

import { Suspense, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
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
  MINT,
  SURFACE,
  TEXT_DIM,
} from "@/components/landing/tokens";

/**
 * Pro-CTA — POSTet auf /api/checkout/pro, bekommt eine fresh Stripe
 * Subscription-Checkout-Session zurück (mit Trial bis 1. Juli 2026)
 * und schickt den User dorthin. Damit kontrollieren WIR welche Price-IDs
 * verwendet werden — kein hardcoded Payment Link mehr.
 *
 * Locale wird im Body mitgeschickt, damit der Backend-Endpoint die richtigen
 * Stripe-Price-IDs (EUR oder USD) auswählt.
 *
 * Die "reiche" Variante /api/pro/checkout (mit Email-Validierung und
 * DB-Tracking) bleibt im Repo für späteres Funnel-Tracking.
 */
function ProCTALink() {
  const t = useTranslations("proPage");
  const locale = useLocale();
  const [hover, setHover] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (loading) return;
    setError(null);
    setLoading(true);

    // Meta Pixel — InitiateCheckout fires VOR dem fetch damit der Beacon
    // auch dann ankommt wenn die Navigation den Pixel-Request abschneidet.
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
        throw new Error(data.error || t("error_checkout_http", { status: res.status }));
      }

      // Same-Tab-Redirect — Stripe-Checkout-Standard.
      window.location.href = data.url;
    } catch (err) {
      setLoading(false);
      const message = err instanceof Error ? err.message : t("error_unknown");
      setError(message);
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
          width: "100%",
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

/**
 * /pro — direct monthly-subscription landing page.
 * A/B partner to /beta. No reservation deposit, no seat counter, billing
 * begins on the public launch date (1 July 2026) via a Stripe trial.
 */
function ProContent() {
  const t = useTranslations("proPage");
  const tMarketing = useTranslations("marketing");
  const launchDateLabel = tMarketing("landing_launch_date_label");

  // Meta Pixel — fires a custom `ViewProPage` event so we can build a
  // pro-page-visitors retargeting audience separate from the generic
  // PageView signal that fires on every route via the root layout.
  useEffect(() => {
    if (typeof window !== "undefined" && (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq) {
      (window as unknown as { fbq: (...args: unknown[]) => void }).fbq("trackCustom", "ViewProPage");
    }
  }, []);

  const faqItems = [1, 2, 3, 4, 5].map((i) => ({
    q: t(`faq_q${i}`),
    a: t(`faq_a${i}`),
  }));

  return (
    <main
      style={{
        minHeight: "100vh",
        background: BG,
        color: "#fff",
        padding: "48px 0 64px",
        display: "flex",
        flexDirection: "column",
        // Mobile horizontal-scroll guard: the PhoneShell mockup has
        // absolute side-buttons at left:-2px / right:-2px and a soft
        // 80px box-shadow that can poke past the iPhone 13 mini's
        // 375px viewport. Clip the page to its own width so the body
        // never scrolls horizontally — vertical scroll is unaffected
        // because we don't touch overflow-y.
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
                fontSize: "clamp(32px, 6.4vw, 64px)",
                lineHeight: 1.04,
                letterSpacing: "-0.03em",
                fontWeight: 700,
                color: "#fff",
                margin: 0,
                // Same mobile-overflow guard as /beta: lower the clamp
                // floor and let German compounds break instead of
                // pushing the page wider than the viewport.
                overflowWrap: "anywhere",
                hyphens: "auto",
                WebkitHyphens: "auto",
              }}
            >
              {t("hero_title_line1")}<br />{t("hero_title_line2")}<br />{t("hero_title_line3")}
            </h1>
            <p style={{ fontSize: 18, lineHeight: 1.5, color: TEXT_DIM, margin: 0, maxWidth: 520 }}>
              {t("hero_subtitle")}
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
              <span>{t("meta_card", { date: launchDateLabel })}</span>
            </div>
          </div>

          <div className="glev-phone-stage">
            {/* Fully interactive hero — see homepage note. */}
            <AppMockupPhone />
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
            {t.rich("scenario_intro", {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
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
                {t("scenario_without_label")}
              </strong>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "rgba(255,255,255,0.85)" }}>
                {t("scenario_without_text")}
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
                {t("scenario_with_label")}
              </strong>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "rgba(255,255,255,0.85)" }}>
                {t("scenario_with_text")}
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
              title: t("trio_trend_title"),
              text: t("trio_trend_text"),
            },
            {
              color: MINT,
              title: t("trio_meal_title"),
              text: t("trio_meal_text"),
            },
            {
              color: "#FF9500",
              title: t("trio_timing_title"),
              text: t("trio_timing_text"),
            },
          ]}
          extra={{
            color: "#FF2D78",
            title: t("trio_extra_title"),
            text: t("trio_extra_text"),
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
          heading={t("pricing_heading")}
          lines={[
            { left: t("pricing_l1_left", { date: launchDateLabel }), right: t("pricing_l1_right") },
            { left: t("pricing_l2_left"), right: t("pricing_l2_right") },
            { left: t("pricing_l3_left"), right: t("pricing_l3_right") },
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
        <FAQ items={faqItems} />
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
