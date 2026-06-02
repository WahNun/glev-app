"use client";

/**
 * TrialCountdownBannerView — rein präsentationale Variante des TrialCountdownBanners.
 * Keine Hooks, kein API-Call, kein localStorage-Zugriff.
 * Wird ausschließlich in Admin-Preview-Kontexten (z.B. /glev-ops/journey) verwendet.
 */

const ACCENT = "#4F6EF7";
const UPGRADE_URL = "https://glev.app/#preise";

export default function TrialCountdownBannerView({ daysLeft }: { daysLeft: 1 | 2 | 3 }) {
  const label =
    daysLeft === 1
      ? "Dein Trial endet heute"
      : daysLeft === 2
        ? "Noch 1 Tag Trial"
        : "Noch 2 Tage Trial";

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
      <span style={{ flex: 1, color: "var(--text, rgba(255,255,255,0.96))" }}>
        <strong style={{ color: ACCENT }}>{label}</strong> —{" "}
        Jetzt upgraden und Glev nach dem Trial voll weiternutzen.
      </span>
      <a
        href={UPGRADE_URL}
        target="_blank"
        rel="noopener noreferrer"
        tabIndex={-1}
        style={{
          flexShrink: 0,
          padding: "6px 14px",
          borderRadius: 7,
          background: ACCENT,
          color: "#fff",
          fontWeight: 700,
          fontSize: 12,
          textDecoration: "none",
          letterSpacing: "0.02em",
        }}
      >
        Upgraden →
      </a>
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          background: "none",
          border: "none",
          color: "var(--text-dim, rgba(255,255,255,0.55))",
          padding: 4,
          lineHeight: 1,
          fontSize: 16,
        }}
      >
        ×
      </span>
    </div>
  );
}
