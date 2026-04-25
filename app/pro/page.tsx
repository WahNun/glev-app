"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import CTAButton from "@/components/landing/CTAButton";
import FAQ from "@/components/landing/FAQ";
import Features from "@/components/landing/Features";
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctaRef = useRef<HTMLInputElement | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Bitte gib eine gültige Email-Adresse ein.");
      ctaRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/pro/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };

      if (res.status === 409) {
        setError(
          data.error ??
            "Diese Email hat bereits eine aktive Mitgliedschaft. Schreib uns an hello@glev.app, wenn du Hilfe brauchst.",
        );
        setSubmitting(false);
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

  const ctaLabel = submitting
    ? "Weiterleitung zu Stripe…"
    : "Mitgliedschaft starten — €24,90/Monat";

  return (
    <main
      style={{
        minHeight: "100vh",
        background: BG,
        color: "#fff",
        padding: "48px 20px 64px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div style={{ width: "100%", maxWidth: 680, display: "flex", flexDirection: "column", gap: 56 }}>
        {/* 1. Hero */}
        <section style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <Lockup width={240} />
          <h1
            style={{
              fontSize: "clamp(36px, 8vw, 48px)",
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              fontWeight: 700,
              color: "#fff",
              margin: 0,
            }}
          >
            Typ 1. Neu gedacht.
          </h1>
          <p style={{ fontSize: 18, lineHeight: 1.5, color: TEXT_DIM, margin: 0, maxWidth: 560 }}>
            Der sprachgesteuerte Essens-Tracker für Typ-1-Diabetiker. Direkter Zugang ab dem {LAUNCH_DATE_LABEL}.
          </p>

          <form onSubmit={handleSubmit} style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
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
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 14,
              color: MINT,
              marginTop: 4,
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            <span aria-hidden>↺</span>
            <span>Erste Abbuchung am {LAUNCH_DATE_LABEL} · jederzeit kündbar</span>
          </div>
        </section>

        <Steps />
        <Features />

        {/* Founder — subtle, below the feature list */}
        <section
          style={{
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
              width={80}
              height={80}
              style={{ objectFit: "cover", display: "block" }}
            />
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#fff", letterSpacing: "-0.01em" }}>
            Lucas Wahnon
          </div>
          <div style={{ fontSize: 13, color: TEXT_DIM }}>
            Gründer · lebt selbst mit Typ 1
          </div>
        </section>

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

        <FAQ items={PRO_FAQ} />
        <LandingFooter />
      </div>
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
