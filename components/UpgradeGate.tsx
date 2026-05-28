"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { usePlan } from "@/hooks/usePlan";
import { requiredPlanLabel, FEATURE_TIERS } from "@/lib/planFeatures";

const ACCENT = "#4F6EF7";

async function startCheckout(locale: string): Promise<string | null> {
  try {
    const res = await fetch("/api/checkout/pro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale }),
    });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !data.url) return null;
    return data.url;
  } catch {
    return null;
  }
}

export default function UpgradeGate({
  feature,
  children,
  variant = "overlay",
  blurPx = 2.5,
  opacity = 0.6,
}: {
  feature: string;
  children?: React.ReactNode;
  variant?: "overlay" | "row";
  blurPx?: number;
  opacity?: number;
}) {
  const { canAccess, loading } = usePlan();
  const locale = useLocale();
  const [busy, setBusy] = useState(false);

  const handleUpgrade = async () => {
    if (busy) return;
    setBusy(true);
    const url = await startCheckout(locale);
    if (url) {
      window.location.href = url;
    } else {
      setBusy(false);
    }
  };

  if (loading || canAccess(feature)) {
    return <>{children}</>;
  }

  const tier = FEATURE_TIERS[feature] ?? "pro";
  const planName = requiredPlanLabel(tier);

  if (variant === "row") {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); void handleUpgrade(); }}
        disabled={busy}
        aria-label={`${planName} erforderlich`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: 8,
          background: `${ACCENT}14`,
          color: ACCENT,
          border: "none",
          cursor: busy ? "default" : "pointer",
          flexShrink: 0,
          fontSize: 14,
          lineHeight: 1,
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? "…" : "🔒"}
      </button>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      {children && (
        <div
          aria-hidden="true"
          style={{
            filter: `blur(${blurPx}px)`,
            opacity,
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          {children}
        </div>
      )}

      <button
        type="button"
        onClick={() => void handleUpgrade()}
        disabled={busy}
        style={{
          position: children ? "absolute" : "relative",
          inset: children ? 0 : undefined,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: children ? 0 : "36px 24px",
          minHeight: children ? undefined : 200,
          textAlign: "center",
          background: "transparent",
          border: "none",
          cursor: busy ? "default" : "pointer",
          width: "100%",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            padding: "20px 24px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 14,
            boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          }}
        >
          <div style={{ fontSize: 28, lineHeight: 1 }}>{busy ? "⏳" : "🔒"}</div>

          <div
            style={{
              display: "inline-block",
              padding: "3px 10px",
              borderRadius: 20,
              background: `${ACCENT}18`,
              color: ACCENT,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {planName}
          </div>

          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: "var(--text-dim)",
              maxWidth: 220,
              lineHeight: 1.5,
            }}
          >
            Ab{" "}
            <strong style={{ color: "var(--text)" }}>{planName}</strong>{" "}
            verfügbar
          </p>

          <div
            style={{
              display: "inline-block",
              padding: "10px 22px",
              background: busy ? `${ACCENT}88` : ACCENT,
              color: "#fff",
              borderRadius: 9,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              marginTop: 2,
              transition: "background 0.15s",
            }}
          >
            {busy ? "Weiterleitung …" : "Upgraden →"}
          </div>
        </div>
      </button>
    </div>
  );
}
