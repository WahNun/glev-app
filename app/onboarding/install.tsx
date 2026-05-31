"use client";

/**
 * Onboarding flow — Step 7 of 8: Homescreen Install.
 *
 * Two expandable platform cards (Android / iOS). Tapping a card
 * expands it and shows numbered installation steps. The selected
 * card gets the accent border. Top-right Skip and the inline
 * skip link at the bottom both complete onboarding.
 *
 * Out of scope: PWA beforeinstallprompt API, macOS Safari,
 * desktop Chrome flows, Capacitor native shell changes.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Shell,
  ACCENT,
  GREEN,
  SURFACE,
  BORDER,
  TEXT,
  TEXT_DIM,
  TEXT_FAINT,
} from "./_shared";

type Platform = "android" | "ios";

export default function InstallStep({
  onNext,
  onBack,
  onSkip,
}: {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const t = useTranslations("onboarding.install");
  const [expanded, setExpanded] = useState<Platform | null>(null);

  function toggle(p: Platform) {
    setExpanded((prev) => (prev === p ? null : p));
  }

  const androidSteps: string[] = [
    t("android_step_1"),
    t("android_step_2"),
    t("android_step_3"),
    t("android_step_4"),
  ];

  const iosSteps: string[] = [
    t("ios_step_1"),
    t("ios_step_2"),
    t("ios_step_3"),
    t("ios_step_4"),
  ];

  return (
    <Shell
      step={7}
      onNext={onNext}
      onBack={onBack}
      onSkip={onSkip}
      primaryLabel={t("done")}
      primaryWithArrow={false}
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
          {t("headline")}
        </h1>
        <p style={{ fontSize: 14, color: TEXT_DIM, margin: 0, lineHeight: 1.5 }}>
          {t("sub")}
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <PlatformCard
          platform="android"
          icon="🤖"
          title={t("android_title")}
          steps={androidSteps}
          isExpanded={expanded === "android"}
          onToggle={() => toggle("android")}
          accentColor={GREEN}
        />
        <PlatformCard
          platform="ios"
          icon="🍎"
          title={t("ios_title")}
          steps={iosSteps}
          isExpanded={expanded === "ios"}
          onToggle={() => toggle("ios")}
          accentColor={ACCENT}
        />
      </div>

      <button
        onClick={onSkip}
        style={{
          background: "transparent",
          border: "none",
          color: TEXT_FAINT,
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          textAlign: "center",
          padding: "10px 14px",
          fontFamily: "inherit",
          textDecoration: "underline",
          textUnderlineOffset: 3,
        }}
      >
        {t("skip_later")}
      </button>
    </Shell>
  );
}

function PlatformCard({
  icon,
  title,
  steps,
  isExpanded,
  onToggle,
  accentColor,
}: {
  platform: Platform;
  icon: string;
  title: string;
  steps: string[];
  isExpanded: boolean;
  onToggle: () => void;
  accentColor: string;
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        textAlign: "left",
        background: SURFACE,
        border: `1px solid ${isExpanded ? accentColor : BORDER}`,
        borderLeft: `3px solid ${accentColor}`,
        borderRadius: 14,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 0,
        cursor: "pointer",
        color: TEXT,
        fontFamily: "inherit",
        width: "100%",
        transition: "border-color 0.15s",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20, lineHeight: 1 }}>{icon}</span>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{title}</span>
        </div>
        <span
          style={{
            color: TEXT_DIM,
            fontSize: 18,
            lineHeight: 1,
            flexShrink: 0,
            transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
            display: "inline-block",
          }}
        >
          ›
        </span>
      </div>

      {isExpanded && (
        <div
          style={{
            marginTop: 14,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {steps.map((step, i) => (
            <div
              key={i}
              style={{ display: "flex", alignItems: "flex-start", gap: 10 }}
            >
              <span
                style={{
                  minWidth: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: `${accentColor}22`,
                  color: accentColor,
                  fontSize: 11,
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {i + 1}
              </span>
              <span style={{ fontSize: 13.5, color: TEXT_DIM, lineHeight: 1.5 }}>
                {step}
              </span>
            </div>
          ))}
        </div>
      )}
    </button>
  );
}
