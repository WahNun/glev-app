"use client";

/**
 * Onboarding Step 7 — Critical Alerts opt-in.
 *
 * Explains what Critical Alerts are and offers two paths:
 *   Primary  → request iOS CriticalAlert permission + save DB flag → continue
 *   Secondary→ snooze (7-day re-prompt gate) + continue without enabling
 *
 * The OS dialog only fires on iOS. On web/Android the step still shows
 * the explanation and saves the DB preference if Primary is tapped, so
 * users are informed and can opt in later via Settings.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Shell, ACCENT, GREEN, ORANGE, TEXT, TEXT_DIM, TEXT_FAINT, SURFACE, BORDER,
} from "./_shared";
import type { Step } from "./_shared";
import {
  requestCriticalAlertPermission,
  snoozeCriticalAlertsPrompt,
} from "@/lib/criticalAlerts";

const STEP: Step = 7;

interface Props {
  onNext: () => void;
  onBack: () => void;
}

export default function CriticalAlertsStep({ onNext, onBack }: Props) {
  const t = useTranslations("onboarding.critical_alerts");
  const [busy, setBusy] = useState(false);

  async function handleActivate() {
    if (busy) return;
    setBusy(true);
    try {
      await requestCriticalAlertPermission();
    } finally {
      setBusy(false);
    }
    onNext();
  }

  function handleLater() {
    snoozeCriticalAlertsPrompt();
    onNext();
  }

  return (
    <Shell
      step={STEP}
      onNext={handleActivate}
      onBack={onBack}
      primaryLabel={busy ? t("activating") : t("activate_btn")}
      primaryWithArrow={!busy}
      primaryDisabled={busy}
      showSkip={false}
    >
      {/* Icon */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{
          width: 72, height: 72, borderRadius: 20,
          background: `linear-gradient(135deg, #FF3B30, #FF6B35)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 8px 28px rgba(255,59,48,0.35)",
        }}>
          <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </div>
      </div>

      {/* Headline */}
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: TEXT, margin: "0 0 10px", lineHeight: 1.2, letterSpacing: "-0.03em" }}>
          {t("headline")}
        </h1>
        <p style={{ fontSize: 15, color: TEXT_DIM, lineHeight: 1.6, margin: 0 }}>
          {t("sub")}
        </p>
      </div>

      {/* Feature bullets */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {(["bullet_hypo", "bullet_hyper", "bullet_control"] as const).map((key) => (
          <div key={key} style={{
            display: "flex", alignItems: "flex-start", gap: 12,
            padding: "12px 14px", borderRadius: 12,
            background: SURFACE, border: `1px solid ${BORDER}`,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, flexShrink: 0,
              background: key === "bullet_control" ? "rgba(34,211,160,0.15)" : "rgba(255,59,48,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {key === "bullet_hypo" && (
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#FF3B30" strokeWidth={2.5} strokeLinecap="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
              )}
              {key === "bullet_hyper" && (
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#FF3B30" strokeWidth={2.5} strokeLinecap="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>
              )}
              {key === "bullet_control" && (
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#22D3A0" strokeWidth={2.5} strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
              )}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 2 }}>
                {t(`${key}_title` as Parameters<typeof t>[0])}
              </div>
              <div style={{ fontSize: 12, color: TEXT_DIM, lineHeight: 1.45 }}>
                {t(`${key}_body` as Parameters<typeof t>[0])}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* "Später" secondary link — shown below the Shell primary button via absolute positioning */}
      <div style={{ textAlign: "center", marginTop: -4 }}>
        <button
          onClick={handleLater}
          disabled={busy}
          style={{
            background: "none", border: "none", cursor: busy ? "default" : "pointer",
            color: TEXT_FAINT, fontSize: 13, fontWeight: 500,
            textDecoration: "underline", textDecorationColor: "transparent",
            padding: "6px 8px",
          }}
        >
          {t("later_btn")}
        </button>
      </div>

      {/* Fine print */}
      <p style={{ fontSize: 11, color: TEXT_FAINT, textAlign: "center", lineHeight: 1.5, margin: 0 }}>
        {t("fine_print")}
      </p>
    </Shell>
  );
}
