"use client";

/**
 * Onboarding mockup — Screen 1 of 4: Welcome.
 *
 * Renders the value proposition (3 bullets), brand mark and the
 * "not medical advice" disclaimer. Reads `?locale=de|en` from the
 * query string. Embedded as iframe shapes on the canvas; not wired
 * into the live app yet (mockup-only).
 */

import { Suspense } from "react";
import GlevLogo from "@/components/GlevLogo";
import {
  Shell,
  useLocaleParam,
  ACCENT,
  ORANGE,
  SURFACE,
  BORDER,
  TEXT_DIM,
} from "../_shared";

export default function WelcomeMockupPage() {
  return (
    <Suspense fallback={null}>
      <WelcomeMockup />
    </Suspense>
  );
}

function WelcomeMockup() {
  const locale = useLocaleParam();
  const t =
    locale === "de"
      ? {
          headline: "Willkommen bei Glev",
          sub: "Dein Begleiter für Typ-1-Diabetes.",
          bullets: [
            {
              icon: "🍽️",
              title: "Schnell loggen",
              body: "Mahlzeiten per Sprache oder Text — die KI extrahiert die Kohlenhydrate.",
            },
            {
              icon: "🧠",
              title: "Adaptive Engine",
              body: "Dein KH-Faktor lernt aus jeder Mahlzeit mit Glukose-Verlauf.",
            },
            {
              icon: "📊",
              title: "Klare Insights",
              body: "Time in Range, GMI und Trends — auf einen Blick.",
            },
          ],
          disclaimer:
            "Glev ersetzt keinen ärztlichen Rat. Therapie-Entscheidungen immer mit deinem Diabetologen abstimmen.",
          primary: "Los geht's",
        }
      : {
          headline: "Welcome to Glev",
          sub: "Your companion for Type 1 Diabetes.",
          bullets: [
            {
              icon: "🍽️",
              title: "Log in seconds",
              body: "Voice or text — the AI extracts carbs from your meal description.",
            },
            {
              icon: "🧠",
              title: "Adaptive engine",
              body: "Your ICR learns from every meal with a glucose curve.",
            },
            {
              icon: "📊",
              title: "Clear insights",
              body: "Time in Range, GMI and trends — at a glance.",
            },
          ],
          disclaimer:
            "Glev is not a substitute for medical advice. Always discuss therapy decisions with your diabetologist.",
          primary: "Let's go",
        };

  return (
    <Shell step={0} locale={locale} primaryLabel={t.primary}>
      {/* Hero */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          paddingTop: 8,
          textAlign: "center",
        }}
      >
        <div
          style={{
            filter: `drop-shadow(0 0 24px ${ACCENT}66)`,
          }}
        >
          <GlevLogo size={72} color={ACCENT} bg="#0F0F14" />
        </div>
        <h1
          style={{
            fontSize: 30,
            fontWeight: 800,
            margin: 0,
            letterSpacing: "-0.02em",
            lineHeight: 1.15,
          }}
        >
          {t.headline}
        </h1>
        <p
          style={{
            fontSize: 15,
            color: TEXT_DIM,
            margin: 0,
            maxWidth: 320,
            lineHeight: 1.45,
          }}
        >
          {t.sub}
        </p>
      </div>

      {/* Value bullets */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {t.bullets.map((b, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 14,
              padding: "14px 16px",
              background: SURFACE,
              border: `1px solid ${BORDER}`,
              borderRadius: 14,
              alignItems: "flex-start",
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: "rgba(79,110,247,0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
                flexShrink: 0,
              }}
            >
              {b.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>
                {b.title}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: TEXT_DIM,
                  lineHeight: 1.5,
                }}
              >
                {b.body}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Disclaimer */}
      <div
        style={{
          background: `${ORANGE}10`,
          border: `1px solid ${ORANGE}33`,
          borderRadius: 12,
          padding: "12px 14px",
          fontSize: 11.5,
          color: TEXT_DIM,
          lineHeight: 1.5,
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
        }}
      >
        <span style={{ color: ORANGE, fontSize: 14, lineHeight: 1 }}>⚠</span>
        <span>{t.disclaimer}</span>
      </div>
    </Shell>
  );
}
