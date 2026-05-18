"use client";

/**
 * Onboarding flow — Step 2 of 4: Log a meal in 3 steps.
 * Graduated from `app/mockups/onboarding/log-meal/page.tsx` to use
 * next-intl messages. Mini bottom-nav FAB is STATIC (mirrors the
 * real Layout.tsx — the live tab does not pulse).
 */

import { useTranslations } from "next-intl";
import GlevLogo from "@/components/GlevLogo";
import {
  Shell,
  ACCENT,
  GREEN,
  ORANGE,
  SURFACE,
  BORDER,
  TEXT,
  TEXT_DIM,
} from "./_shared";

export default function LogMealStep({
  onNext,
  onBack,
  onSkip,
}: {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const t = useTranslations("onboarding.log_meal");
  const steps = [
    { num: "1", title: t("step_1_title"), body: t("step_1_body") },
    { num: "2", title: t("step_2_title"), body: t("step_2_body") },
    { num: "3", title: t("step_3_title"), body: t("step_3_body") },
  ];

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

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {steps.map((s, i) => (
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
                width: 32,
                height: 32,
                borderRadius: 10,
                background: ACCENT,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              {s.num}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>
                {s.title}
              </div>
              <div style={{ fontSize: 12.5, color: TEXT_DIM, lineHeight: 1.5 }}>
                {s.body}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Live demo card */}
      <div
        style={{
          background: `linear-gradient(135deg, ${SURFACE}, #15151E)`,
          border: `1px solid ${ACCENT}33`,
          borderRadius: 16,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 9, color: ACCENT, fontWeight: 700, letterSpacing: "0.1em" }}>
          {t("demo_label")}
        </div>

        <div
          style={{
            background: "rgba(0,0,0,0.4)",
            border: `1px solid ${BORDER}`,
            borderRadius: 10,
            padding: "10px 14px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ color: ACCENT, fontSize: 14 }}>🎙</span>
          <span style={{ fontSize: 13, color: TEXT, fontStyle: "italic" }}>
            &ldquo;{t("chat_example")}&rdquo;
          </span>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span
            style={{
              padding: "5px 11px",
              borderRadius: 99,
              background: `${ORANGE}1A`,
              color: ORANGE,
              fontSize: 11.5,
              fontWeight: 700,
            }}
          >
            {t("chip_carbs")}
          </span>
          <span
            style={{
              padding: "5px 11px",
              borderRadius: 99,
              background: `${ACCENT}22`,
              color: ACCENT,
              fontSize: 11.5,
              fontWeight: 700,
            }}
          >
            {t("chip_bolus")}
          </span>
          <span
            style={{
              padding: "5px 11px",
              borderRadius: 99,
              background: `${GREEN}1A`,
              color: GREEN,
              fontSize: 10.5,
              fontWeight: 600,
            }}
          >
            {t("chip_confidence")}
          </span>
        </div>

        {/* Mini bottom-nav with static Glev mark. Mirrors the real 5-tab
            layout in components/Layout.tsx (2026-05-17 round 5):
            Dashboard / Entries / Glev (centre brand mark) / Insights /
            Settings. The centre slot is a plain brand mark, NOT an
            elevated FAB — all five tabs share the same visual weight in
            production. */}
        <div
          style={{
            marginTop: 4,
            background: "rgba(0,0,0,0.55)",
            borderRadius: 14,
            padding: "10px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-around",
            border: `1px solid ${BORDER}`,
          }}
        >
          <NavIconStub variant="dashboard" />
          <NavIconStub variant="entries" />
          <div
            aria-hidden
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <GlevLogo size={24} color={ACCENT} bg="transparent" />
          </div>
          <NavIconStub variant="insights" />
          <NavIconStub variant="settings" />
        </div>
      </div>
    </Shell>
  );
}

function NavIconStub({ variant }: { variant: "dashboard" | "entries" | "insights" | "settings" }) {
  const dim = "rgba(255,255,255,0.32)";
  // Icon glyphs are kept 1:1 in sync with components/Layout.tsx so the
  // onboarding preview matches the bottom-nav muscle memory the user
  // will see immediately after finishing the flow.
  if (variant === "dashboard") {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={dim} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11l9-8 9 8" />
        <path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" />
      </svg>
    );
  }
  if (variant === "entries") {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={dim} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10"/>
        <line x1="12" y1="20" x2="12" y2="4"/>
        <line x1="6" y1="20" x2="6" y2="14"/>
      </svg>
    );
  }
  if (variant === "insights") {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={dim} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18h6"/>
        <path d="M10 22h4"/>
        <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1.5.5 3 1.5 4 .76.76 1.23 1.52 1.41 2.5"/>
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={dim} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
