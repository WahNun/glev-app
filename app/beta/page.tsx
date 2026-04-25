"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import AppMockupPhone from "@/components/AppMockupPhone";
import CTAButton from "@/components/landing/CTAButton";
import FAQ from "@/components/landing/FAQ";
import FeatureTrio from "@/components/landing/FeatureTrio";
import LandingFooter from "@/components/landing/Footer";
import Lockup from "@/components/landing/Lockup";
import PricingCard from "@/components/landing/PricingCard";
import Steps from "@/components/landing/Steps";
import {
  ACCENT,
  BG,
  BORDER,
  MINT,
  PINK,
  SURFACE,
  TEXT_DIM,
  TEXT_FAINT,
} from "@/components/landing/tokens";

const CAPACITY = 500;

type CountResponse = { count: number; capacity: number; remaining: number };

export default function BetaPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<CountResponse | null>(null);
  const ctaRef = useRef<HTMLInputElement | null>(null);

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
  const isLow = !isFull && count != null && remaining < 50;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Bitte gib eine gültige Email-Adresse ein.");
      ctaRef.current?.focus();
      return;
    }

    if (isFull) {
      window.location.href = "mailto:hello@glev.app?subject=Glev%20Beta%20Warteliste";
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/beta/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };

      if (res.status === 409) {
        // Capacity hit between count poll and submit — fall back to mailto.
        window.location.href = "mailto:hello@glev.app?subject=Glev%20Beta%20Warteliste";
        return;
      }

      if (!res.ok || !data.url) {
        setError(data.error ?? "Leider hat der Checkout nicht funktioniert — probier es gleich nochmal.");
        setSubmitting(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Leider hat der Checkout nicht funktioniert — probier es gleich nochmal.");
      setSubmitting(false);
    }
  }

  const ctaLabel = isFull
    ? "Auf die Warteliste"
    : submitting
      ? "Weiterleitung zu Stripe…"
      : "Platz sichern — €19";

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
                fontSize: "clamp(40px, 6.4vw, 64px)",
                lineHeight: 1.04,
                letterSpacing: "-0.03em",
                fontWeight: 700,
                color: "#fff",
                margin: 0,
              }}
            >
              Typ 1. Neu gedacht.
            </h1>
            <p style={{ fontSize: 18, lineHeight: 1.5, color: TEXT_DIM, margin: 0, maxWidth: 520 }}>
              Der sprachgesteuerte Essens-Tracker für Typ-1-Diabetiker. Beta startet im Juli 2026.
            </p>

            <form
              onSubmit={handleSubmit}
              className="glev-hero-form"
              style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}
            >
              <input
                ref={ctaRef}
                type="email"
                required
                autoComplete="email"
                placeholder="deine@email.de"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label="Email-Adresse"
                style={{
                  width: "100%",
                  background: SURFACE,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 12,
                  padding: "14px 16px",
                  color: "#fff",
                  fontSize: 16,
                  fontFamily: "inherit",
                  outline: "none",
                  boxSizing: "border-box",
                  minHeight: 56,
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = ACCENT)}
                onBlur={(e) => (e.currentTarget.style.borderColor = BORDER)}
              />
              <CTAButton submitting={submitting} label={ctaLabel} />
              {error && (
                <div role="alert" style={{ fontSize: 13, color: PINK, textAlign: "left" }}>
                  {error}
                </div>
              )}
            </form>

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
              <span>Rückerstattung jederzeit vor Launch · wird aufs erste Abo angerechnet</span>
            </div>

            {count && !isFull && (
              <div
                style={{
                  fontSize: 13,
                  color: isLow ? PINK : TEXT_FAINT,
                  marginTop: 4,
                  fontFeatureSettings: '"tnum"',
                }}
              >
                Noch{" "}
                <span
                  style={{
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontWeight: 600,
                    color: isLow ? PINK : "rgba(255,255,255,0.7)",
                  }}
                >
                  {remaining}
                </span>{" "}
                von 500 Beta-Plätzen verfügbar
              </div>
            )}
          </div>

          <div className="glev-phone-stage">
            <AppMockupPhone hideTopCog />
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

      {/* 4. Founder — subtle, below the feature cards */}
      <section
        style={{
          width: "100%",
          maxWidth: 680,
          margin: "0 auto 56px",
          padding: "0 20px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: "50%",
            overflow: "hidden",
            position: "relative",
            border: `1px solid ${BORDER}`,
            background: SURFACE,
          }}
        >
          <Image
            src="/founder.png"
            alt="Lucas Wahnon"
            fill
            sizes="80px"
            style={{
              objectFit: "cover",
              objectPosition: "50% 22%",
              transform: "scale(1.5)",
              transformOrigin: "50% 22%",
            }}
          />
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#fff", letterSpacing: "-0.01em" }}>
          Lucas Wahnon
        </div>
        <div style={{ fontSize: 13, color: TEXT_DIM }}>
          Gründer · lebt selbst mit Typ 1
        </div>
      </section>

      {/* 5. Pricing */}
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
            { left: "€19 heute", right: "deine Beta-Reservierung" },
            { left: "€4,50 / Monat im ersten Jahr", right: "nach Launch, als Beta-Tester" },
            { left: "€9 / Monat danach", right: "regulärer Preis" },
          ]}
          footer="Reservierung wird auf dein erstes Monatsabo angerechnet."
        />
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
        <FAQ items={BETA_FAQ} />
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

const BETA_FAQ = [
  {
    q: "Welche CGMs werden unterstützt?",
    a: "Aktuell FreeStyle Libre 2 via LibreLinkUp. Dexcom G6/G7 sind in Arbeit. Nightscout-Support folgt.",
  },
  {
    q: "Bekomme ich mein Geld zurück wenn die App nicht für mich ist?",
    a: "Ja, jederzeit vor öffentlichem Launch. Nach Launch gilt die reguläre Kündigungsfrist des Monatsabos.",
  },
  {
    q: "Ist Glev ein Medizinprodukt?",
    a: "Nein. Glev ist ein Dokumentations- und Organisations-Tool. Therapieentscheidungen triffst du weiter mit deinem Arzt.",
  },
  {
    q: "Wann startet die Beta?",
    a: "Juli 2026. Beta-Tester bekommen den Zugangslink per Email zwei Wochen vor dem öffentlichen Launch.",
  },
  {
    q: "Wo werden meine Daten gespeichert?",
    a: "In der EU (Supabase Frankfurt). Deutsche DSGVO. Keine Datenweitergabe, keine Werbung.",
  },
];
