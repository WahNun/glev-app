"use client";

/**
 * Onboarding flow — Step 3 of 4: The Adaptive Engine.
 * Graduated from `app/mockups/onboarding/engine/page.tsx`.
 */

import { useTranslations } from "next-intl";
import {
  Shell,
  ACCENT,
  GREEN,
  ORANGE,
  SURFACE,
  BORDER,
  TEXT,
  TEXT_DIM,
  TEXT_FAINT,
} from "./_shared";

export default function EngineStep({
  onNext,
  onBack,
  onSkip,
}: {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const t = useTranslations("onboarding.engine");
  const phases = [
    { name: t("phase_1_name"), desc: t("phase_1_desc"), count: t("phase_1_count"), color: ORANGE, active: false },
    { name: t("phase_2_name"), desc: t("phase_2_desc"), count: t("phase_2_count"), color: ACCENT, active: true },
    { name: t("phase_3_name"), desc: t("phase_3_desc"), count: t("phase_3_count"), color: GREEN, active: false },
  ];
  const bullets = [t("bullet_1"), t("bullet_2"), t("bullet_3")];

  return (
    <Shell step={2} onNext={onNext} onBack={onBack} onSkip={onSkip}>
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
          {t("headline")}
        </h1>
        <p style={{ fontSize: 14, color: TEXT_DIM, margin: 0, lineHeight: 1.5 }}>
          {t("sub")}
        </p>
      </div>

      {/* Adaptive ICR card */}
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
          {t("card_label")}
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
            {t("card_value")}
          </span>
        </div>
        <div style={{ fontSize: 12, color: TEXT_DIM, marginBottom: 14, position: "relative" }}>
          {t("card_sub")}
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
          {t("card_formula")}
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
          {t("phases_title")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {phases.map((p, i) => (
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
                  <span style={{ fontSize: 13, fontWeight: 700, color: p.active ? p.color : TEXT }}>
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
        {bullets.map((b, i) => (
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
