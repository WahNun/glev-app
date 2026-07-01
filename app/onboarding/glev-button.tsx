"use client";

/**
 * Onboarding flow — Step 5 of 8: Glev-Button gestures.
 *
 * Explains the two core gestures of the central Glev FAB:
 *   Short tap  → Voice input / AI chat
 *   Long press → Quick-add menu (Insulin, Fingerstick, Activity, Symptoms)
 *
 * Renders the real GlevAIButton inside a mini nav-bar context so the user
 * sees exactly what they will find in the app.
 */

import { useTranslations } from "next-intl";
import GlevAIButton from "@/components/GlevAIButton";
import {
  Shell,
  ACCENT,
  SURFACE,
  BORDER,
  TEXT,
  TEXT_DIM,
} from "./_shared";

export default function GlevButtonStep({
  onNext,
  onBack,
}: {
  onNext: () => void;
  onBack: () => void;
}) {
  const t = useTranslations("onboarding.glevButton");

  return (
    <Shell
      step={5}
      onNext={onNext}
      onBack={onBack}
      showSkip={false}
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

      <FabIllustration />

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <GestureCard
          icon="🎙️"
          title={t("short_title")}
          body={t("short_body")}
          accentColor={ACCENT}
        />
        <GestureCard
          icon="👆"
          title={t("swipe_title")}
          body={t("swipe_body")}
          accentColor="rgba(120,180,255,0.55)"
        />
        <GestureCard
          icon="☰"
          title={t("long_title")}
          body={t("long_body")}
          accentColor="rgba(255,255,255,0.45)"
        />
      </div>
    </Shell>
  );
}

function FabIllustration() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "4px 0 0" }}>
      <div style={{ position: "relative", width: 300, height: 72 }}>
        <div
          style={{
            position: "absolute",
            bottom: 0, left: 0, right: 0,
            height: 54,
            background: "#111117",
            borderTop: `1px solid ${BORDER}`,
            borderRadius: "0 0 14px 14px",
            display: "flex",
            alignItems: "center",
            padding: "0 4px",
            overflow: "visible",
          }}
        >
          <div style={{ flex: "1 1 0", display: "flex", justifyContent: "space-around" }}>
            <TabDot /><TabDot />
          </div>
          <div style={{ flex: "0 0 72px" }} />
          <div style={{ flex: "1 1 0", display: "flex", justifyContent: "space-around" }}>
            <TabDot /><TabDot />
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: 18,
            transform: "translateX(-50%)",
            pointerEvents: "none",
            zIndex: 10,
          }}
        >
          <GlevAIButton onPress={() => {}} />
        </div>
      </div>
    </div>
  );
}

function TabDot() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "4px 10px" }}>
      <div style={{ width: 20, height: 20, borderRadius: 6, background: "rgba(255,255,255,0.07)" }} />
      <div style={{ width: 26, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.07)" }} />
    </div>
  );
}

function GestureCard({
  icon,
  title,
  body,
  accentColor,
}: {
  icon: string;
  title: string;
  body: string;
  accentColor: string;
}) {
  return (
    <div
      style={{
        background: SURFACE,
        border: `1px solid ${BORDER}`,
        borderLeft: `3px solid ${accentColor}`,
        borderRadius: 14,
        padding: "14px 16px",
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
      }}
    >
      <span
        style={{
          fontSize: 24,
          lineHeight: 1,
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, marginBottom: 4 }}>
          {title}
        </div>
        <div style={{ fontSize: 13, color: TEXT_DIM, lineHeight: 1.5 }}>
          {body}
        </div>
      </div>
    </div>
  );
}
