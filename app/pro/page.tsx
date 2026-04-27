"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import AppMockupPhone from "@/components/AppMockupPhone";
import CTAButton from "@/components/landing/CTAButton";
import { startProCheckout, type ProCheckoutState } from "./actions";
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
  LAUNCH_DATE_LABEL,
  MINT,
  PINK,
  SURFACE,
  TEXT_DIM,
} from "@/components/landing/tokens";

/**
 * /pro — direct monthly-subscription landing page.
 * A/B partner to /beta. No reservation deposit, no seat counter, billing
 * begins on the public launch date (1 July 2026) via a Stripe trial.
 */
export default function ProPage() {
  const [email, setEmail] = useState("");
  const ctaRef = useRef<HTMLInputElement | null>(null);
  // useActionState wires the <form action={formAction}> submit straight to the
  // Stripe checkout server action. Bypasses the previous client-side fetch
  // path that lost submits when the user clicked before React had hydrated
  // (the symptom was a default GET reload back to /pro with email in the URL).
  const [state, formAction, isPending] = useActionState<
    ProCheckoutState | null,
    FormData
  >(startProCheckout, null);
  const error = state?.error ?? null;

  const ctaLabel = isPending
    ? "Weiterleitung zu Stripe…"
    : "Mitgliedschaft starten — €24,90/Monat";

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
              Der sprachgesteuerte Essens-Tracker für Typ-1-Diabetiker. Direkter Zugang ab dem {LAUNCH_DATE_LABEL}.
            </p>

            <form
              action={formAction}
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
              <CTAButton submitting={isPending} label={ctaLabel} />
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
              <span>Erste Abbuchung am {LAUNCH_DATE_LABEL} · jederzeit kündbar</span>
            </div>
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
            { left: `€24,90 / Monat — ab dem ${LAUNCH_DATE_LABEL}`, right: "kein Aufschlag, kein Versteckspiel" },
            { left: "Karte wird heute hinterlegt — heute keine Buchung", right: "erste Abbuchung am Launch-Tag" },
            { left: "Jederzeit kündbar", right: "im Account-Bereich oder per Email an hello@glev.app" },
          ]}
          footer={
            <>
              Lieber niedriger Einstieg + Lock-in?{" "}
              <Link
                href="/beta"
                style={{
                  color: MINT,
                  textDecoration: "underline",
                  textUnderlineOffset: 2,
                }}
              >
                glev.app/beta für €19 Reservierung
              </Link>
            </>
          }
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
        <FAQ items={PRO_FAQ} />
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

const PRO_FAQ = [
  {
    q: "Welche CGMs werden unterstützt?",
    a: "Aktuell FreeStyle Libre 2 via LibreLinkUp. Dexcom G6/G7 sind in Arbeit. Nightscout-Support folgt.",
  },
  {
    q: "Was passiert wenn ich vor dem Launch kündige?",
    a: "Du kannst die Mitgliedschaft jederzeit vor dem 1. Juli 2026 ohne Folgen beenden. Es wird dann nichts abgebucht.",
  },
  {
    q: "Ist Glev ein Medizinprodukt?",
    a: "Nein. Glev ist ein Dokumentations- und Organisations-Tool. Therapieentscheidungen triffst du weiter mit deinem Arzt.",
  },
  {
    q: "Was unterscheidet diese Mitgliedschaft von der Beta-Reservierung?",
    a: "Die /beta-Variante ist eine €19 Einmalreservierung mit Beta-Discount im ersten Jahr. /pro ist eine direkte Monats-Mitgliedschaft ohne Reservierungseinsatz, dafür zum vollen Preis. Beide bekommen Zugang am 1. Juli 2026.",
  },
  {
    q: "Wo werden meine Daten gespeichert?",
    a: "In der EU (Supabase Frankfurt). Deutsche DSGVO. Keine Datenweitergabe, keine Werbung.",
  },
];
