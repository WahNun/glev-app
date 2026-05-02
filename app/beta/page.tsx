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
  MINT,
  TEXT_DIM,
  TEXT_FAINT,
} from "@/components/landing/tokens";

const CAPACITY = 500;

type CountResponse = { count: number; capacity: number; remaining: number };

const WAITLIST_HREF = "/contact?source=beta-waitlist&subject=Glev%20Beta%20Warteliste";

/**
 * Primary CTA — POSTs to our /api/checkout/beta endpoint, receives a fresh
 * Stripe Checkout-Session URL und schickt den User dorthin. Damit kontrollieren
 * WIR welche Price-IDs verwendet werden (statt eines starr verlinkten Stripe
 * Payment-Links auf ein altes Produkt). Falls die Beta voll ist, fällt der
 * CTA auf den Mailto-Warteliste-Link zurück.
 *
 * Locale wird im Body mitgeschickt, damit der Backend-Endpoint die richtigen
 * Stripe-Price-IDs (EUR oder USD) auswählt.
 */
function BetaCTALink({ isFull }: { isFull: boolean }) {
  const t = useTranslations("betaPage");
  const locale = useLocale();
  const [hover, setHover] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isFull) {
    // Warteliste-Fallback bleibt ein simpler mailto-Link — kein API-Call nötig.
    return (
      <a
        href={WAITLIST_HREF}
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
        {t("cta_waitlist")}
      </a>
    );
  }

  async function handleClick() {
    if (loading) return;
    setError(null);
    setLoading(true);

    // Meta Pixel — Lead conversion event. Fires on jedem CTA-Klick der den
    // Visitor zu Stripe weiterreicht. Wir feuern es VOR dem fetch damit das
    // Event auch dann ankommt wenn die Navigation den Pixel-Beacon abschneidet.
    if (typeof window !== "undefined" && (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq) {
      (window as unknown as { fbq: (...args: unknown[]) => void }).fbq("track", "Lead");
    }

    try {
      const res = await fetch("/api/checkout/beta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });

      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };

      if (!res.ok || !data.url) {
        throw new Error(data.error || t("error_checkout_http", { status: res.status }));
      }

      // Same-Tab-Redirect zu Stripe Checkout (Stripe-Standard — kein neuer Tab,
      // damit der Browser-Back-Button den User sauber zurück zu /beta bringt
      // und damit die success_url-Redirect-Chain auf glev.app funktioniert).
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

function BetaContent() {
  const t = useTranslations("betaPage");
  const [count, setCount] = useState<CountResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/beta/count", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: CountResponse) => {
        if (!cancelled) setCount(data);
      })
      .catch(() => {
        /* keep counter hidden on failure */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const remaining = count?.remaining ?? CAPACITY;
  const isFull = count != null && remaining <= 0;

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
          grid-template-columns: repeat(3, 1fr);
          gap: 14px;
        }
        .glev-phone-stage { justify-self: end; }
        .glev-hero-form { width: 100%; max-width: 420px; }
        @media (max-width: 960px) {
          .glev-hero-2col { grid-template-columns: 1fr; gap: 40px; }
          .glev-phone-stage { justify-self: center; }
          .glev-feat-grid { grid-template-columns: 1fr; }
          .glev-hero-form { max-width: none; }
          .glev-hero-left { align-items: center !important; text-align: center !important; }
          .glev-hero-meta { justify-content: center !important; }
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
                // German compounds like "Insulinentscheidungen" don't
                // break by default; without these two the headline
                // overflows the 335px content area on iPhone 13 mini
                // and triggers horizontal scroll. `overflowWrap:
                // anywhere` is the modern, well-supported way to break
                // overlong tokens; `hyphens: auto` (with lang="de" set
                // by app/layout.tsx) lets the browser hyphenate at
                // syllable boundaries when a break is needed.
                overflowWrap: "anywhere",
                hyphens: "auto",
                WebkitHyphens: "auto",
              }}
            >
              {t("hero_title_line1")}<br />{t("hero_title_line2")}
            </h1>
            <p style={{ fontSize: 18, lineHeight: 1.5, color: TEXT_DIM, margin: 0, maxWidth: 520 }}>
              {t("hero_subtitle")}
            </p>

            <div
              className="glev-hero-form"
              style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}
            >
              <BetaCTALink isFull={isFull} />
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
                fontWeight: 600,
                flexWrap: "wrap",
              }}
            >
              <span aria-hidden>★</span>
              <span>{t("meta_early_access")}</span>
            </div>

            <div
              className="glev-hero-meta"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                color: TEXT_DIM,
                marginTop: 2,
                flexWrap: "wrap",
              }}
            >
              <span aria-hidden>↺</span>
              <span>{t("meta_refund")}</span>
            </div>

            <div
              className="glev-hero-meta"
              style={{
                fontSize: 13,
                color: TEXT_FAINT,
                marginTop: 2,
              }}
            >
              {t("meta_privacy")}
            </div>

            {!isFull && (
              <div
                style={{
                  fontSize: 13,
                  color: TEXT_FAINT,
                  marginTop: 4,
                }}
              >
                {t("meta_seats", { count: remaining })}
              </div>
            )}
          </div>

          <div className="glev-phone-stage">
            {/* Fully interactive hero — see homepage note. */}
            <AppMockupPhone />
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
        <FeatureTrio />
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
            { left: t("pricing_l1_left"), right: t("pricing_l1_right") },
            { left: t("pricing_l2_left"), right: t("pricing_l2_right") },
            { left: t("pricing_l3_left"), right: t("pricing_l3_right") },
          ]}
          footer={t("pricing_footer")}
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
 * "useSearchParams() should be wrapped in a suspense boundary".
 */
export default function BetaPage() {
  return (
    <Suspense fallback={null}>
      <BetaContent />
    </Suspense>
  );
}
