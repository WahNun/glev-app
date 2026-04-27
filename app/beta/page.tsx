"use client";

import Image from "next/image";
import { Suspense, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useSearchParams } from "next/navigation";
import AppMockupPhone from "@/components/AppMockupPhone";
import CTAButton from "@/components/landing/CTAButton";
import { submitBetaCheckout } from "./actions";
import FAQ from "@/components/landing/FAQ";
import FeatureTrio from "@/components/landing/FeatureTrio";
import FounderSection from "@/components/landing/FounderSection";
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

const MAILTO_WAITLIST =
  "mailto:hello@glev.app?subject=Glev%20Beta%20Warteliste";

/**
 * Submit button rendered inside the <form> so useFormStatus can read the
 * pending state. Receives `isFull` via prop because the capacity-exhausted
 * label depends on the parent's count poll, which lives outside the form.
 */
function BetaSubmitButton({ isFull }: { isFull: boolean }) {
  const { pending } = useFormStatus();
  const label = isFull
    ? "Auf die Warteliste"
    : pending
      ? "Weiterleitung zu Stripe…"
      : "Platz sichern — €19";
  return <CTAButton submitting={pending} label={label} />;
}

function BetaContent() {
  const [email, setEmail] = useState("");
  const [count, setCount] = useState<CountResponse | null>(null);
  const ctaRef = useRef<HTMLInputElement | null>(null);
  // The form binds directly to the submitBetaCheckout server action so
  // Next.js can inject the action URL into the rendered <form> at SSR
  // time. The previous useActionState wrapper left the form without an
  // action attribute, so pre-hydration submits did a default GET reload
  // back to /beta with email in the query string. Errors come back via
  // ?error=<msg> and capacity exhaustion via ?full=1.
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const isFullFromUrl = searchParams.get("full") === "1";

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

  // Capacity exhaustion can race the count poll: if Stripe checkout
  // responds 409 the server action redirects back to /beta?full=1 —
  // degrade gracefully to the mailto waitlist so the user isn't stuck on
  // a red error.
  useEffect(() => {
    if (isFullFromUrl) {
      window.location.href = MAILTO_WAITLIST;
    }
  }, [isFullFromUrl]);

  const remaining = count?.remaining ?? CAPACITY;
  const isFull = count != null && remaining <= 0;
  const isLow = !isFull && count != null && remaining < 50;

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
              Einmal sprechen.<br />Makros berechnet.<br />CGM verknüpft.
            </h1>
            <p style={{ fontSize: 18, lineHeight: 1.5, color: TEXT_DIM, margin: 0, maxWidth: 520 }}>
              Glev ist der Meal-Tracker für Typ-1-Diabetiker, der mitdenkt — Spracheingabe, KI-Makros, CGM live.
            </p>

            <form
              action={submitBetaCheckout}
              className="glev-hero-form"
              style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}
            >
              <input
                ref={ctaRef}
                name="email"
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
              <BetaSubmitButton isFull={isFull} />
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

            {!isFull && (
              <div
                style={{
                  fontSize: 13,
                  color: TEXT_FAINT,
                  marginTop: 4,
                }}
              >
                Limitiert auf 500 Beta-Plätze.
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
            { left: "€19 heute", right: "deine Beta-Reservierung" },
            { left: "€4,50 / Monat im ersten Jahr", right: "nach Launch, als Beta-Tester" },
            { left: "€9 / Monat danach", right: "regulärer Preis" },
          ]}
          footer="Reservierung wird auf dein erstes Monatsabo angerechnet."
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
