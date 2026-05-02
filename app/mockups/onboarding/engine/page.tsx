"use client";

/**
 * Onboarding mockup — Screen 3 of 4: The Adaptive Engine.
 *
 * Visualises the KH-Faktor / ICR card the user will encounter on
 * the Insights page, plus the 3-phase learning indicator
 * (Aufwärmphase → Lernphase → Feinjustiert). Reads `?locale=de|en`.
 */

import { Suspense } from "react";
import {
  Shell,
  useLocaleParam,
  ACCENT,
  GREEN,
  ORANGE,
  SURFACE,
  BORDER,
  TEXT,
  TEXT_DIM,
  TEXT_FAINT,
} from "../_shared";

export default function EngineMockupPage() {
  return (
    <Suspense fallback={null}>
      <EngineMockup />
    </Suspense>
  );
}

function EngineMockup() {
  const locale = useLocaleParam();
  const t =
    locale === "de"
      ? {
          headline: "Die Engine lernt mit dir",
          sub: "Dein KH-Faktor verbessert sich nach jeder Mahlzeit mit Glukose-Verlauf.",
          cardLabel: "ADAPTIVER KH-FAKTOR",
          cardValue: "1 : 12,5",
          cardSub: "ergebnisgewichtet · 14 Mahlzeiten",
          cardFormula: "1 IE deckt 12,5 g KH",
          phasesTitle: "Lernphasen",
          phases: [
            {
              name: "Aufwärmphase",
              desc: "Glev nutzt deinen Default-Faktor.",
              count: "0–7 Mahlzeiten",
              color: ORANGE,
              active: false,
            },
            {
              name: "Lernphase",
              desc: "Erste empirische Anpassung deines KH-Faktors.",
              count: "8–20 Mahlzeiten",
              color: ACCENT,
              active: true,
            },
            {
              name: "Feinjustiert",
              desc: "Selbstkalibrierend mit deinen Trends.",
              count: "20+ Mahlzeiten",
              color: GREEN,
              active: false,
            },
          ],
          bullets: [
            "Mahlzeiten mit gutem Outcome zählen mehr als Spikes oder Hypos.",
            "Du kannst deinen Default-Faktor jederzeit in den Einstellungen anpassen.",
            "Etwa 10 Mahlzeiten reichen, bevor die Engine spürbar wirkt.",
          ],
        }
      : {
          headline: "The engine learns with you",
          sub: "Your ICR improves after every meal with a glucose curve.",
          cardLabel: "ADAPTIVE ICR",
          cardValue: "1 : 12.5",
          cardSub: "outcome-weighted · 14 meals",
          cardFormula: "1 u covers 12.5 g carbs",
          phasesTitle: "Learning phases",
          phases: [
            {
              name: "Warm-up",
              desc: "Glev uses your default ratio.",
              count: "0–7 meals",
              color: ORANGE,
              active: false,
            },
            {
              name: "Learning",
              desc: "First empirical adjustments to your ICR.",
              count: "8–20 meals",
              color: ACCENT,
              active: true,
            },
            {
              name: "Tuned",
              desc: "Self-calibrating with your trends.",
              count: "20+ meals",
              color: GREEN,
              active: false,
            },
          ],
          bullets: [
            "Meals with good outcomes count more than spikes or hypos.",
            "You can adjust your default ratio anytime in settings.",
            "Around 10 meals are enough before the engine kicks in noticeably.",
          ],
        };

  return (
    <Shell step={2} locale={locale}>
      <div>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 800,
            margin: 0,
            letterSpacing: "-0.02em",
            marginBottom: 6,
            lineHeight: 1.2,
          }}
        >
          {t.headline}
        </h1>
        <p style={{ fontSize: 14, color: TEXT_DIM, margin: 0, lineHeight: 1.5 }}>
          {t.sub}
        </p>
      </div>

      {/* Adaptive KH-Faktor card */}
      <div
        style={{
          background: SURFACE,
          border: `1px solid ${ACCENT}55`,
          borderRadius: 16,
          padding: "20px 22px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -50,
            right: -50,
            width: 180,
            height: 180,
            borderRadius: 99,
            background: `radial-gradient(${ACCENT}33, transparent 70%)`,
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            fontSize: 10,
            color: ACCENT,
            fontWeight: 700,
            letterSpacing: "0.12em",
            marginBottom: 12,
            position: "relative",
          }}
        >
          {t.cardLabel}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 14,
            marginBottom: 6,
            position: "relative",
          }}
        >
          <span
            style={{
              fontSize: 48,
              fontWeight: 800,
              color: ACCENT,
              letterSpacing: "-0.03em",
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
              fontFamily: "var(--font-mono)",
            }}
          >
            {t.cardValue}
          </span>
        </div>
        <div
          style={{
            fontSize: 12,
            color: TEXT_DIM,
            marginBottom: 14,
            position: "relative",
          }}
        >
          {t.cardSub}
        </div>
        <div
          style={{
            padding: "9px 12px",
            borderRadius: 8,
            background: "rgba(0,0,0,0.3)",
            border: `1px solid ${BORDER}`,
            fontSize: 12,
            color: TEXT_DIM,
            fontFamily: "var(--font-mono)",
            position: "relative",
          }}
        >
          {t.cardFormula}
        </div>
      </div>

      {/* Phases */}
      <div>
        <div
          style={{
            fontSize: 10,
            color: TEXT_FAINT,
            letterSpacing: "0.12em",
            fontWeight: 700,
            marginBottom: 10,
            textTransform: "uppercase",
          }}
        >
          {t.phasesTitle}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {t.phases.map((p, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                background: p.active ? `${p.color}10` : SURFACE,
                border: `1px solid ${p.active ? p.color + "55" : BORDER}`,
                borderRadius: 12,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 99,
                  background: p.color,
                  boxShadow: p.active ? `0 0 10px ${p.color}` : "none",
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: p.active ? p.color : TEXT,
                    }}
                  >
                    {p.name}
                  </span>
                  <span style={{ fontSize: 10, color: TEXT_FAINT }}>{p.count}</span>
                </div>
                <div style={{ fontSize: 11.5, color: TEXT_DIM, marginTop: 2 }}>
                  {p.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bullets */}
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {t.bullets.map((b, i) => (
          <li
            key={i}
            style={{
              fontSize: 12.5,
              color: TEXT_DIM,
              lineHeight: 1.5,
              display: "flex",
              gap: 10,
            }}
          >
            <span style={{ color: ACCENT, flexShrink: 0 }}>•</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
