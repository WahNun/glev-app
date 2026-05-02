"use client";

/**
 * Onboarding flow — Step 1 of 4: Welcome.
 * Graduated from `app/mockups/onboarding/welcome/page.tsx` to use
 * next-intl messages and real navigation handlers from the parent.
 */

import { useTranslations } from "next-intl";
import GlevLogo from "@/components/GlevLogo";
import {
  Shell,
  ACCENT,
  ORANGE,
  SURFACE,
  BORDER,
  TEXT_DIM,
} from "./_shared";

export default function WelcomeStep({
  onNext,
  onSkip,
}: {
  onNext: () => void;
  onSkip: () => void;
}) {
  const t = useTranslations("onboarding.welcome");
  const bullets = [
    { icon: "🍽️", title: t("bullet_1_title"), body: t("bullet_1_body") },
    { icon: "🧠", title: t("bullet_2_title"), body: t("bullet_2_body") },
    { icon: "📊", title: t("bullet_3_title"), body: t("bullet_3_body") },
  ];

  return (
    <Shell step={0} onNext={onNext} onSkip={onSkip} primaryLabel={t("primary")}>
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
        <div style={{ filter: `drop-shadow(0 0 24px ${ACCENT}66)` }}>
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
          {t("headline")}
        </h1>
        <p style={{ fontSize: 15, color: TEXT_DIM, margin: 0, maxWidth: 320, lineHeight: 1.45 }}>
          {t("sub")}
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {bullets.map((b, i) => (
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
              <div style={{ fontSize: 12.5, color: TEXT_DIM, lineHeight: 1.5 }}>
                {b.body}
              </div>
            </div>
          </div>
        ))}
      </div>

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
        <span>{t("disclaimer")}</span>
      </div>
    </Shell>
  );
}
