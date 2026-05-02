"use client";

/**
 * Onboarding mockup — Screen 4 of 4: Insights & history.
 *
 * Shows 3 mini stat cards (TIR / GMI / Trend) that mirror the
 * real Insights page, a tiny glucose-trend sparkline, and a hint
 * about tap-to-flip cards. Final screen — primary button is the
 * CTA to start the actual flow. Reads `?locale=de|en`.
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
  TEXT_DIM,
  TEXT_FAINT,
} from "../_shared";

export default function InsightsMockupPage() {
  return (
    <Suspense fallback={null}>
      <InsightsMockup />
    </Suspense>
  );
}

function InsightsMockup() {
  const locale = useLocaleParam();
  const t =
    locale === "de"
      ? {
          headline: "Deine Daten — dein Lernwerkzeug",
          sub: "Im Verlauf-Tab siehst du, was bei dir wirklich wirkt.",
          cards: [
            { label: "TIME IN RANGE", value: "75", unit: "%", color: GREEN, sub: "letzte 7 Tage", bar: 75 },
            { label: "GMI / A1c",     value: "6,8", unit: "%", color: ACCENT, sub: "geschätzte HbA1c", bar: 60 },
            { label: "TREND",         value: "↘",   unit: "",  color: GREEN, sub: "−12 mg/dL ggü. Vorwoche", bar: 70 },
          ],
          chartTitle: "Glukose-Verlauf",
          chartBadge: "7d",
          hintTitle: "Tipp",
          hint: "Tap eine Karte, um Formel und Erklärung zu sehen.",
          bullets: [
            "Time in Range, GMI, Hypo/Hyper-Events, Glukose-Variabilität (CV %).",
            "Workout-Outcomes zeigen, wie Bewegung deine Glukose beeinflusst.",
            "Karten lassen sich per Drag & Drop in deine Lieblings-Reihenfolge bringen.",
          ],
          primary: "Erste Mahlzeit loggen",
        }
      : {
          headline: "Your data — your learning tool",
          sub: "The History tab shows what really works for you.",
          cards: [
            { label: "TIME IN RANGE", value: "75", unit: "%", color: GREEN, sub: "last 7 days", bar: 75 },
            { label: "GMI / A1c",     value: "6.8", unit: "%", color: ACCENT, sub: "estimated HbA1c", bar: 60 },
            { label: "TREND",         value: "↘",   unit: "",  color: GREEN, sub: "−12 mg/dL vs prev week", bar: 70 },
          ],
          chartTitle: "Glucose trend",
          chartBadge: "7d",
          hintTitle: "Tip",
          hint: "Tap a card to see formula and explanation.",
          bullets: [
            "Time in Range, GMI, hypo/hyper events, glucose variability (CV %).",
            "Workout outcomes show how exercise affects your glucose.",
            "Cards can be dragged & dropped into your favorite order.",
          ],
          primary: "Log my first meal",
        };

  return (
    <Shell
      step={3}
      locale={locale}
      primaryLabel={t.primary}
      primaryWithArrow={false}
      showSkip={false}
    >
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

      {/* 3 stat cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 8,
        }}
      >
        {t.cards.map((c, i) => (
          <div
            key={i}
            style={{
              background: SURFACE,
              border: `1px solid ${BORDER}`,
              borderRadius: 12,
              padding: "12px 11px",
              display: "flex",
              flexDirection: "column",
              gap: 7,
              minHeight: 116,
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: TEXT_DIM,
                fontWeight: 700,
                letterSpacing: "0.08em",
                lineHeight: 1.2,
              }}
            >
              {c.label}
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2 }}>
              <span
                style={{
                  fontSize: 30,
                  fontWeight: 800,
                  color: c.color,
                  letterSpacing: "-0.03em",
                  lineHeight: 1,
                  fontVariantNumeric: "tabular-nums",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {c.value}
              </span>
              <span style={{ fontSize: 12, color: TEXT_DIM, paddingBottom: 3 }}>
                {c.unit}
              </span>
            </div>
            <div
              style={{
                height: 3,
                background: "rgba(255,255,255,0.07)",
                borderRadius: 99,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${c.bar}%`,
                  height: "100%",
                  background: c.color,
                  borderRadius: 99,
                }}
              />
            </div>
            <div style={{ fontSize: 10.5, color: TEXT_DIM, marginTop: "auto", lineHeight: 1.35 }}>
              {c.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Mini glucose-trend chart */}
      <div
        style={{
          background: SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          padding: "14px 16px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 11.5,
            color: TEXT_DIM,
            marginBottom: 10,
          }}
        >
          <span style={{ fontWeight: 600 }}>{t.chartTitle}</span>
          <span
            style={{
              background: `${ACCENT}22`,
              color: ACCENT,
              padding: "3px 10px",
              borderRadius: 99,
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.05em",
            }}
          >
            {t.chartBadge}
          </span>
        </div>
        <svg
          width="100%"
          height="68"
          viewBox="0 0 300 68"
          preserveAspectRatio="none"
          style={{ display: "block" }}
        >
          <defs>
            <linearGradient id="igrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity="0.35" />
              <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Range band */}
          <rect x="0" y="22" width="300" height="22" fill={GREEN} fillOpacity="0.07" />
          <line x1="0" y1="22" x2="300" y2="22" stroke={GREEN} strokeOpacity="0.3" strokeDasharray="3 4" />
          <line x1="0" y1="44" x2="300" y2="44" stroke={GREEN} strokeOpacity="0.3" strokeDasharray="3 4" />
          {/* Curve */}
          <path
            d="M 0 44 L 30 34 L 60 38 L 90 26 L 120 32 L 150 18 L 180 28 L 210 34 L 240 30 L 270 26 L 300 32 L 300 68 L 0 68 Z"
            fill="url(#igrad)"
          />
          <path
            d="M 0 44 L 30 34 L 60 38 L 90 26 L 120 32 L 150 18 L 180 28 L 210 34 L 240 30 L 270 26 L 300 32"
            fill="none"
            stroke={ACCENT}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="150" cy="18" r="3.5" fill={ORANGE} />
        </svg>
      </div>

      {/* Hint */}
      <div
        style={{
          background: `${ACCENT}10`,
          border: `1px solid ${ACCENT}33`,
          borderRadius: 12,
          padding: "12px 14px",
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
        }}
      >
        <span style={{ color: ACCENT, fontSize: 14, lineHeight: 1 }}>💡</span>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 11.5,
              color: ACCENT,
              fontWeight: 700,
              marginBottom: 3,
              letterSpacing: "0.05em",
            }}
          >
            {t.hintTitle}
          </div>
          <div style={{ fontSize: 12, color: TEXT_DIM, lineHeight: 1.5 }}>
            {t.hint}
          </div>
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
            <span style={{ color: GREEN, flexShrink: 0, fontWeight: 700 }}>✓</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
