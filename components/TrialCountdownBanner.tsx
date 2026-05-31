"use client";

import { useEffect, useState } from "react";
import { usePlan } from "@/hooks/usePlan";

const DISMISS_KEY = "glev_trial_banner_dismissed_day";
const UPGRADE_URL = "https://glev.app/#preise";

export default function TrialCountdownBanner() {
  const { trialActive, trialEndsAt, loading } = usePlan();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const storedDay = localStorage.getItem(DISMISS_KEY);
    const today = new Date().toDateString();
    setDismissed(storedDay === today);
  }, []);

  if (loading || !trialActive || !trialEndsAt || dismissed) return null;

  const msLeft = new Date(trialEndsAt).getTime() - Date.now();
  const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));

  if (daysLeft > 3 || daysLeft <= 0) return null;

  const label =
    daysLeft === 1
      ? "Dein Trial endet heute"
      : daysLeft === 2
        ? "Noch 1 Tag Trial"
        : "Noch 2 Tage Trial";

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, new Date().toDateString());
    setDismissed(true);
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        marginBottom: 16,
        borderRadius: 10,
        background: "linear-gradient(135deg, #4F6EF714 0%, #4F6EF708 100%)",
        border: "1px solid #4F6EF740",
        fontSize: 13,
        lineHeight: 1.4,
      }}
    >
      <span style={{ fontSize: 16 }}>⏳</span>
      <span style={{ flex: 1, color: "var(--text)" }}>
        <strong style={{ color: "#4F6EF7" }}>{label}</strong> —{" "}
        Jetzt upgraden und Glev nach dem Trial voll weiternutzen.
      </span>
      <a
        href={UPGRADE_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          flexShrink: 0,
          padding: "6px 14px",
          borderRadius: 7,
          background: "#4F6EF7",
          color: "#fff",
          fontWeight: 700,
          fontSize: 12,
          textDecoration: "none",
          letterSpacing: "0.02em",
        }}
      >
        Upgraden →
      </a>
      <button
        onClick={dismiss}
        aria-label="Banner schließen"
        style={{
          flexShrink: 0,
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text-dim)",
          padding: 4,
          lineHeight: 1,
          fontSize: 16,
        }}
      >
        ×
      </button>
    </div>
  );
}
